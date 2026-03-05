/**
 * Common Constants
 */

// Re-export metadata keys
export * from './metadata-keys';

// Re-export complete plan limits (SINGLE SOURCE OF TRUTH)
export * from './plan-limits.constant';

// Re-export application events
export * from './events.constants';

// Re-export AI prompts (enterprise-grade centralized prompts)
export * from './ai-prompts.constant';

// API Versioning
export const API_VERSION = 'v1';
export const API_PREFIX = `api/${API_VERSION}`;

// Rate Limiting
export const RATE_LIMIT_SHORT = { ttl: 1000, limit: 10 }; // 10 req/sec
export const RATE_LIMIT_MEDIUM = { ttl: 60000, limit: 100 }; // 100 req/min
export const RATE_LIMIT_LONG = { ttl: 900000, limit: 1000 }; // 1000 req/15min

// JWT
export const JWT_ACCESS_TOKEN_EXPIRATION = '15m';
export const JWT_REFRESH_TOKEN_EXPIRATION = '7d';

// Pagination
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

// File Upload
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_CV_FORMATS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
];
export const ALLOWED_IMAGE_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_AUDIO_FORMATS = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
];

// Usage Limits by Plan
// Plans: free_trial (7 days), starter, pro, elite
// -1 means unlimited
// ⚠️ LEGACY: Use COMPLETE_PLAN_LIMITS from plan-limits.constant.ts as single source of truth
// These values are ALIGNED with COMPLETE_PLAN_LIMITS to prevent discrepancies
export const USAGE_LIMITS = {
  free_trial: {
    mockInterviews: 1, // ALIGNED: 1 mock interview in 7-day trial
    liveInterviewMinutes: 0, // No live interview in trial
    cvAnalyses: 1, // 1 CV analysis in trial
    chromeQuestions: 0, // No chrome extension
    aiTokensPerMonth: 10000,
    voiceMessagesEnabled: false, // Text only — NO voice in free trial
    trialDays: 7,
  },
  starter: {
    mockInterviews: 2, // ALIGNED with COMPLETE_PLAN_LIMITS ($5/mo plan)
    liveInterviewMinutes: 15, // ALIGNED: realVoice = 15 min
    cvAnalyses: 5,
    chromeQuestions: 0,
    aiTokensPerMonth: 150000,
    voiceMessagesEnabled: true, // Starter+ has voice (mockVoice = 10 min)
    voiceInLiveEnabled: true,
  },
  pro: {
    mockInterviews: 8, // ALIGNED with COMPLETE_PLAN_LIMITS ($15/mo plan)
    liveInterviewMinutes: 45, // ALIGNED with realVoice = 45 min
    cvAnalyses: 15,
    chromeQuestions: 1000,
    aiTokensPerMonth: 500000,
    voiceMessagesEnabled: true, // Pro has voice (mockVoice = 30 min)
    voiceInLiveEnabled: true,
  },
  elite: {
    mockInterviews: -1, // ALIGNED: UNLIMITED in COMPLETE_PLAN_LIMITS
    liveInterviewMinutes: 120, // FIX #56: ALIGNED with realVoice = 120 min (was 300)
    cvAnalyses: -1, // ALIGNED: UNLIMITED in COMPLETE_PLAN_LIMITS
    chromeQuestions: 5000,
    aiTokensPerMonth: 2000000,
    voiceMessagesEnabled: true, // Elite has voice (mockVoice = 60 min)
    voiceInLiveEnabled: true,
  },
} as const;

// Plan types for type safety
export type SubscriptionPlan = keyof typeof USAGE_LIMITS;

// Interview Question Counts by Duration and Difficulty
// Duration: quick (~10 min), standard (~25 min), deep_dive (~45 min)
// Difficulty: junior, middle, senior
export const INTERVIEW_QUESTION_COUNTS = {
  quick: { junior: 6, middle: 8, senior: 10, lead: 12 },
  standard: { junior: 13, middle: 17, senior: 20, lead: 25 },
  deep_dive: { junior: 27, middle: 32, senior: 37, lead: 45 },
} as const;

export type InterviewDuration = keyof typeof INTERVIEW_QUESTION_COUNTS;

