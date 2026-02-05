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

/**
 * 🎯 USER-AWARE POOL MANAGER
 * 
 * Tracks oldest/most active users and proactively generates questions
 * BEFORE they run out (instead of runtime generation)
 * 
 * LOGIC:
 * 1. Every 30 minutes, check TOP 100 oldest active paid users
 * 2. For each user: count UNSEEN questions in pool
 * 3. If unseen < 3: proactively generate 10 new questions
 * 4. By 09:00 AM, pool is ready for ALL users!
 * 
 * BENEFITS:
 * - Proactive (not reactive)
 * - Cheaper (batch generation vs runtime)
 * - Faster delivery (no wait at 09:00)
 * - Scalable (tracks actual consumption)
 */
@Injectable()
export class UserAwarePoolManagerService {
  private readonly logger = new Logger(UserAwarePoolManagerService.name);
  private readonly openai: OpenAI | null;
  
  // 🎯 How many users to track (oldest/most active)
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
          const language = (user as any).preferences?.language || (user as any).language || 'en';
          const seenIds = (user as any).seenQuestionIds || [];

          // Check for each task type
          const types: Array<'technical' | 'behavioral' | 'system_design'> = 
            ['technical', 'behavioral'];
          
          if (position !== 'junior') {
            types.push('system_design');
          }

          for (const type of types) {
            const domain = this.detectDomain(user.profile?.techStack || []);
            const key = `${position}|${type}|${domain}|${language}`;

            // Count unseen questions for this combination
            const unseenCount = await this.questionModel.countDocuments({
              position,
              type,
              domain,
              language,
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
          const [position, type, domain, language] = key.split('|');
          
          this.logger.log(
            `🏭 Generating ${count} questions for ${key}`,
          );

          const genCount = await this.generateQuestions(
            position,
            type,
            domain,
            language,
            count,
          );

          generated += genCount;
          await this.delay(1000); // Rate limiting
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
      .select('_id profile seenQuestionIds language preferences')
      .lean()
      .exec();
  }

  /**
   * Generate questions for a combination
   */
  private async generateQuestions(
    position: string,
    type: string,
    domain: string,
    language: string,
    count: number,
  ): Promise<number> {
    if (!this.openai) {
      return 0;
    }

    let generated = 0;

    for (let i = 0; i < count; i++) {
      try {
        const question = await this.generateSingleQuestion(
          position,
          type,
          domain,
          language,
        );

        if (question) {
          await this.questionModel.create({
            question,
            position,
            type,
            domain,
            language,
            techStacks: [domain],
            timesUsed: 0,
            metadata: {
              generatedBy: 'z-ai/glm-4-32b',
              tokensUsed: 0,
              generationTime: 0,
              cost: 0.00001,
            },
          });

          generated++;
        }

        await this.delay(1000); // Rate limiting
      } catch (error: any) {
        this.logger.error(`Generation failed: ${error.message}`);
      }
    }

    return generated;
  }

  /**
   * Generate single question (simplified)
   */
  private async generateSingleQuestion(
    position: string,
    type: string,
    domain: string,
    language: string,
  ): Promise<string | null> {
    try {
      const prompt = `Generate a ${type} interview question for ${position} ${domain} developer in ${language} language.`;
      
      const response = await this.openai.chat.completions.create({
        model: OPENROUTER_MODELS['glm-4-32b'],
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 200,
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error: any) {
      this.logger.error(`AI generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Detect domain from tech stack
   */
  private detectDomain(techStack: string[]): string {
    if (!techStack || techStack.length === 0) return 'general';
    
    const stack = techStack[0].toLowerCase();
    if (['react', 'vue', 'angular'].some(t => stack.includes(t))) return 'frontend';
    if (['node', 'express', 'django'].some(t => stack.includes(t))) return 'backend';
    if (['react-native', 'flutter', 'swift'].some(t => stack.includes(t))) return 'mobile';
    
    return 'general';
  }

  /**
   * Helper: delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
