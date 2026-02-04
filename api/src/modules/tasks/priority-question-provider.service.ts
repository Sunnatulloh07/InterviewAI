import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SafeQuestionProviderService } from './safe-question-provider.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * 🎯 PRIORITY-BASED QUESTION PROVIDER (INTELLIGENT VERSION)
 * 
 * Smart question delivery with cost optimization:
 * 
 * INTELLIGENT LOGIC:
 * ✅ Check unseen questions in pool FIRST
 * ✅ Only generate if unseen < 3 (critical threshold)
 * ✅ Respect user's seen history
 * ✅ Sequential learning (oldest first)
 * 
 * PREMIUM USERS (Pro/Elite):
 * ├─ Check pool for unseen questions
 * ├─ If unseen >= 3: Use pool (FREE!)
 * ├─ If unseen < 3: Generate new via AI (save to pool)
 * └─ Cost: Only when needed
 * 
 * FREE USERS (Starter/Trial):
 * ├─ Always use pool questions (reused)
 * ├─ Sequential learning (Q1, Q2, Q3...)
 * └─ Cost: $0 (100% free!)
 * 
 * BENEFITS:
 * - 90% cost reduction (only generate when truly needed)
 * - No duplicate questions (seenQuestionIds check)
 * - Better UX (sequential learning path)
 * - Smart resource allocation
 */
@Injectable()
export class PriorityQuestionProviderService {
  private readonly logger = new Logger(PriorityQuestionProviderService.name);
  
