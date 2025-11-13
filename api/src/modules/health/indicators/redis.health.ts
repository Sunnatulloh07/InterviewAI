import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

/**
 * Redis Health Indicator
 * Checks Redis connection and responsiveness
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@InjectRedis() private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();
      const pong = await this.redis.ping();
      const latency = Date.now() - startTime;

      if (pong === 'PONG') {
        // Get Redis info
        const info = await this.getRedisInfo();

        return this.getStatus(key, true, {
          state: 'connected',
          latency: `${latency}ms`,
          ...info,
        });
      }

      throw new Error('Redis PING failed');
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, {
          state: 'disconnected',
          message: error.message,
        }),
      );
    }
  }

  /**
   * Get Redis information
   */
  private async getRedisInfo() {
    try {
      const info = await this.redis.info();
      const lines = info.split('\r\n');
      const stats: any = {};

      for (const line of lines) {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          if (key === 'used_memory_human') stats.usedMemory = value;
          if (key === 'connected_clients') stats.connectedClients = parseInt(value, 10);
          if (key === 'uptime_in_seconds') stats.uptime = parseInt(value, 10);
          if (key === 'redis_version') stats.version = value;
        }
      }

      return stats;
    } catch (error) {
      return { error: 'Could not fetch Redis info' };
    }
  }
}
