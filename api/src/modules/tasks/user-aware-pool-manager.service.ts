import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENROUTER_MODELS } from '../../common/utils/openai-client.factory';
import { detectDomain } from '@common/utils/detect-domain';

/**
 * 🎯 USER-AWARE POOL MANAGER (OPTIMIZED VERSION)
 * 
 * CRITICAL LOGIC:
 * 1. Every 30 minutes, check TOP 100 oldest active paid users
 * 2. For each user:
 *    - Get position (junior/middle/senior/lead)
 *    - Get techStack (specific technologies from CV analysis)
 *    - Count UNSEEN questions matching position + techStack
 * 3. If unseen < 3: generate 10 new questions
 *    - ONLY for this user's specific position + techStack
 *    - NOT for other positions or domains
 * 4. Questions generated in 3 languages (uz/ru/en)
 *    - title_uz, title_ru, title_en
 *    - question_uz, question_ru, question_en
 * 5. At 09:00 delivery, select appropriate language based on user preference
 * 
 * KEY PRINCIPLE: Generate ONLY what users actually need!
 */

@Injectable()
export class UserAwarePoolManagerService {
  private readonly logger = new Logger(UserAwarePoolManagerService.name);
  private readonly openai: OpenAI | null;
  
  // 🎯 How many users to track
  private readonly TOP_USERS_TO_TRACK = 100;
  
  // 🎯 Threshold: generate if unseen < 3
  private readonly UNSEEN_THRESHOLD = 3;
  
  // 🎯 How many to generate when pool low
  private readonly GENERATION_BATCH = 10;

