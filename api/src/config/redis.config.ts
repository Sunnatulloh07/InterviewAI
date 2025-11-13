import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB ?? '0', 10) || 0,
    keyPrefix: 'interviewai:',
    retryStrategy: (times: number) => {
      if (times > 3) return null; // Stop retrying after 3 attempts
      return Math.min(times * 50, 2000); // Exponential backoff, max 2s
    },
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    connectTimeout: 10000, // 10 seconds
    commandTimeout: 5000, // 5 seconds
    keepAlive: 30000, // 30 seconds
    family: 4, // IPv4
    enableOfflineQueue: false, // Don't queue when offline
    enableAutoPipelining: true, // Auto pipeline for performance
    // Production requirements
    ...(isProduction &&
      {
        // In production, password should be required
        // This is validated in app.module.ts Joi schema
      }),
  };
});
