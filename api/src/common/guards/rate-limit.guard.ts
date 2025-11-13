import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { RATE_LIMIT_KEY, RATE_LIMIT_WINDOW_KEY } from '../constants/metadata-keys';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Skip rate limiting if no user (handled by auth guard)
    if (!user) {
      return true;
    }

    // Get rate limit config from decorator
    const limit = this.reflector.get<number>(RATE_LIMIT_KEY, context.getHandler()) || 100;
    const window = this.reflector.get<number>(RATE_LIMIT_WINDOW_KEY, context.getHandler()) || 60;

    const key = `ratelimit:${user.id}:${request.route.path}`;

    try {
      // Get current count with error handling
      let current: string | null;
      try {
        current = await this.redis.get(key);
      } catch (error) {
        // If Redis fails, allow request (graceful degradation)
        // Log error but don't block user
        console.error(`Rate limit Redis GET failed: ${error.message}`);
        return true;
      }

      const count = current ? parseInt(current, 10) : 0;

      if (count >= limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: window,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Increment counter with error handling
      try {
        const multi = this.redis.multi();
        multi.incr(key);
        if (count === 0) {
          multi.expire(key, window);
        }
        await multi.exec();
      } catch (error) {
        // If Redis fails during increment, allow request (graceful degradation)
        console.error(`Rate limit Redis INCR failed: ${error.message}`);
        // Continue without rate limiting
      }

      // Add rate limit headers
      const response = context.switchToHttp().getResponse();
      response.setHeader('X-RateLimit-Limit', limit);
      response.setHeader('X-RateLimit-Remaining', limit - count - 1);
      response.setHeader('X-RateLimit-Reset', Date.now() + window * 1000);

      return true;
    } catch (error) {
      // If it's an HttpException (rate limit exceeded), re-throw it
      if (error instanceof HttpException) {
        throw error;
      }
      // For other errors, allow request (graceful degradation)
      console.error(`Rate limit check failed: ${error.message}`);
      return true;
    }
  }
}
