import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  USAGE_LIMITS,
  PLAN_FEATURES,
  SubscriptionPlan,
  COMPLETE_PLAN_LIMITS,
  getPlanLimits as getCompletePlanLimits,
  PlanLimits,
} from '@common/constants';
import { Cron } from '@nestjs/schedule';

/**
 * Service for managing subscriptions, trials, and usage
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

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
   * ✅ STEP 4 FIX: Now uses COMPLETE_PLAN_LIMITS (single source of truth)
   */
  getPlanLimits(plan: SubscriptionPlan): PlanLimits {
    return getCompletePlanLimits(plan);
  }

  /**
   * Get legacy usage limits (for backward compatibility)
   * @deprecated Use getPlanLimits() instead
   */
  getLegacyPlanLimits(plan: SubscriptionPlan) {
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
   * Check and update usage, returns true if within limits.
   *
   * FIX #51 (CRITICAL): Previously `limits[usageType]` returned a nested
   * object (e.g. `{ perMonth: 10, questionsPerInterview: 15 }`) or
   * `undefined`, not a number.  `typeof limit === 'number'` was always
   * false, so limits were NEVER enforced — users could use features
   * unlimited.
   *
   * Now correctly extracts the numeric limit from the PlanLimits structure.
   */
  async checkAndIncrementUsage(
    userId: string,
    usageType: 'mockInterviews' | 'liveInterviewMinutes' | 'cvAnalyses' | 'chromeQuestions',
    amount: number = 1,
  ): Promise<{ allowed: boolean; current: number; limit: number }> {
    const user = await this.userModel.findById(userId).select('subscription usage voiceQuota');
    if (!user) {
      return { allowed: false, current: 0, limit: 0 };
    }

    // Check trial expiry
    if (await this.isTrialExpired(userId)) {
      return { allowed: false, current: 0, limit: 0 };
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const limits = this.getPlanLimits(plan);

    // FIX #51: Correctly extract numeric limit from nested PlanLimits structure
    let numericLimit: number;
    switch (usageType) {
      case 'mockInterviews':
        numericLimit = limits.mockInterviews.perMonth;
        break;
      case 'liveInterviewMinutes':
        numericLimit = limits.voice.realVoice; // live interview uses realVoice quota
        break;
      case 'cvAnalyses':
        numericLimit = limits.cvAnalysis.perMonth;
        break;
      case 'chromeQuestions':
        // chromeQuestions not in PlanLimits — treat as unlimited for now
        numericLimit = -1;
        break;
      default:
        numericLimit = -1;
    }

    const usageFieldMap: Record<string, string> = {
      mockInterviews: 'mockInterviewsThisMonth',
      liveInterviewMinutes: 'liveInterviewMinutesThisMonth',
      cvAnalyses: 'cvAnalysesThisMonth',
      chromeQuestions: 'chromeQuestionsThisMonth',
    };

    const field = usageFieldMap[usageType];
    const currentUsage = (user.usage?.[field as keyof typeof user.usage] as number) || 0;

    // -1 means unlimited
    if (numericLimit !== -1 && currentUsage + amount > numericLimit) {
      return {
        allowed: false,
        current: currentUsage,
        limit: numericLimit,
      };
    }

    // Increment usage
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { [`usage.${field}`]: amount },
    });

    return {
      allowed: true,
      current: currentUsage + amount,
      limit: numericLimit,
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
   * Get live interview status (allowed, remaining minutes)
   */
  async getLiveInterviewStatus(userId: string): Promise<{
    allowed: boolean;
    reason?: 'expired' | 'limit_reached';
    remainingMinutes: number;
    plan: SubscriptionPlan;
    limit: number;
    usage: number;
  }> {
    const user = await this.userModel.findById(userId).select('subscription usage voiceQuota');
    if (!user)
      return { allowed: false, remainingMinutes: 0, plan: 'free_trial', limit: 0, usage: 0 };

    if (await this.isTrialExpired(userId)) {
      return {
        allowed: false,
        reason: 'expired',
        remainingMinutes: 0,
        plan: (user.subscription?.plan || 'free_trial') as SubscriptionPlan,
        limit: 0,
        usage: 0,
      };
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const limits = this.getPlanLimits(plan);

    // ✅ FIX: Use voice.realVoice from new PlanLimits structure
    const limit = limits.voice.realVoice;
    const usage = user.voiceQuota?.realVoice?.used || 0;

    // -1 means unlimited
    if (limit === -1) {
      return { allowed: true, remainingMinutes: 9999, plan, limit, usage };
    }

    const remaining = Math.max(0, limit - usage);

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: 'limit_reached',
        remainingMinutes: 0,
        plan,
        limit,
        usage,
      };
    }

    return { allowed: true, remainingMinutes: remaining, plan, limit, usage };
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
   * ✅ STEP 4 FIX: Now resets voice quotas and usage counters on upgrade
   */
  async upgradePlan(
    userId: string,
    newPlan: SubscriptionPlan,
    billingCycle: 'monthly' | 'annual' = 'monthly',
  ): Promise<void> {
    const now = new Date();
    const endDate =
      billingCycle === 'annual'
        ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // ✅ Get new plan's voice quotas from COMPLETE_PLAN_LIMITS
    const planLimits = getCompletePlanLimits(newPlan);
    const nextMonthResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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

        // ✅ CRITICAL FIX: Reset voice quotas to new plan limits
        'voiceQuota.mockVoice': {
          total: planLimits.voice.mockVoice,
          used: 0,
          remaining: planLimits.voice.mockVoice,
          resetDate: nextMonthResetDate,
        },
        'voiceQuota.realVoice': {
          total: planLimits.voice.realVoice,
          used: 0,
          remaining: planLimits.voice.realVoice,
          resetDate: nextMonthResetDate,
        },

        // ✅ Reset usage counters to give fresh start on new plan
        'usage.mockInterviewsThisMonth': 0,
        'usage.cvAnalysesThisMonth': 0,
        'usage.lastResetDate': now,
      },
    });

    this.logger.log(
      `User ${userId} upgraded to ${newPlan} (${billingCycle}). ` +
        `Voice quotas reset: mock=${planLimits.voice.mockVoice}min, real=${planLimits.voice.realVoice}min`,
    );
  }

  /**
   * Get user subscription status summary
   * ✅ FIX: Updated return type to use PlanLimits
   */
  async getSubscriptionStatus(userId: string): Promise<{
    plan: SubscriptionPlan;
    status: string;
    isTrialExpired: boolean;
    trialDaysRemaining: number;
    limits: PlanLimits;
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

  /**
   * CRITICAL CRON JOB: Reset monthly usage counters on 1st of each month
   * Runs at 00:05 on the 1st of every month (5 minutes after voice quota reset)
   * Resets: mockInterviews, cvAnalyses, chromeQuestions, aiTokens
   */
  @Cron('5 0 1 * *', {
    name: 'monthly_usage_counters_reset',
    timeZone: 'UTC',
  })
  async resetAllMonthlyUsage(): Promise<void> {
    try {
      this.logger.log('🔄 Starting monthly usage counters reset...');

      const firstDayOfMonth = new Date();
      firstDayOfMonth.setDate(1);
      firstDayOfMonth.setHours(0, 0, 0, 0);

      // Reset all users who haven't been reset this month
      const result = await this.userModel.updateMany(
        {
          'usage.lastResetDate': { $lt: firstDayOfMonth },
          deletedAt: null,
        },
        {
          $set: {
            'usage.mockInterviewsThisMonth': 0,
            'usage.cvAnalysesThisMonth': 0,
            'usage.liveInterviewMinutesThisMonth': 0,
            'usage.chromeQuestionsThisMonth': 0,
            'usage.aiTokensThisMonth': 0,
            'usage.lastResetDate': new Date(),
          },
        },
      );

      this.logger.log(
        `✅ Monthly usage counters reset completed. ${result.modifiedCount} users updated.`,
      );
    } catch (error: any) {
      this.logger.error(`❌ Monthly usage counters reset failed: ${error.message}`, error.stack);
    }
  }

  /**
   * CRITICAL CRON JOB: Expire trial subscriptions
   * Runs every hour to check and update expired trial subscriptions
   * Updates status from 'trialing' to 'expired' when trialEndsAt has passed
   *
   * ✅ NEW FIX: This was missing! Trial users never got status updated to 'expired'
   */
  @Cron('0 */1 * * *', {
    name: 'expire_trial_subscriptions',
    timeZone: 'UTC',
  })
  async expireTrialSubscriptions(): Promise<void> {
    try {
      this.logger.log('🔄 Checking for expired trial subscriptions...');

      const now = new Date();

      // Find all trial users whose trial has ended but status is still 'trialing'
      const result = await this.userModel.updateMany(
        {
          'subscription.plan': 'free_trial',
          'subscription.status': 'trialing',
          'subscription.trialEndsAt': { $lt: now },
          deletedAt: null,
        },
        {
          $set: {
            'subscription.status': 'expired',
          },
        },
      );

      if (result.modifiedCount > 0) {
        this.logger.log(
          `✅ Expired ${result.modifiedCount} trial subscriptions (status: trialing → expired)`,
        );
      } else {
        this.logger.debug('No trial subscriptions to expire');
      }
    } catch (error: any) {
      this.logger.error(`❌ Trial expiration job failed: ${error.message}`, error.stack);
    }
  }
}
