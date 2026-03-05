import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { OpenAI } from 'openai';
import * as crypto from 'crypto';

import {
  createOpenAIClient,
  getModelName,
} from '../../common/utils/openai-client.factory';
import {
  IRS_SCORING_CRITERIA,
  IRS_SCORE_CACHE_TTL,
  IRS_REDIS_KEYS,
} from './constants/irs.constants';
import {
  buildIrsScoringSystemPrompt,
  buildIrsScoringUserPrompt,
  AI_SERVICE_CONFIG,
} from '../../common/constants/ai-prompts.constant';

/**
 * AI tomonidan berilgan skor natijasi
 */
export interface IrsScoreResult {
  scores: {
    correctness: number;
    depth: number;
    communication: number;
    completeness: number;
    timeEfficiency: number;
  };
  weightedScore: number;
  feedback: string;
  quickTip: string;
}

/**
 * IRS AI Scoring Service
 *
 * IRS savollariga berilgan javoblarni AI yordamida baholaydi.
 * - Arzon model (GLM-4-32B via OpenRouter) ishlatadi
 * - Natijalarni cache qiladi (sha256 hash bo'yicha)
 * - Circuit breaker: AI down bo'lsa fallback scoring
 */
@Injectable()
export class ReadinessTestScoringService {
  private readonly logger = new Logger(ReadinessTestScoringService.name);
  private openai: OpenAI | null;
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private circuitOpenedAt = 0;

  // Circuit breaker config
  private readonly FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT_MS = 30000; // 30 seconds

  constructor(
    private configService: ConfigService,
    @InjectRedis() private redis: Redis,
  ) {
    this.openai = createOpenAIClient(configService);
  }

  /**
   * Javobni AI yordamida baholash
   *
   * 1. Cache check (sha256 hash)
   * 2. Circuit breaker check
   * 3. AI scoring call
   * 4. Cache save
   * 5. Fallback if all fails
   */
  async scoreAnswer(params: {
    position: string;
    techStack: string;
    category: string;
    difficulty: string;
    questionText: string;
    answer: string;
    timeTaken: number;
    language: string;
  }): Promise<IrsScoreResult> {
    // 1. Check cache (FIX P1-M2: includes position + difficulty in cache key)
    const cacheKey = this.buildCacheKey(
      params.questionText,
      params.answer,
      params.position,
      params.difficulty,
    );
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug('IRS score served from cache');
      return cached;
    }

