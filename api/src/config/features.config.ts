import { registerAs } from '@nestjs/config';

/**
 * Feature Flags Configuration
 *
 * Controls which growth features are enabled/disabled.
 * Allows gradual rollout and A/B testing via environment variables.
 *
 * Usage in services:
 *   constructor(private configService: ConfigService) {}
 *   const irsEnabled = this.configService.get<boolean>('features.irsEnabled');
 */
export const featuresConfig = registerAs('features', () => ({
  // --- Feature Flags ---
  irsEnabled: parseBool(process.env.FEATURE_IRS_ENABLED, true),
  streakEnabled: parseBool(process.env.FEATURE_STREAK_ENABLED, true),
  leaderboardEnabled: parseBool(process.env.FEATURE_LEADERBOARD_ENABLED, true),
  mockEnhancedEnabled: parseBool(process.env.FEATURE_MOCK_ENHANCED_ENABLED, false),
  badgesEnabled: parseBool(process.env.FEATURE_BADGES_ENABLED, true),

  // --- IRS Configuration ---
  irs: {
    maxDailyTests: parseInt(process.env.IRS_MAX_DAILY_TESTS || '3', 10),
    aiModel: process.env.IRS_AI_MODEL || 'z-ai/glm-4-32b',
    sessionTimeoutMinutes: parseInt(process.env.IRS_SESSION_TIMEOUT_MINUTES || '10', 10),
    scoringMaxTokens: parseInt(process.env.IRS_SCORING_MAX_TOKENS || '300', 10),
    scoringTemperature: parseFloat(process.env.IRS_SCORING_TEMPERATURE || '0.3'),
  },

  // --- Streak Configuration ---
  streak: {
    timezone: process.env.STREAK_TIMEZONE || 'Asia/Tashkent',
    checkBufferMinutes: parseInt(process.env.STREAK_CHECK_BUFFER_MINUTES || '5', 10),
    maxNotificationsPerDay: parseInt(process.env.STREAK_MAX_NOTIFICATIONS_PER_DAY || '4', 10),
  },

  // --- Leaderboard Configuration ---
  leaderboard: {
    recalcIntervalMinutes: parseInt(process.env.LB_RECALC_INTERVAL_MINUTES || '15', 10),
    dailyPointCap: parseInt(process.env.LB_DAILY_POINT_CAP || '35', 10),
    topDisplayCount: parseInt(process.env.LB_TOP_DISPLAY_COUNT || '20', 10),
  },

  // --- Mock Interview Enhanced Configuration ---
  mock: {
    idleTimeoutSeconds: parseInt(process.env.MOCK_IDLE_TIMEOUT_SECONDS || '900', 10),
    maxFollowUpsPerQuestion: parseInt(process.env.MOCK_MAX_FOLLOWUPS || '2', 10),
  },
}));

/**
 * Parse boolean from environment variable string
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}
