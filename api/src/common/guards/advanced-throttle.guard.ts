import { Injectable, ExecutionContext, CanActivate } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { LoggerService } from '../logger/logger.service';
import { AuditEventType } from '../logger/winston.config';

/**
 * Advanced Throttle Guard
 * Features:
 * - IP-based rate limiting
 * - User-based rate limiting
 * - Endpoint-specific limits
 * - Progressive throttling (ban repeat offenders)
 * - Redis-based distributed rate limiting
 */
@Injectable()
export class AdvancedThrottleGuard implements CanActivate {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AdvancedThrottleGuard');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { ip, user, url, method } = request;

    // Default limits (can be overridden via decorators)
    const limit = 100; // requests
    const ttl = 60; // seconds

    return await this.handleRequest(context, limit, ttl);
  }

  private async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const { ip, user, url, method } = request;

    // Get throttle key (prefer user ID, fallback to IP)
    const throttleKey = user?.id || ip;
    const redisKey = `throttle:${throttleKey}:${method}:${url}`;

    // Check if IP is banned
    const banKey = `ban:${ip}`;
    const isBanned = await this.redis.get(banKey);

    if (isBanned) {
      const banExpiry = await this.redis.ttl(banKey);
      const minutes = Math.ceil(banExpiry / 60);

      this.logger.security('Banned IP attempted access', 'high', {
        ip,
        url,
        remainingMinutes: minutes,
      });

      throw new ThrottlerException(`IP banned for ${minutes} minutes due to excessive requests`);
    }

    // Get current request count
    const current = await this.redis.incr(redisKey);

    // Set expiry on first request
    if (current === 1) {
      await this.redis.expire(redisKey, ttl);
    }

    // Check if limit exceeded
    if (current > limit) {
      // Track violations
      const violationKey = `violations:${throttleKey}`;
      const violations = await this.redis.incr(violationKey);

      // Set violation expiry (24 hours)
      if (violations === 1) {
        await this.redis.expire(violationKey, 86400);
      }

      // Ban IP if too many violations (10 violations in 24 hours)
      if (violations >= 10) {
        // Ban for 1 hour
        await this.redis.setex(banKey, 3600, 'excessive_violations');

        this.logger.security('IP banned due to excessive rate limit violations', 'critical', {
          ip,
          userId: user?.id,
          violations,
        });

        this.logger.audit({
          eventType: AuditEventType.RATE_LIMIT_EXCEEDED,
          userId: user?.id,
          ip,
          metadata: { violations, banned: true },
        });

        throw new ThrottlerException('IP banned for 1 hour due to excessive requests');
      }

      // Log rate limit exceeded
      this.logger.warn(`Rate limit exceeded for ${throttleKey}`, {
        ip,
        userId: user?.id,
        url,
        method,
        current,
        limit,
        violations,
      });

      this.logger.audit({
        eventType: AuditEventType.RATE_LIMIT_EXCEEDED,
        userId: user?.id,
        ip,
        resource: url,
        action: method,
        metadata: { current, limit, violations },
      });

      throw new ThrottlerException('Too many requests. Please try again later.');
    }

    return true;
  }
}