// Subscription Plan Features
// Aligned with USAGE_LIMITS plan types
export const PLAN_FEATURES = {
  free_trial: {
    telegramBot: true,
    chromeExtension: false,
    liveInterview: false,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: false,
    voiceMessages: false, // FREE TRIAL = TEXT ONLY, no voice (mockVoice=0)
    voiceInLive: false,
    stealthMode: false,
    contextAwareness: false,
    advancedAI: false, // AI model: z-ai/glm-4-32b (internal)
    prioritySupport: false,
    dailyTasks: false, // No daily tasks in free trial
    // Growth features
    irsTest: true, // IRS is free for everyone (viral acquisition)
    streakTracking: true, // Basic streak (IRS-based only)
    streakFreeze: false,
    leaderboardView: true,
    leaderboardParticipate: false,
    badges: true, // Basic badges only
  },
  starter: {
    telegramBot: true,
    chromeExtension: false,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: false,
    voiceMessages: true, // Mock voice for practice (10 min quota)
    voiceInLive: true,
    stealthMode: false,
    contextAwareness: true,
    advancedAI: false, // GPT-4o-mini
    prioritySupport: false,
    dailyTasks: true, // Daily tasks with AI-powered reminders
    // Growth features
    irsTest: true,
    streakTracking: true, // Full streak (daily task-based)
    streakFreeze: false,
    leaderboardView: true,
    leaderboardParticipate: true,
    badges: true, // Full badges
  },
  pro: {
    telegramBot: true,
    chromeExtension: true,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: true,
    voiceMessages: true, // Mock voice for practice (30 min quota)
    voiceInLive: true,
    stealthMode: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4o
    prioritySupport: false,
    dailyTasks: true, // Daily tasks with AI-powered reminders
    // Growth features
    irsTest: true,
    streakTracking: true,
    streakFreeze: true, // 2 freezes/month
    leaderboardView: true,
    leaderboardParticipate: true,
    badges: true,
  },
  elite: {
    telegramBot: true,
    chromeExtension: true,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: true,
    voiceMessages: true, // Mock voice for practice (60 min quota)
    voiceInLive: true,
    stealthMode: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4o / Claude
    prioritySupport: true,
    dailyTasks: true, // Daily tasks with AI-powered reminders
    // Growth features
    irsTest: true,
    streakTracking: true,
    streakFreeze: true, // 3 freezes/month
    leaderboardView: true,
    leaderboardParticipate: true,
    badges: true, // Full + exclusive badges
    companyMockInterview: true, // Elite-only feature
  },
} as const;

// Feature types for type safety
export type PlanFeatures = keyof typeof PLAN_FEATURES;

// OpenAI
export const OPENAI_MAX_TOKENS_ANSWER = 1000;
export const OPENAI_MAX_TOKENS_ANALYSIS = 6000; // FIX #64: Increased for 100-point scoring + detailed roadmap output
export const OPENAI_MAX_TOKENS_FEEDBACK = 1500;
export const OPENAI_MAX_TOKENS_OPTIMIZATION = 3000;
export const OPENAI_TEMPERATURE = 0.7;

// AI Models
export const AI_MODELS = {
  GPT4: 'gpt-4o',
  GPT35: 'openai/gpt-4o-mini', // Explicit provider prefix for clarity
  GPT_NANO: 'openai/gpt-5-nano', // User requested - High context, low cost
  CLAUDE: 'anthropic/claude-3.5-sonnet',
} as const;

// Redis Keys
export const REDIS_KEY_PREFIX = 'interviewai:';
export const REDIS_SESSION_PREFIX = `${REDIS_KEY_PREFIX}session:`;
export const REDIS_CACHE_PREFIX = `${REDIS_KEY_PREFIX}cache:`;
export const REDIS_RATELIMIT_PREFIX = `${REDIS_KEY_PREFIX}ratelimit:`;
export const REDIS_BLACKLIST_PREFIX = `${REDIS_KEY_PREFIX}blacklist:`;

// Queue Names
export const QUEUE_CV_ANALYSIS = 'cv-analysis';
export const QUEUE_INTERVIEW_FEEDBACK = 'interview-feedback';
export const QUEUE_EMAIL = 'email';
export const QUEUE_NOTIFICATION = 'notification';

// Cache TTL (in seconds)
export const CACHE_TTL_SHORT = 60; // 1 minute
export const CACHE_TTL_MEDIUM = 300; // 5 minutes
export const CACHE_TTL_LONG = 3600; // 1 hour
export const CACHE_TTL_DAY = 86400; // 24 hours
