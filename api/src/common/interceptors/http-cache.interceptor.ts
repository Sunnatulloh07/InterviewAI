import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (method !== 'GET') {
      return next.handle();
    }

    const key = this.getCacheKey(context);

    return new Observable((observer) => {
      this.cacheManager.get(key).then((cachedValue) => {
        if (cachedValue !== undefined && cachedValue !== null) {
          observer.next(cachedValue);
          observer.complete();
          return;
        }

        return next
          .handle()
          .pipe(
            tap((response) => {
              const ttl = this.getCacheTTL(context);
              this.cacheManager.set(key, response, ttl).catch((err) => {
                console.error('Cache set error:', err);
              });
            }),
          )
          .subscribe({
            next: (value) => observer.next(value),
            error: (err) => observer.error(err),
            complete: () => observer.complete(),
          });
      });
    });
  }

  private getCacheKey(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();
    const url = request.url;
    const query = request.query;
    const userId = request.user?.id || 'anonymous';

    const queryString = Object.keys(query).length > 0 ? JSON.stringify(query) : '';

    return `http:${userId}:${url}:${queryString}`;
  }

  private getCacheTTL(context: ExecutionContext): number {
    const request = context.switchToHttp().getRequest();
    const url = request.url;

    const cacheTTL: Record<string, number> = {
      '/analytics/overview': 300, // 5 minutes
      '/analytics/plans': 600, // 10 minutes
      '/analytics/features': 300, // 5 minutes
      '/analytics/usage': 300, // 5 minutes
      '/analytics/voice-quota': 300, // 5 minutes
      '/analytics/daily-tasks': 300, // 5 minutes
      '/analytics/revenue': 600, // 10 minutes
      '/admin/overview': 300, // 5 minutes
      '/admin/users': 300, // 5 minutes
      '/admin/subscriptions': 300, // 5 minutes
      '/admin/revenue': 600, // 10 minutes
      '/admin/usage': 300, // 5 minutes
      '/admin/plans': 600, // 10 minutes
      '/admin/daily-tasks': 300, // 5 minutes
      '/admin/voice-quota': 300, // 5 minutes
      '/interviews/questions': 3600, // 1 hour
      '/interviews/session': 600, // 10 minutes
      '/cv/analysis': 300, // 5 minutes
      '/voice/quota': 300, // 5 minutes
    };

    for (const [path, ttl] of Object.entries(cacheTTL)) {
      if (url.includes(path)) {
        return ttl;
      }
    }

    return 60; // Default: 1 minute
  }
}
