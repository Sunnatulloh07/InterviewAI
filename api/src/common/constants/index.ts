/**
 * Common Constants
 */

// Re-export metadata keys
export * from './metadata-keys';

// Re-export complete plan limits (SINGLE SOURCE OF TRUTH)
export * from './plan-limits.constant';

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
export const USAGE_LIMITS = {
  free_trial: {
    mockInterviews: 3,
    liveInterviewMinutes: 0, // No live interview in trial
    cvAnalyses: 1,
    chromeQuestions: 0, // No chrome extension
    aiTokensPerMonth: 10000,
    voiceMessagesEnabled: false, // Text only
    trialDays: 7,
  },
  starter: {
    mockInterviews: 15, // Approx cost control
    liveInterviewMinutes: 15, // Cost: ~$1.17 (1000 UZS/min)
    cvAnalyses: 5,
    chromeQuestions: 0,
    aiTokensPerMonth: 150000, // Increased slighty
    voiceMessagesEnabled: false,
    voiceInLiveEnabled: true, // Enabled for Live Interview
  },
  pro: {
    mockInterviews: 60, // 4x Starter (~$15/mo)
    liveInterviewMinutes: 120, // Matches UI
    cvAnalyses: 15, // 3x Starter
    chromeQuestions: 1000,
    aiTokensPerMonth: 500000,
    voiceMessagesEnabled: false,
    voiceInLiveEnabled: true,
  },
  elite: {
    mockInterviews: 150, // 10x Starter (~$30/mo)
    liveInterviewMinutes: 300, // 2.5x Pro
    cvAnalyses: 40,
    chromeQuestions: 5000,
    aiTokensPerMonth: 2000000,
    voiceMessagesEnabled: false,
    voiceInLiveEnabled: true,
  },
} as const;

// Plan types for type safety
export type SubscriptionPlan = keyof typeof USAGE_LIMITS;

// Interview Question Counts by Duration and Difficulty
// Duration: quick (~10 min), standard (~25 min), deep_dive (~45 min)
// Difficulty: junior, middle, senior
export const INTERVIEW_QUESTION_COUNTS = {
  quick: { junior: 6, middle: 8, senior: 10 },
  standard: { junior: 13, middle: 17, senior: 20 },
  deep_dive: { junior: 27, middle: 32, senior: 37 },
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
    voiceMessages: true, // ✅ ENABLED: Mock voice for practice (5 min quota)
    voiceInLive: false,
    stealthMode: false,
    contextAwareness: false,
    advancedAI: false, // GPT-4o-mini only
    prioritySupport: false,
    dailyTasks: false, // ❌ DISABLED: Daily tasks only for paid users
  },
  starter: {
    telegramBot: true,
    chromeExtension: false,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: false,
    voiceMessages: true, // ✅ ENABLED: Mock voice for practice (10 min quota)
    voiceInLive: true, // Enabled for all paid plans in Live
    stealthMode: false,
    contextAwareness: true,
    advancedAI: false, // GPT-4o-mini
    prioritySupport: false,
    dailyTasks: true, // ✅ ENABLED: Daily tasks with AI-powered reminders
  },
  pro: {
    telegramBot: true,
    chromeExtension: true,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: true,
    voiceMessages: true, // ✅ ENABLED: Mock voice for practice (30 min quota)
    voiceInLive: true,
    stealthMode: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4o
    prioritySupport: false,
    dailyTasks: true, // ✅ ENABLED: Daily tasks with AI-powered reminders
  },
  elite: {
    telegramBot: true,
    chromeExtension: true,
    liveInterview: true,
    mockInterviews: true,
    cvAnalysis: true,
    cvOptimization: true,
    voiceMessages: true, // ✅ ENABLED: Mock voice for practice (60 min quota)
    voiceInLive: true,
    stealthMode: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4o / Claude
    prioritySupport: true,
    dailyTasks: true, // ✅ ENABLED: Daily tasks with AI-powered reminders
  },
} as const;

// Feature types for type safety
export type PlanFeatures = keyof typeof PLAN_FEATURES;

// OpenAI
export const OPENAI_MAX_TOKENS_ANSWER = 1000;
export const OPENAI_MAX_TOKENS_ANALYSIS = 4000; // Increased for deeper analysis (Nano/Mini support)
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
