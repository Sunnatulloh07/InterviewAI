import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import { logger, AuditEventType, AuditLogMetadata } from './winston.config';

/**
 * Custom Logger Service
 * Production-grade logging with:
 * - Structured logging (JSON)
 * - Context tracking
 * - Audit logging for security events
 * - Performance tracking
 * - Error tracking with stack traces
 */
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  private context?: string;
  private userId?: string;
  private requestId?: string;

  /**
   * Set context for all subsequent logs
   */
  setContext(context: string) {
    this.context = context;
    return this;
  }

  /**
   * Set user ID for tracking user actions
   */
  setUserId(userId: string) {
    this.userId = userId;
    return this;
  }

  /**
   * Set request ID for request tracing
   */
  setRequestId(requestId: string) {
    this.requestId = requestId;
    return this;
  }

  /**
   * Build metadata object with context
   */
  private buildMetadata(meta?: Record<string, any>) {
    return {
      context: this.context,
      userId: this.userId,
      requestId: this.requestId,
      ...meta,
    };
  }

  /**
   * Log informational message
   */
  log(message: string, meta?: Record<string, any>) {
    logger.info(message, this.buildMetadata(meta));
  }

  /**
   * Log error with stack trace
   */
  error(message: string, trace?: string, meta?: Record<string, any>) {
    logger.error(message, {
      ...this.buildMetadata(meta),
      stack: trace,
    });
  }

  /**
   * Log warning
   */
  warn(message: string, meta?: Record<string, any>) {
    logger.warn(message, this.buildMetadata(meta));
  }

  /**
   * Log debug information (development only)
   */
  debug(message: string, meta?: Record<string, any>) {
    logger.debug(message, this.buildMetadata(meta));
  }

  /**
   * Log verbose information
   */
  verbose(message: string, meta?: Record<string, any>) {
    logger.debug(message, this.buildMetadata(meta));
  }

  /**
   * Log HTTP request/response
   */
  http(message: string, meta?: Record<string, any>) {
    logger.http(message, this.buildMetadata(meta));
  }

  /**
   * Log audit event for security tracking
   * These logs are kept for 90 days for compliance
   */
  audit(metadata: AuditLogMetadata) {
    const { eventType, userId, telegramId, ip, userAgent, resource, action, result, errorMessage, metadata: additionalMeta } = metadata;

    logger.info(`[AUDIT] ${eventType}`, {
      level: 'audit',
      eventType,
      userId: userId || this.userId,
      telegramId,
      ip,
      userAgent,
      resource,
      action,
      result,
      errorMessage,
      timestamp: new Date().toISOString(),
      ...additionalMeta,
    });
  }

  /**
   * Log performance metrics
   */
  performance(operation: string, durationMs: number, meta?: Record<string, any>) {
    logger.info(`[PERFORMANCE] ${operation}`, {
      ...this.buildMetadata(meta),
      operation,
      durationMs,
      level: 'performance',
    });

    // Warn if operation is slow (> 1 second)
    if (durationMs > 1000) {
      logger.warn(`[PERFORMANCE] Slow operation: ${operation}`, {
        ...this.buildMetadata(meta),
        durationMs,
      });
    }
  }

  /**
   * Log database query performance
   */
  dbQuery(query: string, durationMs: number, meta?: Record<string, any>) {
    logger.debug(`[DB] ${query}`, {
      ...this.buildMetadata(meta),
      query,
      durationMs,
      level: 'database',
    });

    // Warn if query is slow (> 500ms)
    if (durationMs > 500) {
      logger.warn(`[DB] Slow query: ${query}`, {
        ...this.buildMetadata(meta),
        durationMs,
      });
    }
  }

  /**
   * Log external API call
   */
  apiCall(service: string, endpoint: string, durationMs: number, statusCode?: number, meta?: Record<string, any>) {
    logger.info(`[API] ${service} ${endpoint}`, {
      ...this.buildMetadata(meta),
      service,
      endpoint,
      durationMs,
      statusCode,
      level: 'api',
    });

    // Warn if API call is slow (> 2 seconds)
    if (durationMs > 2000) {
      logger.warn(`[API] Slow API call: ${service} ${endpoint}`, {
        ...this.buildMetadata(meta),
        durationMs,
        statusCode,
      });
    }
  }

  /**
   * Log security event
   */
  security(event: string, severity: 'low' | 'medium' | 'high' | 'critical', meta?: Record<string, any>) {
    const level = severity === 'critical' || severity === 'high' ? 'error' : 'warn';

    logger[level](`[SECURITY] ${event}`, {
      ...this.buildMetadata(meta),
      severity,
      level: 'security',
    });

    // Also log to audit trail
    this.audit({
      eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
      userId: this.userId,
      metadata: { event, severity, ...meta },
    });
  }

  /**
   * Create child logger with new context
   */
  child(context: string): LoggerService {
    const childLogger = new LoggerService();
    childLogger.setContext(context);
    if (this.userId) childLogger.setUserId(this.userId);
    if (this.requestId) childLogger.setRequestId(this.requestId);
    return childLogger;
  }
}