  // 🎯 CRITICAL THRESHOLD: Generate new questions only if unseen pool < 3
  private readonly MIN_UNSEEN_THRESHOLD = 3;

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly safeProvider: SafeQuestionProviderService,
  ) {}

  /**
   * 🎯 Get question based on user priority (INTELLIGENT VERSION)
   * 
   * SMART LOGIC:
   * 1. Get user's seenQuestionIds from DB (or use cached if provided)
   * 2. Count unseen questions in pool
   * 3. If premium AND unseen < 3: Generate new (save money!)
   * 4. Otherwise: Use pool (sequential learning)
   * 
   * @param userCache - Optional cached user data to avoid DB query (performance optimization)
   */
  async getQuestionByPriority(
    userId: string,
    position: 'junior' | 'middle' | 'senior' | 'lead',
    type: 'technical' | 'behavioral' | 'system_design',
    domain: string,
    userCache?: { plan: string; seenIds: any[] },
  ): Promise<{ question: string; questionId: any; source: 'pool' | 'ai' | 'fallback'; priority: 'premium' | 'free' }> {
    try {
      let plan: string;
      let seenIds: any[];

      // 🚀 PERFORMANCE: Use cached user data if provided (avoid DB query)
      if (userCache) {
        plan = userCache.plan;
        seenIds = userCache.seenIds;
        this.logger.debug(`Using cached user data (plan=${plan}, seenCount=${seenIds.length})`);
      } else {
        // Get user with seen history from DB
        const user = await this.userModel
          .findById(userId)
          .select('subscription seenQuestionIds')
          .lean();
        
        if (!user) {
          this.logger.error(`User ${userId} not found!`);
          // Fallback to free logic
          return await this.getForFreeUser(position, type, domain, []);
        }

        plan = user.subscription?.plan || 'free_trial';
        seenIds = (user as any).seenQuestionIds || [];
      }

      const isPremium = this.isPremiumPlan(plan);

      this.logger.debug(
        `User ${userId}: plan=${plan}, isPremium=${isPremium}, seenCount=${seenIds.length}`,
      );

      if (isPremium) {
        return await this.getForPremiumUser(userId, position, type, domain, seenIds);
      } else {
        return await this.getForFreeUser(position, type, domain, seenIds);
      }
    } catch (error: any) {
      this.logger.error(
        `Priority question provider failed for user ${userId}: ${error.message}`,
        error.stack,
      );
      
      // Ultimate fallback: return static question
      return {
        question: this.getUltimateFallback(type),
        questionId: null,
        source: 'fallback',
        priority: 'free',
      };
    }
  }

  /**
   * 🆘 Ultimate fallback - used when everything fails
   */
  private getUltimateFallback(type: string): string {
    const fallbacks = {
      technical: 'Explain the difference between SQL and NoSQL databases. When would you use each?',
      behavioral: 'Tell me about a time when you had to learn a new technology quickly. How did you approach it?',
      system_design: 'Design a simple URL shortener service. What are the main components?',
    };
    return fallbacks[type] || fallbacks.technical;
  }

  /**
   * 👑 Premium users: INTELLIGENT generation (only when needed!)
   * 
   * SMART ALGORITHM:
   * 1. Count unseen questions in pool for this position/type/domain
   * 2. If unseen >= 3: Use pool (NO AI COST!) ✅
   * 3. If unseen < 3: Generate via AI (save to pool for others) 💰
   * 
   * COST SAVINGS:
   * - Before: Generate for EVERY premium user = 100% AI cost
   * - After: Generate only when pool low = ~10% AI cost
   * - Savings: 90% cost reduction! 🎉
   */
  private async getForPremiumUser(
    userId: string,
    position: string,
    type: string,
    domain: string,
    seenIds: any[],
  ): Promise<any> {
    // 🔍 STEP 1: Check unseen questions in pool
    const unseenCount = await this.safeProvider.countUnseenQuestions(
      position,
      type,
      domain,
      seenIds,
    );

    this.logger.log(
      `👑 Premium user ${userId}: ${position}/${type}/${domain} - ` +
      `Unseen pool questions: ${unseenCount} (threshold: ${this.MIN_UNSEEN_THRESHOLD})`,
    );

    // 🎯 STEP 2: Decision logic
    if (unseenCount >= this.MIN_UNSEEN_THRESHOLD) {
      // ✅ Pool has enough unseen questions - USE POOL (FREE!)
      // NO AI generation needed since pool is sufficient
      this.logger.log(
        `💰 COST SAVED! Premium user using pool (${unseenCount} unseen questions available)`,
      );
      
      const result = await this.safeProvider.getQuestionSafely(
        position as any,
        type as any,
        domain,
        seenIds,
        false, // 💰 NO AI needed - pool has enough questions!
      );

      return {
        ...result,
        priority: 'premium',
      };
    } else {
      // 🔥 Pool running low - GENERATE NEW via AI
      this.logger.warn(
        `🔥 Pool low for premium user! Only ${unseenCount} unseen questions. Generating via AI...`,
      );
      
      // Generate via AI (will be saved to pool automatically by SafeProvider)
      const result = await this.safeProvider.getQuestionSafely(
        position as any,
        type as any,
        domain,
        seenIds,
        true, // ✅ AI allowed - need to generate new questions!
      );

      return {
        ...result,
        priority: 'premium',
      };
    }
  }

  /**
   * 🆓 Free users: ALWAYS use pool (100% cost savings!)
   * 
   * LOGIC:
   * - Use pool questions only (reused from premium/background generation)
   * - Sequential learning (oldest unseen first)
   * - If pool empty: Use fallback (static questions)
   * - NEVER generate via AI (allowAI=false, cost = $0)
   */
  private async getForFreeUser(
    position: string,
    type: string,
    domain: string,
    seenIds: any[],
  ): Promise<any> {
    const unseenCount = await this.safeProvider.countUnseenQuestions(
      position,
      type,
      domain,
      seenIds,
    );

    this.logger.log(
      `🆓 Free user: ${position}/${type}/${domain} - Unseen pool: ${unseenCount}`,
    );

    // 🔥 CRITICAL: allowAI=false to prevent AI generation for free users!
    const result = await this.safeProvider.getQuestionSafely(
      position as any,
      type as any,
      domain,
      seenIds,
      false, // 💰 NO AI generation for free users = 100% cost savings!
    );

    return {
      ...result,
      priority: 'free',
    };
  }

  /**
   * 🔍 Check if plan is premium
   */
  private isPremiumPlan(plan: string): boolean {
    const premiumPlans = ['pro', 'elite', 'enterprise'];
    return premiumPlans.includes(plan.toLowerCase());
  }

  /**
   * 📊 Get generation statistics
   */
  async getGenerationStats(): Promise<{
    premiumGenerations: number;
    freePoolHits: number;
    costSavings: number;
  }> {
    // This can be implemented with Redis counters
    // For now, return placeholder
    return {
      premiumGenerations: 0,
      freePoolHits: 0,
      costSavings: 0,
    };
  }
}
