import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from '../logger/logger.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Enhanced Logging Interceptor with Winston
 * - Structured logging
 * - Request ID tracking
 * - Performance monitoring
 * - User tracking
 * - Detailed metadata
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip, headers, body, user } = request;
    const userAgent = headers['user-agent'] || '';
    const requestId = uuidv4();
    const startTime = Date.now();

    // Set request ID for tracing
    request.requestId = requestId;
    this.logger.setRequestId(requestId);

    // Set user ID if authenticated
    if (user?.id) {
      this.logger.setUserId(user.id);
    }

    // Log incoming request
    this.logger.http(`→ ${method} ${url}`, {
      requestId,
      method,
      url,
      ip,
      userAgent,
      userId: user?.id,
      bodySize: JSON.stringify(body || {}).length,
    });

    return next.handle().pipe(
      tap({
        next: (data) => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const durationMs = Date.now() - startTime;

          // Log successful response
          this.logger.http(`← ${method} ${url} ${statusCode}`, {
            requestId,
            method,
            url,
            statusCode,
            durationMs,
            ip,
            userAgent,
            userId: user?.id,
            responseSize: JSON.stringify(data || {}).length,
          });

          // Track performance
          this.logger.performance(`${method} ${url}`, durationMs, {
            requestId,
            statusCode,
          });
        },
        error: (error) => {
          const durationMs = Date.now() - startTime;
          const statusCode = error?.status || 500;

          // Log error response
          this.logger.error(`✗ ${method} ${url} ${statusCode}`, error?.stack, {
            requestId,
            method,
            url,
            statusCode,
            durationMs,
            ip,
            userAgent,
            userId: user?.id,
            errorMessage: error?.message,
            errorName: error?.name,
          });

          // Log security event for unauthorized access
          if (statusCode === 401 || statusCode === 403) {
            this.logger.security(
              `Unauthorized access attempt: ${method} ${url}`,
              'medium',
              {
                requestId,
                ip,
                userAgent,
                userId: user?.id,
              },
            );
          }
        },
      }),
    );
  }
}