  constructor(
    @InjectModel(GeneratedQuestion.name)
    private readonly questionModel: Model<GeneratedQuestionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
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
      this.logger.log('✅ User-aware pool manager initialized');
    } else {
      this.logger.warn('⚠️  API key not configured - pool generation disabled');
    }
  }

  /**
   * 🕐 CRON: User-aware pool refill
   * Runs every 30 minutes - tracks user consumption
   */
  @Cron('*/30 * * * *', {
    name: 'user_aware_pool_refill',
    timeZone: 'Asia/Tashkent',
  })
  async refillPoolBasedOnUserConsumption(): Promise<void> {
    const lockKey = 'cron:user-aware-pool:refill';
    const lockTTL = 1800; // 30 minutes

    try {
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('User-aware pool refill already running, skipping');
        return;
      }

      this.logger.log('🎯 Starting USER-AWARE pool refill...');

      // STEP 1: Get TOP oldest/most active PAID users
      const topUsers = await this.getTopUsers();
      this.logger.log(`Found ${topUsers.length} top users to track`);

      let generated = 0;
      const poolNeedsGeneration: Map<string, number> = new Map();

      // STEP 2: For each user, check unseen count
      for (const user of topUsers) {
        try {
          const position = user.profile?.position || 'junior';
          const techStack = user.profile?.techStack || [];
          const seenIds = (user as any).seenQuestionIds || [];

          // Check for each task type
          const types: Array<'technical' | 'behavioral' | 'system_design'> = 
            ['technical', 'behavioral'];
          
          if (position !== 'junior') {
            types.push('system_design');
          }

          for (const type of types) {
            // 🔥 KEY: Use specific techStack (not domain) for matching
            // Use JSON.stringify to safely encode techStack elements that may contain commas
            const key = `${position}|${type}|${JSON.stringify(techStack)}`;

            // Count unseen questions matching this specific user
            const unseenCount = await this.questionModel.countDocuments({
              position,
              type,
              $or: [
                { techStacks: { $in: techStack } }, // Match specific tech
                { domain: detectDomain(techStack) }, // Fallback
              ],
              _id: { $nin: seenIds },
            });

            this.logger.debug(
              `User ${(user as any)._id}: ${key} → ${unseenCount} unseen`,
            );

            // If unseen < threshold, mark for generation
            if (unseenCount < this.UNSEEN_THRESHOLD) {
              const current = poolNeedsGeneration.get(key) || 0;
              poolNeedsGeneration.set(key, Math.max(current, this.GENERATION_BATCH));
              
              this.logger.log(
                `🔥 User ${(user as any)._id} needs more questions: ${key} (${unseenCount} unseen)`,
              );
            }
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to check user ${(user as any)._id}: ${error.message}`,
          );
        }
      }

      // STEP 3: Generate needed questions
      this.logger.log(
        `📊 Pool generation needed for ${poolNeedsGeneration.size} combinations`,
      );

      for (const [key, count] of poolNeedsGeneration.entries()) {
        try {
          const parts = key.split('|');
          const position = parts[0];
          const type = parts[1];
          const techStack = parts[2] ? (JSON.parse(parts[2]) as string[]) : [];
          
          this.logger.log(
            `🏭 Generating ${count} questions for ${key}`,
          );

          const genCount = await this.generateQuestions(
            position,
            type,
            techStack,
            count,
          );

          generated += genCount;
          await this.delay(1500); // Rate limiting for 3-language generation
        } catch (error: any) {
          this.logger.error(
            `Failed to generate for ${key}: ${error.message}`,
          );
        }
      }

      this.logger.log(
        `✅ User-aware pool refill complete: ${generated} questions generated`,
      );
    } catch (error: any) {
      this.logger.error(
        `User-aware pool refill failed: ${error.message}`,
        error.stack,
      );
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Get TOP oldest active PAID users
   */
  private async getTopUsers(): Promise<any[]> {
    const now = new Date();
    
    return await this.userModel
      .find({
        'subscription.status': 'active',
        'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
        $or: [
          { 'subscription.endDate': { $exists: false } },
          { 'subscription.endDate': null },
          { 'subscription.endDate': { $gt: now } },
        ],
        isBlocked: false,
        'engagement.isBotBlocked': { $ne: true },
      })
      .sort({ createdAt: 1 }) // Oldest first
      .limit(this.TOP_USERS_TO_TRACK)
      .select('_id profile seenQuestionIds') // Profile includes position and techStack
      .lean()
      .exec();
  }

  /**
   * Generate questions for a specific combination
   */
  private async generateQuestions(
    position: string,
    type: string,
    techStack: string[],
    count: number,
  ): Promise<number> {
    if (!this.openai) {
      return 0;
    }

    let generated = 0;
    const domain = detectDomain(techStack);

    for (let i = 0; i < count; i++) {
      try {
        const result = await this.generateSingleQuestion(
          position,
          type,
          domain,
          techStack,
        );

        if (result) {
          await this.questionModel.create({
            title_uz: result.title_uz,
            title_ru: result.title_ru,
            title_en: result.title_en,
            question_uz: result.question_uz,
            question_ru: result.question_ru,
            question_en: result.question_en,
            position,
            type,
            domain,
            techStacks: techStack.length > 0 ? techStack : [domain],
            timesUsed: 0,
            metadata: {
              generatedBy: 'z-ai/glm-4-32b',
              tokensUsed: 0,
              generationTime: 0,
              cost: 0.00003, // 3x cost for 3 languages
            },
          });

          generated++;
        }

        await this.delay(2000); // Longer delay for 3-language generation
      } catch (error: any) {
        this.logger.error(`Generation failed: ${error.message}`);
      }
    }

    return generated;
  }

  /**
   * Generate single question in 3 languages with title
   */
  private async generateSingleQuestion(
    position: string,
    type: string,
    domain: string,
    techStack: string[],
  ): Promise<{
    title_uz: string; title_ru: string; title_en: string;
    question_uz: string; question_ru: string; question_en: string;
  } | null> {
    try {
      const techStackStr = techStack.length > 0 
        ? techStack.join(', ') 
        : domain;
      
      const typeMap = {
        technical: 'technical interview',
        behavioral: 'behavioral interview',
        system_design: 'system design interview',
      };
      
      const prompt = `Generate a ${typeMap[type]} question for a ${position} developer specializing in ${techStackStr}.

Generate in 3 languages (Uzbek, Russian, English):

Requirements:
- Professional and challenging
- Real-world scenario specific to ${techStackStr}
- Clear and concise
- Include a short title (2-5 words)
- Each language should be culturally appropriate

Output ONLY valid JSON:
{
  "title_uz": "Qisqa sarlavha o'zbek tilida",
  "title_ru": "Краткое название на русском",
  "title_en": "Short title in English",
  "question_uz": "To'liq savol o'zbek tilida",
  "question_ru": "Полный вопрос на русском языке",
  "question_en": "Full question in English"
}`;
      
      const response = await this.openai!.chat.completions.create({
        model: OPENROUTER_MODELS['glm-4-32b'],
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 600,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return null;

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      
      // Validate all fields present
      if (!result.title_uz || !result.title_ru || !result.title_en ||
          !result.question_uz || !result.question_ru || !result.question_en) {
        this.logger.warn('Missing fields in AI response');
        return null;
      }

      return result;
    } catch (error: any) {
      this.logger.error(`AI generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect domain from tech stack (checks ALL technologies, not just first)
   */
  // detectDomain() moved to @common/utils/detect-domain.ts

  /**
   * Helper: delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
