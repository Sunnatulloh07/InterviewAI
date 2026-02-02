import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USAGE_LIMITS, PLAN_FEATURES, SubscriptionPlan } from '@common/constants';

/**
 * Guard that checks if user's trial has expired
 * For free_trial users, blocks access after 7 days
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Let auth guard handle this
    }

    const subscription = user.subscription;
    if (!subscription) {
      return true; // New user, will get default trial
    }

    // Check if trial has expired
    if (subscription.plan === 'free_trial') {
      const now = new Date();
      const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;

      if (trialEnd && now > trialEnd) {
        this.logger.warn(
          `Trial expired for user ${user.id}. Trial ended: ${trialEnd.toISOString()}`,
        );
        throw new ForbiddenException({
          code: 'TRIAL_EXPIRED',
          message: 'Your trial period has expired. Please upgrade to continue.',
          messageUz: 'Sinov muddatingiz tugadi. Davom etish uchun tarifni yangilang.',
          messageRu: 'Ваш пробный период истек. Пожалуйста, обновите тариф.',
          trialEndsAt: trialEnd.toISOString(),
          suggestedPlan: 'starter',
        });
      }
    }

    // Check if subscription has expired (for paid plans)
    if (subscription.status === 'expired') {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Your subscription has expired. Please renew to continue.',
        messageUz: 'Obunangiz tugadi. Davom etish uchun yangilang.',
        messageRu: 'Ваша подписка истекла. Пожалуйста, продлите.',
      });
    }

    return true;
  }
}

/**
 * Guard that checks if user has access to a specific feature
 * Usage: @UseGuards(FeatureGuard)
 *        @RequireFeature('voiceMessages')
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  private readonly logger = new Logger(FeatureGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.get<string>('requiredFeature', context.getHandler());

    if (!requiredFeature) {
      return true; // No feature requirement
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Let auth guard handle this
    }

    // CRITICAL: Check trial expiry first
    const subscription = user.subscription;
    if (subscription?.plan === 'free_trial') {
      const now = new Date();
      const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      if (trialEnd && now > trialEnd) {
        throw new ForbiddenException({
          code: 'TRIAL_EXPIRED',
          message: 'Your trial period has expired. Please upgrade to continue.',
          messageUz: 'Sinov muddatingiz tugadi. Davom etish uchun tarifni yangilang.',
          messageRu: 'Ваш пробный период истек. Пожалуйста, обновите тариф.',
          suggestedPlan: 'starter',
        });
      }
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const planFeatures = PLAN_FEATURES[plan];

    if (!planFeatures) {
      this.logger.warn(`Unknown plan: ${plan} for user ${user.id}`);
      return false;
    }

    const hasFeature = planFeatures[requiredFeature as keyof typeof planFeatures];

    if (!hasFeature) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_AVAILABLE',
        message: `This feature requires a higher plan. Please upgrade.`,
        messageUz: `Bu funksiya uchun yuqoriroq tarif kerak. Iltimos, yangilang.`,
        messageRu: `Эта функция требует более высокий тариф. Пожалуйста, обновите.`,
        requiredFeature,
        currentPlan: plan,
        suggestedPlan: this.getSuggestedPlan(requiredFeature),
      });
    }

    return true;
  }

  private getSuggestedPlan(feature: string): SubscriptionPlan {
    // Find the minimum plan that has this feature
    const plans: SubscriptionPlan[] = ['starter', 'pro', 'elite'];
    for (const plan of plans) {
      const features = PLAN_FEATURES[plan];
      if (features[feature as keyof typeof features]) {
        return plan;
      }
    }
    return 'pro';
  }
}

/**
 * Guard that checks usage limits
 * Usage: @UseGuards(UsageLimitGuard)
 *        @CheckUsage('mockInterviews')
 */
@Injectable()
export class UsageLimitGuard implements CanActivate {
  private readonly logger = new Logger(UsageLimitGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const usageType = this.reflector.get<string>('checkUsage', context.getHandler());

    if (!usageType) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true;
    }

    // CRITICAL: Check trial expiry first
    const subscription = user.subscription;
    if (subscription?.plan === 'free_trial') {
      const now = new Date();
      const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      if (trialEnd && now > trialEnd) {
        throw new ForbiddenException({
          code: 'TRIAL_EXPIRED',
          message: 'Your trial period has expired. Please upgrade to continue.',
          messageUz: 'Sinov muddatingiz tugadi. Davom etish uchun tarifni yangilang.',
          messageRu: 'Ваш пробный период истек. Пожалуйста, обновите тариф.',
          suggestedPlan: 'starter',
        });
      }
    }

    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    const limits = USAGE_LIMITS[plan];
    const usage = user.usage || {};

    // Get limit and current usage
    const limit = limits[usageType as keyof typeof limits];
    const usageFieldMap: Record<string, string> = {
      mockInterviews: 'mockInterviewsThisMonth',
      liveInterviewMinutes: 'liveInterviewMinutesThisMonth',
      cvAnalyses: 'cvAnalysesThisMonth',
      chromeQuestions: 'chromeQuestionsThisMonth',
    };

    const usageField = usageFieldMap[usageType];
    const currentUsage = usage[usageField] || 0;

    // -1 means unlimited
    if (typeof limit === 'number' && currentUsage >= limit) {
      this.logger.warn(
        `Usage limit reached for user ${user.id}: ${usageType} (${currentUsage}/${limit})`,
      );
      throw new ForbiddenException({
        code: 'USAGE_LIMIT_REACHED',
        message: `You have reached your ${usageType} limit for this month. Please upgrade.`,
        messageUz: `Siz bu oy uchun ${usageType} limitiga yetdingiz. Iltimos, tarifni yangilang.`,
        messageRu: `Вы достигли лимита ${usageType} на этот месяц. Пожалуйста, обновите тариф.`,
        usageType,
        currentUsage,
        limit,
        currentPlan: plan,
        suggestedPlan: this.getSuggestedPlan(plan),
      });
    }

    return true;
  }

  private getSuggestedPlan(currentPlan: SubscriptionPlan): SubscriptionPlan {
    const upgradeMap: Record<SubscriptionPlan, SubscriptionPlan> = {
      free_trial: 'starter',
      starter: 'pro',
      pro: 'elite',
      elite: 'elite',
    };
    return upgradeMap[currentPlan];
  }
}
