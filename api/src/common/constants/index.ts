/**
 * Common Constants
 */

// Re-export metadata keys
export * from './metadata-keys';

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
];
export const ALLOWED_IMAGE_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_AUDIO_FORMATS = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
];

// Usage Limits by Plan (TZ compliant with aiTokensPerMonth added)
export const USAGE_LIMITS = {
  free: {
    mockInterviews: 3,
    cvAnalyses: 1,
    chromeQuestions: 50,
    aiTokensPerMonth: 10000, // Basic usage
  },
  pro: {
    mockInterviews: 50,
    cvAnalyses: 10,
    chromeQuestions: 1000,
    aiTokensPerMonth: 500000, // Generous for GPT-4
  },
  elite: {
    mockInterviews: -1, // unlimited
    cvAnalyses: -1, // unlimited
    chromeQuestions: -1, // unlimited
    aiTokensPerMonth: -1, // unlimited
  },
  enterprise: {
    mockInterviews: -1, // unlimited
    cvAnalyses: -1, // unlimited
    chromeQuestions: -1, // unlimited
    aiTokensPerMonth: -1, // unlimited
  },
} as const;

// Subscription Plan Features (TZ compliant)
export const PLAN_FEATURES = {
  free: {
    chromeExtension: false,
    telegramBot: true,
    cvAnalysis: true,
    cvOptimization: false,
    mockInterviews: true,
    stealthMode: false,
    voiceMessages: false,
    contextAwareness: false,
    advancedAI: false, // GPT-3.5 only
    prioritySupport: false,
    customTraining: false,
  },
  pro: {
    chromeExtension: true,
    telegramBot: true,
    cvAnalysis: true,
    cvOptimization: true,
    mockInterviews: true,
    stealthMode: true,
    voiceMessages: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4
    prioritySupport: false,
    customTraining: false,
  },
  elite: {
    chromeExtension: true,
    telegramBot: true,
    cvAnalysis: true,
    cvOptimization: true,
    mockInterviews: true,
    stealthMode: true,
    voiceMessages: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4
    prioritySupport: true,
    customTraining: false,
  },
  enterprise: {
    chromeExtension: true,
    telegramBot: true,
    cvAnalysis: true,
    cvOptimization: true,
    mockInterviews: true,
    stealthMode: true,
    voiceMessages: true,
    contextAwareness: true,
    advancedAI: true, // GPT-4
    prioritySupport: true,
    customTraining: true,
  },
} as const;

// OpenAI
export const OPENAI_MAX_TOKENS_ANSWER = 1000;
export const OPENAI_MAX_TOKENS_ANALYSIS = 2000;
export const OPENAI_MAX_TOKENS_FEEDBACK = 1500;
export const OPENAI_MAX_TOKENS_OPTIMIZATION = 3000;
export const OPENAI_TEMPERATURE = 0.7;

// AI Models (OpenRouter format)
export const AI_MODELS = {
  GPT4: 'openai/gpt-4-turbo',
  GPT35: 'openai/gpt-3.5-turbo',
  WHISPER: 'openai/whisper-1',
  CLAUDE: 'anthropic/claude-3-sonnet',
  // Add more OpenRouter models as needed
  GPT4_VISION: 'openai/gpt-4-vision-preview',
  CLAUDE_OPUS: 'anthropic/claude-3-opus',
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
