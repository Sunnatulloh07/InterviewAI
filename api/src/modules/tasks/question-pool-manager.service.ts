import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENROUTER_MODELS } from '../../common/utils/openai-client.factory';

/**
 * 🏭 QUESTION POOL MANAGER SERVICE
 * 
 * Background service that maintains a pool of pre-generated questions
 * to enable sequential learning without real-time AI generation
 * 
 * ARCHITECTURE:
 * 1. Runs every 30 minutes (24/7)
 * 2. Generates questions for each position/type/domain combination
 * 3. Stores in database for sequential distribution
 * 4. New users get oldest questions first (FIFO)
 * 5. Pool auto-refills when running low
 * 
 * BENEFITS:
 * - 🚀 Fast delivery (no AI wait at 09:00)
 * - 💰 Cost efficient (batch generation cheaper)
 * - 📚 Sequential learning (all users same path)
 * - ⚡ Scalable (1M users no problem)
 */
@Injectable()
export class QuestionPoolManagerService {
  private readonly logger = new Logger(QuestionPoolManagerService.name);
  private readonly openai: OpenAI;

  // Target pool size per position/type/domain
  private readonly TARGET_POOL_SIZE = 100; // 100 questions per combination
  private readonly MIN_POOL_SIZE = 30; // Refill when below this
  private readonly BATCH_SIZE = 10; // Generate 10 at a time

  // Position/Type/Domain combinations to maintain
  private readonly COMBINATIONS = [
    // Junior
    { position: 'junior', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'general'] },
    { position: 'junior', type: 'behavioral', domains: ['general'] },
    
