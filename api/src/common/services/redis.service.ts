import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private isHealthy = false;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async onModuleInit() {
    if (!this.redis) {
      this.logger.warn('Redis not available - skipping health check');
      return;
    }

    await this.checkHealth();

    // Set up event listeners
    this.redis.on('connect', () => {
      this.logger.log('Redis connection established');
      this.isHealthy = true;
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis is ready to accept commands');
      this.isHealthy = true;
    });

    this.redis.on('error', (error) => {
      this.logger.error(`Redis error: ${error.message}`, error.stack);
      this.isHealthy = false;
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.isHealthy = false;
    });

    this.redis.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis reconnecting in ${delay}ms`);
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    }
  }

  /**
   * Check Redis health
   */
  async checkHealth(): Promise<boolean> {
    if (!this.redis) {
      this.isHealthy = false;
      return false;
    }

    try {
      const result = await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis health check timeout')), 5000),
        ),
      ]);
      this.isHealthy = result === 'PONG';
      return this.isHealthy;
    } catch (error) {
      this.logger.error(`Redis health check failed: ${error.message}`);
      this.isHealthy = false;
      return false;
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(): boolean {
    return this.isHealthy;
  }

  /**
   * Safe Redis GET with error handling
   */
  async safeGet(key: string): Promise<string | null> {
    if (!this.redis) {
      return null; // Graceful degradation
    }

    try {
      return await this.redis.get(key);
    } catch (error) {
      this.logger.error(`Redis GET failed for key ${key}: ${error.message}`);
      return null; // Graceful degradation
    }
  }

  /**
   * Safe Redis SET with error handling
   */
  async safeSet(key: string, value: string, ttl?: number): Promise<boolean> {
    if (!this.redis) {
      return false; // Graceful degradation
    }

    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
      return true;
    } catch (error) {
      this.logger.error(`Redis SET failed for key ${key}: ${error.message}`);
      return false; // Graceful degradation
    }
  }

  /**
   * Safe Redis DEL with error handling
   */
  async safeDel(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      this.logger.error(`Redis DEL failed for key ${key}: ${error.message}`);
      return false; // Graceful degradation
    }
  }

  /**
   * Safe Redis EXISTS with error handling
   */
  async safeExists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis EXISTS failed for key ${key}: ${error.message}`);
      return false; // Graceful degradation - assume key doesn't exist
    }
  }

  /**
   * Safe Redis INCR with error handling
   */
  async safeIncr(key: string): Promise<number | null> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Redis INCR failed for key ${key}: ${error.message}`);
      return null; // Graceful degradation
    }
  }

  /**
   * Safe Redis EXPIRE with error handling
   */
  async safeExpire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.redis.expire(key, seconds);
      return result === 1;
    } catch (error) {
      this.logger.error(`Redis EXPIRE failed for key ${key}: ${error.message}`);
      return false; // Graceful degradation
    }
  }

  /**
   * Safe Redis MULTI/EXEC with error handling
   */
  async safeMulti(commands: Array<{ command: string; args: any[] }>): Promise<any[] | null> {
    try {
      const multi = this.redis.multi();
      commands.forEach((cmd) => {
        (multi as any)[cmd.command](...cmd.args);
      });
      const result = await multi.exec();
      return result;
    } catch (error) {
      this.logger.error(`Redis MULTI/EXEC failed: ${error.message}`);
      return null; // Graceful degradation
    }
  }

  /**
   * Get Redis instance (for advanced operations)
   */
  getRedis(): Redis | undefined {
    return this.redis;
  }
}
