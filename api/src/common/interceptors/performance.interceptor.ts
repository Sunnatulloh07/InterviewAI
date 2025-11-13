import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from '../logger/logger.service';
import { TRACK_PERFORMANCE_KEY } from '../decorators/track-performance.decorator';

/**
 * Performance Monitoring Interceptor
 * Tracks method execution time and logs slow operations
 */
@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PerformanceInterceptor');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const operationName = this.reflector.get<string>(
      TRACK_PERFORMANCE_KEY,
      context.getHandler(),
    );

    // Skip if no performance tracking metadata
    if (!operationName) {
      return next.handle();
    }

    const startTime = Date.now();
    const className = context.getClass().name;
    const methodName = context.getHandler().name;
    const fullOperationName = operationName || `${className}.${methodName}`;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.performance(fullOperationName, duration);

          // Alert if operation is very slow (> 5 seconds)
          if (duration > 5000) {
            this.logger.error(
              `Very slow operation detected: ${fullOperationName}`,
              undefined,
              { duration, threshold: 5000 },
            );
          }
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `Operation failed: ${fullOperationName}`,
            error.stack,
            { duration, error: error.message },
          );
        },
      }),
    );
  }
}