    // Mid
    { position: 'mid', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'fullstack', 'general'] },
    { position: 'mid', type: 'behavioral', domains: ['general'] },
    { position: 'mid', type: 'system_design', domains: ['general'] },
    
    // Senior
    { position: 'senior', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'fullstack', 'devops', 'general'] },
    { position: 'senior', type: 'behavioral', domains: ['general'] },
    { position: 'senior', type: 'system_design', domains: ['general'] },
    
    // Lead
    { position: 'lead', type: 'technical', domains: ['architecture', 'fullstack', 'devops', 'general'] },
    { position: 'lead', type: 'behavioral', domains: ['general'] },
    { position: 'lead', type: 'system_design', domains: ['general'] },
  ];

  constructor(
    @InjectModel(GeneratedQuestion.name)
    private readonly questionModel: Model<GeneratedQuestionDocument>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    // Initialize OpenRouter client
    // 🔧 FIX: Use OPENAI_API_KEY instead of OPENROUTER_API_KEY (consistent with daily-tasks.service.ts)
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim() && !apiKey.includes('your-')) {
      this.openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
          'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || 'https://interviewai.pro',
          'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || 'InterviewAI Pro',
        },
      });
      this.logger.log('✅ OpenAI/OpenRouter client initialized successfully');
    } else {
      this.logger.warn('⚠️  OPENAI_API_KEY not configured - pool generation will be skipped!');
    }
  }

  /**
   * 🕐 CRON: Background Question Generation
   * 
   * Runs every 30 minutes to maintain question pool
   * Generates questions for position/type/domain combinations that are running low
   */
  @Cron('*/30 * * * *', {
    name: 'refill_question_pool',
    timeZone: 'Asia/Tashkent',
  })
  async refillQuestionPool(): Promise<void> {
    const lockKey = 'cron:question-pool:refill';
    const lockTTL = 1800; // 30 minutes

    try {
      // Distributed lock
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('Question pool refill already running, skipping');
        return;
      }

      this.logger.log('🏭 Starting question pool refill...');

      let totalGenerated = 0;
      let totalSkipped = 0;

      // Check each combination
      for (const combo of this.COMBINATIONS) {
        for (const domain of combo.domains) {
          try {
            const count = await this.questionModel.countDocuments({
              position: combo.position,
              type: combo.type,
              domain: domain,
            });

            this.logger.debug(
              `Pool status: ${combo.position}/${combo.type}/${domain} = ${count}/${this.TARGET_POOL_SIZE}`,
            );

            // Refill if below minimum
            if (count < this.MIN_POOL_SIZE) {
              const needed = this.TARGET_POOL_SIZE - count;
              const toGenerate = Math.min(needed, this.BATCH_SIZE);

              this.logger.log(
                `🔥 Pool low! Generating ${toGenerate} questions for ${combo.position}/${combo.type}/${domain}`,
              );

              const generated = await this.generateQuestionsForCombination(
                combo.position,
                combo.type,
                domain,
                toGenerate,
              );

              totalGenerated += generated;
            } else {
              totalSkipped++;
            }

            // Rate limiting: 500ms between batches
            await this.delay(500);
          } catch (error: any) {
            this.logger.error(
              `Failed to refill ${combo.position}/${combo.type}/${domain}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log(
        `✅ Question pool refill complete: ${totalGenerated} generated, ${totalSkipped} skipped`,
      );
    } catch (error: any) {
      this.logger.error(`Question pool refill failed: ${error.message}`, error.stack);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Generate multiple questions for a specific combination
   */
  private async generateQuestionsForCombination(
    position: string,
    type: string,
    domain: string,
    count: number,
  ): Promise<number> {
    if (!this.openai) {
      this.logger.warn('OpenRouter not configured, skipping generation');
      return 0;
    }

    let generated = 0;

    for (let i = 0; i < count; i++) {
      try {
        const question = await this.generateSingleQuestion(position, type, domain);

        if (question) {
          await this.questionModel.create({
            question: question,
            position: position,
            type: type,
            domain: domain,
            techStacks: [domain], // Simplified
            difficulty: this.mapPositionToDifficulty(position),
            timesUsed: 0,
            averageScore: 0,
            createdAt: new Date(),
          });

          generated++;
          this.logger.debug(`✅ Generated question ${i + 1}/${count}`);
        }

        // Rate limiting: 1 second between API calls
        await this.delay(1000);
      } catch (error: any) {
        this.logger.error(`Failed to generate question ${i + 1}: ${error.message}`);
      }
    }

    return generated;
  }

  /**
   * Generate a single question using AI
   */
  private async generateSingleQuestion(
    position: string,
    type: string,
    domain: string,
  ): Promise<string | null> {
    const prompt = this.buildPrompt(position, type, domain);

    try {
      const response = await this.openai.chat.completions.create({
        model: OPENROUTER_MODELS['gpt-4o-mini'], // Fast and cheap
        messages: [
          {
            role: 'system',
            content:
              'You are an expert technical interviewer. Generate realistic, practical interview questions. ' +
              'Return ONLY the question text, no additional formatting or explanation.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.9, // High creativity for diverse questions
        max_tokens: 200,
      });

      const question = response.choices[0]?.message?.content?.trim();

      // Validation
      if (!question || question.length < 20 || question.length > 1000) {
        this.logger.warn('Generated question invalid length');
        return null;
      }

      return question;
    } catch (error: any) {
      this.logger.error(`AI generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Build prompt for question generation
   */
  private buildPrompt(position: string, type: string, domain: string): string {
    const positionContext = {
      junior: '1-2 years experience, entry-level',
      mid: '3-5 years experience, intermediate',
      senior: '5+ years experience, advanced',
      lead: '7+ years experience, leadership',
    }[position] || 'intermediate';

    if (type === 'technical') {
      return `Generate a technical interview question for a ${positionContext} ${domain} developer. 
The question should test practical coding knowledge, problem-solving, or system understanding. 
Make it realistic and relevant to modern ${domain} development.`;
    } else if (type === 'behavioral') {
      return `Generate a behavioral interview question for a ${positionContext} software engineer. 
Focus on teamwork, communication, conflict resolution, or professional growth. 
Make it situation-based (STAR method compatible).`;
    } else if (type === 'system_design') {
      return `Generate a system design question for a ${positionContext} engineer. 
Ask them to design a scalable system, considering architecture, databases, APIs, and scalability. 
Make it realistic and suitable for ${position} level.`;
    }

    return `Generate an interview question for ${position} ${type} developer.`;
  }

  /**
   * Map position to difficulty level
   */
  private mapPositionToDifficulty(position: string): string {
    return {
      junior: 'easy',
      mid: 'medium',
      senior: 'hard',
      lead: 'expert',
    }[position] || 'medium';
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 🔍 DEBUG: Check pool status
   */
  async getPoolStatus(): Promise<any> {
    const stats: Array<{
      position: string;
      type: string;
      domain: string;
      count: number;
      target: number;
      percentage: number;
      status: string;
    }> = [];

    for (const combo of this.COMBINATIONS) {
      for (const domain of combo.domains) {
        const count = await this.questionModel.countDocuments({
          position: combo.position,
          type: combo.type,
          domain: domain,
        });

        stats.push({
          position: combo.position,
          type: combo.type,
          domain: domain,
          count: count,
          target: this.TARGET_POOL_SIZE,
          percentage: Math.round((count / this.TARGET_POOL_SIZE) * 100),
          status: count >= this.MIN_POOL_SIZE ? '✅' : '⚠️',
        });
      }
    }

    return stats;
  }
}
