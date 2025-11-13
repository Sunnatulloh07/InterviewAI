import { registerAs } from '@nestjs/config';

export const telegramConfig = registerAs('telegram', () => ({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  webhookPath: '/telegram/webhook',
  parseMode: 'Markdown' as const,
  maxFileSize: 20 * 1024 * 1024, // 20MB
  voiceMaxDuration: 300, // 5 minutes
}));
