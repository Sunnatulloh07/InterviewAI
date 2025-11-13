import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MongooseHealthIndicator } from './indicators/mongoose.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { OpenAIHealthIndicator } from './indicators/openai.health';
import { StorageHealthIndicator } from './indicators/storage.health';

/**
 * Health Check Module
 * Comprehensive health monitoring for:
 * - Database (MongoDB)
 * - Cache (Redis)
 * - External APIs (OpenAI)
 * - Storage (AWS S3)
 * - Memory and Disk
 */
@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    MongooseHealthIndicator,
    RedisHealthIndicator,
    OpenAIHealthIndicator,
    StorageHealthIndicator,
  ],
  exports: [HealthService],
})
export class HealthModule {}
