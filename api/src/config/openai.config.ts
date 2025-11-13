import { registerAs } from '@nestjs/config';

export const openaiConfig = registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION,
  models: {
    transcription: 'whisper-1',
    chat: process.env.OPENAI_CHAT_MODEL || 'gpt-4-turbo-preview',
    chatFallback: 'gpt-3.5-turbo',
  },
  maxTokens: {
    answer: parseInt(process.env.OPENAI_MAX_TOKENS_ANSWER ?? '1000') || 1000,
    analysis: parseInt(process.env.OPENAI_MAX_TOKENS_ANALYSIS ?? '2000') || 2000,
  },
  temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? '0.7') || 0.7,
  timeout: parseInt(process.env.OPENAI_TIMEOUT ?? '30000') || 30000,
  retries: parseInt(process.env.OPENAI_RETRIES ?? '3') || 3,
}));
