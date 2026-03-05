import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NormalizedProfileDto } from './dto/normalized-profile.dto';
import { detectDomain } from '@common/utils/detect-domain';
import {
  buildProfileNormalizationSystemPrompt,
  buildProfileNormalizationUserPrompt,
  AI_SERVICE_CONFIG,
} from '@common/constants/ai-prompts.constant';

@Injectable()
export class ProfileNormalizationService {
  private readonly logger = new Logger(ProfileNormalizationService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Normalizes free-text user input into a structured profile object.
   * Uses AI to map text to system enums for Position, Goal, and Tech Stack.
   *
   * @param text User's description (e.g., "I'm a senior react dev looking for a job")
   * @returns NormalizedProfileDto with standard enums
   */
  async normalizeProfile(text: string): Promise<NormalizedProfileDto> {
    const startTime = Date.now();
    this.logger.debug(`Normalizing profile text: "${text}"`);

    // Enterprise-grade prompts from centralized constants
    const systemPrompt = buildProfileNormalizationSystemPrompt();
    const userPrompt = buildProfileNormalizationUserPrompt(text);

    try {
      const response = await axios.post(
        this.configService.get('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.configService.get('OPENROUTER_MODEL') || AI_SERVICE_CONFIG.profileNormalization.defaultModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: AI_SERVICE_CONFIG.profileNormalization.temperature,
          max_tokens: AI_SERVICE_CONFIG.profileNormalization.maxTokens,
          response_format: AI_SERVICE_CONFIG.profileNormalization.responseFormat,
        },
        {
          headers: {
            Authorization: `Bearer ${this.configService.get('OPENAI_API_KEY')}`,
            'HTTP-Referer': this.configService.get('OPENROUTER_HTTP_REFERER'),
            'X-Title': this.configService.get('OPENROUTER_X_TITLE'),
          },
          timeout: AI_SERVICE_CONFIG.profileNormalization.timeoutMs,
        },
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from AI provider');
      }

      const parsed: any = JSON.parse(content);

      // Validate and sanitize output
      const normalized: NormalizedProfileDto = {
        position: this.validateEnum(
          parsed.position,
          ['junior', 'middle', 'senior', 'lead'],
          'junior',
        ),
        goal: this.validateEnum(
          parsed.goal,
          ['job_search', 'career_growth', 'learning'],
          'career_growth',
        ),
        domain: this.validateEnum(
          parsed.domain,
          ['frontend', 'backend', 'mobile', 'fullstack', 'devops', 'ai_ml', 'data', 'qa', 'general'],
          undefined,
        ),
        techStack: Array.isArray(parsed.techStack)
          ? parsed.techStack.filter((s: any) => typeof s === 'string')
          : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };

      // Auto-detect domain from techStack if not provided
      if (!normalized.domain && normalized.techStack.length > 0) {
        normalized.domain = detectDomain(normalized.techStack) as any;
        this.logger.debug(`Auto-detected domain: ${normalized.domain}`);
      }

      this.logger.log(
        `Profile normalized in ${Date.now() - startTime}ms: ${JSON.stringify(normalized)}`,
      );

      return normalized;
    } catch (error: any) {
      this.logger.error(`Profile normalization failed: ${error.message}`);
      // Return safe default on error
      return {
        position: 'junior',
        goal: 'career_growth',
        techStack: [],
        confidence: 0,
      };
    }
  }

  private validateEnum(value: any, allowed: string[], fallback: any): any {
    if (allowed.includes(value)) {
      return value;
    }
    return fallback;
  }

  /**
   * Validate if profile data is sufficient for personalized task generation
   * Production-ready validation with detailed feedback
   */
  async validateProfileCompleteness(
    normalized: NormalizedProfileDto,
  ): Promise<{
    isComplete: boolean;
    missing: string[];
    message: string;
    suggestions: string[];
  }> {
    const missing: string[] = [];
    const suggestions: string[] = [];

    // Check position (default 'junior' is considered incomplete unless confirmed)
    if (!normalized.position || normalized.position === 'junior') {
      if (!normalized.confidence || normalized.confidence < 0.6) {
        missing.push('position');
        suggestions.push('Specify your seniority level: junior, middle, senior, or lead');
      }
    }

    // Check techStack (must have at least 2 technologies for good task matching)
    if (!normalized.techStack || normalized.techStack.length < 2) {
      missing.push('techStack');
      suggestions.push(
        'List at least 2 technologies you work with (e.g., React, Node.js, Python)',
      );
    }

    // Check domain (optional but highly recommended)
    if (!normalized.domain) {
      suggestions.push(
        'Specifying your domain (frontend, backend, mobile, etc.) helps generate better tasks',
      );
    }

    // Check overall confidence
    if (normalized.confidence < 0.6) {
      missing.push('clarity');
      suggestions.push('Provide more specific details about your role and technologies');
    }

    const isComplete = missing.length === 0;

    return {
      isComplete,
      missing,
      message: isComplete
        ? 'Profile is complete and ready for personalized task generation'
        : `Insufficient data. Missing: ${missing.join(', ')}`,
      suggestions,
    };
  }

  /**
   * Detect domain from techStack if not explicitly provided
   * Delegates to shared utility for consistent domain detection across all services.
   */
  detectDomainFromTechStack(techStack: string[]): string {
    return detectDomain(techStack);
  }
}
