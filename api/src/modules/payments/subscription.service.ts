import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { USAGE_LIMITS, PLAN_FEATURES, SubscriptionPlan } from '@common/constants';

/**
 * Service for managing subscriptions, trials, and usage
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Check if user's trial has expired
   */
  async isTrialExpired(userId: string): Promise<boolean> {
    const user = await this.userModel.findById(userId).select('subscription');
    if (!user?.subscription) return false;

    if (user.subscription.plan !== 'free_trial') return false;

    const now = new Date();
    const trialEnd = user.subscription.trialEndsAt;
    return trialEnd ? now > trialEnd : false;
  }

  /**
   * Get remaining trial days
   */
  async getTrialDaysRemaining(userId: string): Promise<number> {
    const user = await this.userModel.findById(userId).select('subscription');
    if (!user?.subscription?.trialEndsAt) return 0;

    if (user.subscription.plan !== 'free_trial') return 0;

    const now = new Date();
    const trialEnd = new Date(user.subscription.trialEndsAt);
    const diffMs = trialEnd.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  /**
   * Get user's current plan limits
   */
  getPlanLimits(plan: SubscriptionPlan) {
    return USAGE_LIMITS[plan] || USAGE_LIMITS.free_trial;
  }

  /**
   * Get user's current plan features
   */
  getPlanFeatures(plan: SubscriptionPlan) {
    return PLAN_FEATURES[plan] || PLAN_FEATURES.free_trial;
  }

  /**
   * Check if user can use a feature
   */
  async canUseFeature(userId: string, feature: string): Promise<boolean> {
    const user = await this.userModel.findById(userId).select('subscription');
    if (!user?.subscription) return false;

    // Check trial expiry first
    if (await this.isTrialExpired(userId)) return false;

    const plan = user.subscription.plan as SubscriptionPlan;
    const features = this.getPlanFeatures(plan);
    return !!features[feature as keyof typeof features];
  }

  /**
   * Check if user can use voice messages
   */
  async canUseVoice(userId: string, isLiveInterview: boolean): Promise<boolean> {
    const user = await this.userModel.findById(userId).select('subscription');
    if (!user?.subscription) return false;

    if (await this.isTrialExpired(userId)) return false;

    const plan = user.subscription.plan as SubscriptionPlan;
    const features = this.getPlanFeatures(plan);

    if (isLiveInterview) {
      return !!features.voiceInLive;
    }
    return !!features.voiceMessages;
  }

  /**
   * Check and update usage, returns true if within limits
   */
  async checkAndIncrementUsage(
    userId: string,
    usageType: 'mockInterviews' | 'liveInterviewMinutes' | 'cvAnalyses' | 'chromeQuestions',
    amount: number = 1,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const user = await this.userModel.findById(userId).select('subscription usage');
    if (!user) {
      return { allowed: false, current: 0, limit: 0 };
    }

    // Check trial expiry
    if (await this.isTrialExpired(userId)) {
      return { allowed: false, current: 0, limit: 0 };
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const limits = this.getPlanLimits(plan);
    const limit = limits[usageType as keyof typeof limits];

    const usageFieldMap: Record<string, string> = {
      mockInterviews: 'mockInterviewsThisMonth',
      liveInterviewMinutes: 'liveInterviewMinutesThisMonth',
      cvAnalyses: 'cvAnalysesThisMonth',
      chromeQuestions: 'chromeQuestionsThisMonth',
    };

    const field = usageFieldMap[usageType];
    const currentUsage = user.usage?.[field as keyof typeof user.usage] || 0;

    // -1 means unlimited
    if (typeof limit === 'number' && (currentUsage as number) + amount > limit) {
      return {
        allowed: false,
        current: currentUsage as number,
        limit: limit as number,
      };
    }

    // Increment usage
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { [`usage.${field}`]: amount },
    });

    return {
      allowed: true,
      current: (currentUsage as number) + amount,
      limit: typeof limit === 'number' ? limit : -1,
    };
  }

  /**
   * Add live interview minutes used
   */
  async addLiveMinutes(userId: string, minutes: number): Promise<boolean> {
    const result = await this.checkAndIncrementUsage(userId, 'liveInterviewMinutes', minutes);
    if (!result.allowed) {
      this.logger.warn(
        `Live interview minutes limit reached for user ${userId}: ${result.current}/${result.limit}`,
      );
    }
    return result.allowed;
  }

  /**
   * Reset monthly usage (called by cron job)
   */
  async resetMonthlyUsage(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        'usage.mockInterviewsThisMonth': 0,
        'usage.liveInterviewMinutesThisMonth': 0,
        'usage.cvAnalysesThisMonth': 0,
        'usage.chromeQuestionsThisMonth': 0,
        'usage.aiTokensThisMonth': 0,
        'usage.lastResetDate': new Date(),
      },
    });
  }

  /**
   * Upgrade user plan
   */
  async upgradePlan(
    userId: string,
    newPlan: SubscriptionPlan,
    billingCycle: 'monthly' | 'annual' = 'monthly',
  ): Promise<void> {
    const now = new Date();
    const endDate = billingCycle === 'annual'
      ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        'subscription.plan': newPlan,
        'subscription.status': 'active',
        'subscription.startDate': now,
        'subscription.endDate': endDate,
        'subscription.billingCycle': billingCycle,
        // Clear trial fields when upgrading
        'subscription.trialStartDate': null,
        'subscription.trialEndsAt': null,
      },
    });

    this.logger.log(`User ${userId} upgraded to ${newPlan} (${billingCycle})`);
  }

  /**
   * Get user subscription status summary
   */
  async getSubscriptionStatus(userId: string): Promise<{
    plan: SubscriptionPlan;
    status: string;
    isTrialExpired: boolean;
    trialDaysRemaining: number;
    limits: Record<string, number | boolean>;
    features: Record<string, boolean>;
    usage: any;
  }> {
    const user = await this.userModel.findById(userId).select('subscription usage');
    if (!user) {
      throw new Error('User not found');
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const trialExpired = await this.isTrialExpired(userId);
    const trialDays = await this.getTrialDaysRemaining(userId);

    return {
      plan,
      status: user.subscription?.status || 'trialing',
      isTrialExpired: trialExpired,
      trialDaysRemaining: trialDays,
      limits: this.getPlanLimits(plan),
      features: this.getPlanFeatures(plan),
      usage: user.usage,
    };
  }
}
