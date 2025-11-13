/**
 * Key for marking routes as public (bypass authentication)
 * Used by @Public() decorator and JwtAuthGuard
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Key for defining required roles for endpoints
 * Used by @Roles() decorator and RolesGuard
 */
export const ROLES_KEY = 'roles';

/**
 * Key for custom rate limiting on endpoints
 * Used by @RateLimit() decorator and RateLimitGuard
 */
export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Key for rate limit time window
 * Used by @RateLimit() decorator and RateLimitGuard
 */
export const RATE_LIMIT_WINDOW_KEY = 'rateLimitWindow';