    // 2. Check circuit breaker
    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit breaker OPEN — using fallback scoring');
      return this.fallbackScoring(params);
    }

    // 3. AI scoring
    try {
      const result = await this.callAIScoring(params);
      this.onSuccess();

      // 4. Cache result
      await this.saveToCache(cacheKey, result);

      return result;
    } catch (error) {
      this.onFailure(error);
      this.logger.error(`AI scoring failed: ${error.message}`);

      // 5. Fallback
      return this.fallbackScoring(params);
    }
  }

  /**
   * AI orqali baholash — OpenRouter call
   */
  private async callAIScoring(params: {
    position: string;
    techStack: string;
    category: string;
    difficulty: string;
    questionText: string;
    answer: string;
    timeTaken: number;
    language: string;
  }): Promise<IrsScoreResult> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const irsModel =
      this.configService.get<string>('features.irs.aiModel') || 'z-ai/glm-4-32b';
    const maxTokens =
      this.configService.get<number>('features.irs.scoringMaxTokens') || 300;
    const temperature =
      this.configService.get<number>('features.irs.scoringTemperature') || 0.3;

    const modelName = getModelName(this.configService, irsModel, irsModel);

    // FIX P1-C1: Separate system prompt from user content to prevent prompt injection.
    // The candidate's answer is sent as a separate user message, not embedded in the system prompt.
    // Enterprise-grade prompts from centralized constants
    const systemPrompt = buildIrsScoringSystemPrompt(params);
    const userMessage = buildIrsScoringUserPrompt(params);

    const response = await this.openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty AI response');
    }

    return this.parseAIResponse(content);
  }

  /**
   * AI javobini parse qilish
   */
  private parseAIResponse(content: string): IrsScoreResult {
    // Markdown code block ni tozalash
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);

      // Validate scores
      const scores = {
        correctness: this.clampScore(parsed.scores?.correctness),
        depth: this.clampScore(parsed.scores?.depth),
        communication: this.clampScore(parsed.scores?.communication),
        completeness: this.clampScore(parsed.scores?.completeness),
        timeEfficiency: this.clampScore(parsed.scores?.timeEfficiency),
      };

      // Calculate weighted score
      const weightedScore = this.calculateWeightedScore(scores);

      return {
        scores,
        weightedScore,
        feedback: parsed.feedback || 'Baholash yakunlandi.',
        quickTip: parsed.quickTip || '',
      };
    } catch {
      throw new Error(`Failed to parse AI response: ${cleaned.substring(0, 200)}`);
    }
  }

  /**
   * Skor 0-10 oralig'ida qolishini ta'minlash
   */
  private clampScore(value: any): number {
    const num = Number(value);
    if (isNaN(num)) return 5; // default
    return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
  }

  /**
   * Vaznli o'rtacha skor hisoblash (0-10)
   */
  private calculateWeightedScore(scores: Record<string, number>): number {
    let total = 0;
    for (const [criterion, config] of Object.entries(IRS_SCORING_CRITERIA)) {
      const score = scores[criterion] || 0;
      total += score * config.weight;
    }
    return Math.round(total * 100) / 100;
  }

  // ─── Fallback Scoring ───────────────────────────────────────

  /**
   * AI down bo'lganda basic scoring
   * Keyword matching + answer length heuristics
   */
  private fallbackScoring(params: {
    answer: string;
    timeTaken: number;
    difficulty: string;
  }): IrsScoreResult {
    const answerLength = params.answer.trim().split(/\s+/).length;
    const timeTaken = params.timeTaken;

    // Word count based scoring
    let baseScore = 5;
    if (answerLength < 10) baseScore = 3;
    else if (answerLength < 30) baseScore = 4;
    else if (answerLength < 60) baseScore = 5;
    else if (answerLength < 120) baseScore = 6;
    else baseScore = 7;

    // Time efficiency
    let timeScore = 7;
    if (timeTaken > 55) timeScore = 4;
    else if (timeTaken > 45) timeScore = 5;
    else if (timeTaken > 30) timeScore = 6;
    else if (timeTaken < 5) timeScore = 3; // too fast = probably copy-paste

    const scores = {
      correctness: baseScore,
      depth: Math.max(3, baseScore - 1),
      communication: baseScore,
      completeness: Math.max(3, baseScore - 1),
      timeEfficiency: timeScore,
    };

    return {
      scores,
      weightedScore: this.calculateWeightedScore(scores),
      feedback: 'Javobingiz qabul qilindi. Batafsil tahlil hozirda mavjud emas.',
      quickTip: '',
    };
  }

  // ─── Cache ──────────────────────────────────────────────────

  // FIX P1-M2: Include position, difficulty, and category in cache key
  // so different contexts don't return the same cached score.
  private buildCacheKey(
    question: string,
    answer: string,
    position?: string,
    difficulty?: string,
  ): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${position || ''}:${difficulty || ''}:${question}:${answer}`)
      .digest('hex')
      .substring(0, 16);
    return `${IRS_REDIS_KEYS.SCORE_CACHE}${hash}`;
  }

  private async getFromCache(key: string): Promise<IrsScoreResult | null> {
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private async saveToCache(
    key: string,
    result: IrsScoreResult,
  ): Promise<void> {
    try {
      await this.redis.setex(key, IRS_SCORE_CACHE_TTL, JSON.stringify(result));
    } catch (error) {
      this.logger.warn(`Cache save failed: ${error.message}`);
    }
  }

  // ─── Circuit Breaker ────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (!this.circuitOpen) return false;

    // Half-open check: enough time passed?
    if (Date.now() - this.circuitOpenedAt > this.CIRCUIT_TIMEOUT_MS) {
      this.logger.log('Circuit breaker HALF-OPEN — trying AI again');
      this.circuitOpen = false;
      this.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitOpen) {
      this.circuitOpen = false;
      this.logger.log('Circuit breaker CLOSED — AI recovered');
    }
  }

  private onFailure(error: any): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD && !this.circuitOpen) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
      this.logger.error(
        `Circuit breaker OPEN — ${this.consecutiveFailures} consecutive failures. Last: ${error.message}`,
      );
    }
  }
}
