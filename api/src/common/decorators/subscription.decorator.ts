import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to require a specific feature
 * Usage: @RequireFeature('voiceMessages')
 */
export const RequireFeature = (feature: string) => SetMetadata('requiredFeature', feature);

/**
 * Decorator to check usage limits
 * Usage: @CheckUsage('mockInterviews')
 */
export const CheckUsage = (usageType: string) => SetMetadata('checkUsage', usageType);

/**
 * Decorator to require a minimum plan
 * Usage: @RequirePlan('pro')
 */
export const RequirePlan = (plan: string) => SetMetadata('requiredPlan', plan);

/**
 * Decorator to skip subscription check
 * Usage: @SkipSubscriptionCheck()
 */
export const SkipSubscriptionCheck = () => SetMetadata('skipSubscriptionCheck', true);
