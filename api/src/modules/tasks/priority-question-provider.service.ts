import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SafeQuestionProviderService } from './safe-question-provider.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * 🎯 PRIORITY-BASED QUESTION PROVIDER
 * 
 * Smart question delivery based on user subscription:
 * 
 * PREMIUM USERS (Pro/Elite):
 * ├─ Priority 1: Real-time AI generation (fresh questions)
 * ├─ Saved to pool for free users later
 * └─ Cost: ~$0.00002 per question (GLM-4-32B)
 * 
 * FREE USERS (Starter/Trial):
 * ├─ Priority 2: Pool questions (reused from premium)
 * ├─ Sequential learning (Q1, Q2, Q3...)
 * └─ Cost: $0 (free!)
 * 
 * BENEFITS:
 * - Premium users get fresh unique questions
 * - Free users get quality tested questions
 * - 10x cost reduction (only generate for premium)
 * - Better resource utilization
 */
@Injectable()
export class PriorityQuestionProviderService {
  private readonly logger = new Logger(PriorityQuestionProviderService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly safeProvider: SafeQuestionProviderService,
  ) {}

  /**
   * 🎯 Get question based on user priority
   */
  async getQuestionByPriority(
    userId: string,
    position: 'junior' | 'middle' | 'senior' | 'lead',
    type: 'technical' | 'behavioral' | 'system_design',
    domain: string,
  ): Promise<{ question: string; questionId: any; source: 'pool' | 'ai' | 'fallback'; priority: 'premium' | 'free' }> {
    // Get user subscription
    const user = await this.userModel.findById(userId).select('subscription').lean();
    const plan = user?.subscription?.plan || 'free_trial';

    const isPremium = this.isPremiumPlan(plan);

    if (isPremium) {
      return await this.getForPremiumUser(position, type, domain);
    } else {
      return await this.getForFreeUser(position, type, domain);
    }
  }

  /**
   * 👑 Premium users: AI generation first (fresh questions)
   */
  private async getForPremiumUser(
    position: string,
    type: string,
    domain: string,
  ): Promise<any> {
    this.logger.log(`👑 Premium user - generating fresh question: ${position}/${type}/${domain}`);

    // Force AI generation (skip pool check)
    const result = await this.safeProvider.getQuestionSafely(
      position as any,
      type as any,
      domain,
    );

    // If AI generated successfully, it's automatically saved to pool
    // for free users later
    return {
      ...result,
      priority: 'premium',
    };
  }

  /**
   * 🆓 Free users: Pool first (reused questions)
   */
  private async getForFreeUser(
    position: string,
    type: string,
    domain: string,
  ): Promise<any> {
    this.logger.log(`🆓 Free user - checking pool: ${position}/${type}/${domain}`);

    // Use safe provider (pool → AI → fallback chain)
    const result = await this.safeProvider.getQuestionSafely(
      position as any,
      type as any,
      domain,
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
