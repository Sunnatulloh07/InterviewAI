import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import { RedisModule } from '@nestjs-modules/ioredis';
import * as Joi from 'joi';

import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration imports
import { databaseConfig } from './config/database.config';
import { redisConfig } from './config/redis.config';
import { jwtConfig } from './config/jwt.config';
import { openaiConfig } from './config/openai.config';
import { stripeConfig } from './config/stripe.config';
import { awsConfig } from './config/aws.config';
import { telegramConfig } from './config/telegram.config';

// Common modules
import { DatabaseModule } from './database/database.module';
import { RedisService } from './common/services/redis.service';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StorageModule } from './modules/storage/storage.module';
import { CvModule } from './modules/cv/cv.module';
import { AiModule } from './modules/ai/ai.module';
import { InterviewsModule } from './modules/interviews/interviews.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    // Configuration module with validation
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [
        databaseConfig,
        redisConfig,
        jwtConfig,
        openaiConfig,
        stripeConfig,
        awsConfig,
        telegramConfig,
      ],
      validationSchema: Joi.object({
        // Application
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        ALLOWED_ORIGINS: Joi.string().default('http://localhost:5173'),

        // Database
        MONGODB_URI: Joi.string().required(),
        MONGODB_DB_NAME: Joi.string().default('interviewai'),

        // Redis
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().optional(),
        REDIS_DB: Joi.number().default(0),

        // JWT
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_ACCESS_EXPIRATION: Joi.alternatives()
          .try(
            Joi.number(), // seconds
            Joi.string(), // e.g., '15m', '7d'
          )
          .default(900),
        JWT_REFRESH_EXPIRATION: Joi.alternatives()
          .try(
            Joi.number(), // seconds
            Joi.string(), // e.g., '7d'
          )
          .default(604800),

        // OpenAI / OpenRouter Configuration
        OPENAI_API_KEY: Joi.string().required(),
        OPENAI_ORGANIZATION: Joi.string().optional().allow(''),
        OPENAI_BASE_URL: Joi.string().uri().default('https://openrouter.ai/api/v1'),
        OPENAI_SITE_URL: Joi.string().uri().optional().allow(''),
        OPENAI_SITE_NAME: Joi.string().optional().allow(''),
        OPENAI_CHAT_MODEL: Joi.string().default('openai/gpt-4-turbo'),
        OPENAI_CHAT_FALLBACK_MODEL: Joi.string().default('openai/gpt-3.5-turbo'),
        OPENAI_WHISPER_MODEL: Joi.string().default('openai/whisper-1'),
        OPENAI_MAX_TOKENS_ANSWER: Joi.number().default(1000),
        OPENAI_MAX_TOKENS_ANALYSIS: Joi.number().default(2000),
        OPENAI_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),
        OPENAI_TIMEOUT: Joi.number().default(30000),
        OPENAI_RETRIES: Joi.number().default(3),

        // Stripe (Optional for development)
        STRIPE_API_KEY: Joi.string().optional().allow(''),
        STRIPE_WEBHOOK_SECRET: Joi.string().optional().allow(''),
        STRIPE_PRO_PRICE_ID: Joi.string().optional().allow(''),
        STRIPE_ELITE_PRICE_ID: Joi.string().optional().allow(''),
        STRIPE_PRO_MONTHLY_PRICE_ID: Joi.string().optional().allow(''),
        STRIPE_PRO_ANNUAL_PRICE_ID: Joi.string().optional().allow(''),
        STRIPE_ELITE_MONTHLY_PRICE_ID: Joi.string().optional().allow(''),
        STRIPE_ELITE_ANNUAL_PRICE_ID: Joi.string().optional().allow(''),

        // File Storage
        LOCAL_UPLOAD_PATH: Joi.string().default('./uploads'),
        PUBLIC_URL: Joi.string().default('http://localhost:3000'),

        // AWS S3 (Optional - if not provided, uses local storage)
        AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
        AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
        AWS_REGION: Joi.string().default('us-east-1'),
        AWS_S3_BUCKET_CV: Joi.string().default('interviewai-cv-documents'),
        AWS_S3_BUCKET_AUDIO: Joi.string().default('interviewai-audio-recordings'),
        AWS_S3_BUCKET_AVATARS: Joi.string().default('interviewai-avatars'),

        // OTP Configuration
        OTP_LENGTH: Joi.number().default(6),
        OTP_EXPIRY_MINUTES: Joi.number().default(5),
        OTP_MAX_ATTEMPTS: Joi.number().default(3),

        // Telegram Bot (for authentication)
        TELEGRAM_BOT_TOKEN: Joi.string().required(),
        TELEGRAM_BOT_USERNAME: Joi.string().required(),
        TELEGRAM_WEBHOOK_URL: Joi.string().optional(),

        // Frontend URL (for redirects)
        FRONTEND_URL: Joi.string().default('http://localhost:5173'),

        // Monitoring
        SENTRY_DSN: Joi.string().optional(),

        // Docker Admin Interfaces (optional for development)
        MONGO_EXPRESS_USERNAME: Joi.string().optional(),
        MONGO_EXPRESS_PASSWORD: Joi.string().optional(),
        REDIS_COMMANDER_USERNAME: Joi.string().optional(),
        REDIS_COMMANDER_PASSWORD: Joi.string().optional(),
        MONGODB_ROOT_USERNAME: Joi.string().optional(),
        MONGODB_ROOT_PASSWORD: Joi.string().optional(),

        // Feature Flags
        ENABLE_VOICE_MESSAGES: Joi.boolean().default(true),
        ENABLE_STEALTH_MODE: Joi.boolean().default(true),
        ENABLE_OFFLINE_MODE: Joi.boolean().default(false),
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),

    // MongoDB Database (NestJS 11 + Mongoose 8 compatible)
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: configService.get<string>('MONGODB_DB_NAME'),
        autoIndex: configService.get<string>('NODE_ENV') !== 'production',
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        maxPoolSize: 100,
        minPoolSize: 10,
        retryWrites: true,
        w: 'majority',
      }),
      inject: [ConfigService],
    }),

    // Redis - Production-ready configuration
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const redisDb = configService.get<number>('REDIS_DB', 0);
        const nodeEnv = configService.get<string>('NODE_ENV', 'development');

        return {
          type: 'single',
          url: `redis://${redisHost}:${redisPort}`,
          options: {
            password: redisPassword,
            db: redisDb,
            keyPrefix: 'interviewai:',
            retryStrategy: (times: number) => {
              if (times > 3) return null; // Stop retrying after 3 attempts
              return Math.min(times * 50, 2000); // Exponential backoff, max 2s
            },
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            lazyConnect: false,
            connectTimeout: 10000, // 10 seconds connection timeout
            commandTimeout: 5000, // 5 seconds command timeout
            keepAlive: 30000, // 30 seconds keep-alive
            family: 4, // IPv4
            enableOfflineQueue: false, // Don't queue commands when offline
            enableAutoPipelining: true, // Auto pipeline for better performance
            // Production security
            ...(nodeEnv === 'production' && redisPassword
              ? {
                  // Require password in production
                  password: redisPassword,
                }
              : {}),
          },
        } as any;
      },
      inject: [ConfigService],
    }),

    // Cache Manager (Redis-based) - Production-ready
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
        const redisPort = configService.get<number>('REDIS_PORT', 6379);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const redisDb = configService.get<number>('REDIS_DB', 1); // Use DB 1 for cache

        return {
          store: require('cache-manager-ioredis'),
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          db: redisDb,
          keyPrefix: 'interviewai:cache:',
          ttl: 300, // 5 minutes in seconds
          max: 1000, // Maximum number of items in cache
          retryStrategy: (times: number) => {
            if (times > 3) return null;
            return Math.min(times * 50, 2000);
          },
          enableReadyCheck: true,
          maxRetriesPerRequest: 3,
          lazyConnect: false,
          connectTimeout: 10000, // 10 seconds
          commandTimeout: 5000, // 5 seconds
        };
      },
      inject: [ConfigService],
    }),

    // Bull Queue (Redis-based)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 2), // Use different DB for queues
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
            count: 1000,
          },
          removeOnFail: {
            age: 86400, // Keep failed jobs for 24 hours
          },
        },
      }),
      inject: [ConfigService],
    }),

    // Throttler (Rate Limiting)
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
      {
        name: 'long',
        ttl: 900000, // 15 minutes
        limit: 1000, // 1000 requests per 15 minutes
      },
    ]),

    // Schedule Module (Cron jobs)
    ScheduleModule.forRoot(),

    // Event Emitter
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),

    // Database module
    DatabaseModule,

    // Core modules
    StorageModule,

    // Feature modules
    AuthModule,
    UsersModule,
    CvModule,
    AiModule,
    InterviewsModule,
    TelegramModule,
    PaymentsModule,
    WebsocketModule,
    NotificationsModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [AppService, RedisService],
})
export class AppModule {
  constructor(private configService: ConfigService) {
    // Log startup configuration (non-sensitive data only)
    const env = this.configService.get<string>('NODE_ENV');
    console.log('🔧 Configuration loaded:');
    console.log(`   - Environment: ${env}`);
    console.log(`   - Database: ${this.configService.get<string>('MONGODB_DB_NAME')}`);
    console.log(
      `   - Redis: ${this.configService.get<string>('REDIS_HOST')}:${this.configService.get<number>('REDIS_PORT')}`,
    );
    console.log(`   - Port: ${this.configService.get<number>('PORT')}`);
  }
}
