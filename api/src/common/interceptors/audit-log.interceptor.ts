import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from '../logger/logger.service';
import { AuditEventType } from '../logger/winston.config';
import { AUDIT_LOG_KEY } from '../decorators/audit-log.decorator';

/**
 * Audit Log Interceptor
 * Automatically logs audit events for decorated endpoints
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AuditLogInterceptor');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const eventType = this.reflector.get<AuditEventType>(AUDIT_LOG_KEY, context.getHandler());

    // Skip if no audit log metadata
    if (!eventType) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { user, ip, headers, body, params, query } = request;
    const userAgent = headers['user-agent'];

    return next.handle().pipe(
      tap({
        next: () => {
          // Log successful operation
          this.logger.audit({
            eventType,
            userId: user?.id,
            telegramId: user?.telegramId,
            ip,
            userAgent,
            resource: this.getResourceName(context),
            action: request.method,
            result: 'success',
            metadata: {
              params,
              query,
              // Only log non-sensitive body fields
              body: this.sanitizeBody(body),
            },
          });
        },
        error: (error) => {
          // Log failed operation
          this.logger.audit({
            eventType,
            userId: user?.id,
            telegramId: user?.telegramId,
            ip,
            userAgent,
            resource: this.getResourceName(context),
            action: request.method,
            result: 'failure',
            errorMessage: error.message,
            metadata: {
              statusCode: error.status,
              params,
              query,
            },
          });
        },
      }),
    );
  }

  /**
   * Get resource name from route
   */
  private getResourceName(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();
    return request.route?.path || request.url;
  }

  /**
   * Remove sensitive fields from body
   */
  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return undefined;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'otp', 'otpCode'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
