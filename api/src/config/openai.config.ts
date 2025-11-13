import { registerAs } from '@nestjs/config';

export const openaiConfig = registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION,
  // OpenRouter configuration
  baseURL: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  siteUrl: process.env.OPENAI_SITE_URL || 'http://localhost:5173',
  siteName: process.env.OPENAI_SITE_NAME || 'InterviewAI Pro',
  models: {
    transcription: process.env.OPENAI_WHISPER_MODEL || 'openai/whisper-1',
    chat: process.env.OPENAI_CHAT_MODEL || 'openai/gpt-4-turbo',
    chatFallback: process.env.OPENAI_CHAT_FALLBACK_MODEL || 'openai/gpt-3.5-turbo',
  },
  maxTokens: {
    answer: parseInt(process.env.OPENAI_MAX_TOKENS_ANSWER ?? '1000') || 1000,
    analysis: parseInt(process.env.OPENAI_MAX_TOKENS_ANALYSIS ?? '2000') || 2000,
  },
  temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? '0.7') || 0.7,
  timeout: parseInt(process.env.OPENAI_TIMEOUT ?? '30000') || 30000,
  retries: parseInt(process.env.OPENAI_RETRIES ?? '3') || 3,
}));
