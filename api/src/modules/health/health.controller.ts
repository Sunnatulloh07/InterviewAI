import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { MongooseHealthIndicator } from './indicators/mongoose.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { OpenAIHealthIndicator } from './indicators/openai.health';
import { StorageHealthIndicator } from './indicators/storage.health';
import { HealthService } from './health.service';

/**
 * Health Check Controller
 * Provides multiple health check endpoints:
 * - /health - Basic health check
 * - /health/detailed - Detailed health with all dependencies
 * - /health/liveness - Kubernetes liveness probe
 * - /health/readiness - Kubernetes readiness probe
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongooseHealth: MongooseHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private openaiHealth: OpenAIHealthIndicator,
    private storageHealth: StorageHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private healthService: HealthService,
  ) {}

  /**
   * Basic health check - Returns 200 if service is up
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Basic health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async check() {
    return this.health.check([
      () => this.mongooseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
      // Memory check: RSS should not exceed 1GB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      // Heap check: should not exceed 512MB
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  /**
   * Detailed health check - Includes all dependencies and metrics
   */
  @Public()
  @Get('detailed')
  @HealthCheck()
  @ApiOperation({ summary: 'Detailed health check with all dependencies' })
  @ApiResponse({ status: 200, description: 'Detailed health information' })
  async checkDetailed() {
    return this.health.check([
      // Core infrastructure
      () => this.mongooseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),

      // External services
      () => this.openaiHealth.isHealthy('openai'),
      () => this.storageHealth.isHealthy('storage'),

      // System resources
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.disk.checkStorage('disk', {
        path: '/',
        thresholdPercent: 0.9, // 90% threshold
      }),
    ]);
  }

  /**
   * Liveness probe - For Kubernetes
   * Indicates if the application is running
   */
  @Public()
  @Get('liveness')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  async checkLiveness() {
    return this.health.check([
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }

  /**
   * Readiness probe - For Kubernetes
   * Indicates if the application can accept traffic
   */
  @Public()
  @Get('readiness')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Application is ready' })
  async checkReadiness() {
    return this.health.check([
      () => this.mongooseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
    ]);
  }

  /**
   * Metrics endpoint - Returns application metrics
   */
  @Public()
  @Get('metrics')
  @ApiOperation({ summary: 'Get application metrics' })
  @ApiResponse({ status: 200, description: 'Application metrics' })
  async getMetrics() {
    return this.healthService.getMetrics();
  }

  /**
   * System info endpoint - Returns system information
   */
  @Public()
  @Get('info')
  @ApiOperation({ summary: 'Get system information' })
  @ApiResponse({ status: 200, description: 'System information' })
  async getInfo() {
    return this.healthService.getSystemInfo();
  }
}
