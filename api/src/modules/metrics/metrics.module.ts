import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * Metrics Module
 * Prometheus-compatible metrics collection for:
 * - HTTP requests (count, duration, status codes)
 * - Database queries (count, duration)
 * - Cache operations (hits, misses)
 * - External API calls (count, duration, errors)
 * - Business metrics (interviews, CV analyses, etc.)
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
