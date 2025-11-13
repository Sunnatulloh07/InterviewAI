import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';

/**
 * Winston Logger Configuration
 * Production-grade structured logging with:
 * - Daily rotation of log files
 * - Separate files for errors
 * - JSON formatting for log aggregation tools
 * - Console output for development
 * - Performance-optimized
 */

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ['timestamp', 'level', 'message', 'context'],
  }),
);

// JSON format for production (ELK, CloudWatch, etc.)
const jsonFormat = winston.format.combine(customFormat, winston.format.json());

// Pretty format for development
const consoleFormat = winston.format.combine(
  customFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, context, metadata }) => {
    const metaStr = Object.keys(metadata).length
      ? `\n${JSON.stringify(metadata, null, 2)}`
      : '';
    const ctx = context ? `[${context}]` : '';
    return `${timestamp} ${level} ${ctx} ${message}${metaStr}`;
  }),
);

// Log levels configuration
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Create logs directory
const logsDir = path.join(process.cwd(), 'logs');

/**
 * Create Winston Logger instance
 */
export const createWinstonLogger = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

  // Transport for all logs with rotation
  const allLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d', // Keep logs for 14 days
    format: jsonFormat,
    level: logLevel,
  });

  // Transport for error logs
  const errorLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d', // Keep error logs for 30 days
    format: jsonFormat,
    level: 'error',
  });

  // Transport for HTTP logs (API requests)
  const httpLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'http-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '7d', // Keep HTTP logs for 7 days
    format: jsonFormat,
    level: 'http',
  });

  // Transport for audit logs (security-critical events)
  const auditLogsTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'audit-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '90d', // Keep audit logs for 90 days (compliance)
    format: jsonFormat,
  });

  const transports: winston.transport[] = [
    allLogsTransport,
    errorLogsTransport,
    httpLogsTransport,
    auditLogsTransport,
  ];

  // Add console transport for non-production or if enabled
  if (!isProduction || process.env.LOG_CONSOLE === 'true') {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
        level: logLevel,
      }),
    );
  }

  return winston.createLogger({
    levels,
    level: logLevel,
    transports,
    // Don't exit on error
    exitOnError: false,
    // Handle uncaught exceptions and rejections
    exceptionHandlers: [
      new DailyRotateFile({
        filename: path.join(logsDir, 'exceptions-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: jsonFormat,
      }),
    ],
    rejectionHandlers: [
      new DailyRotateFile({
        filename: path.join(logsDir, 'rejections-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: jsonFormat,
      }),
    ],
  });
};

/**
 * Audit log event types for security tracking
 */
export enum AuditEventType {
  USER_LOGIN = 'user.login',
  USER_LOGOUT = 'user.logout',
  USER_REGISTER = 'user.register',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',
  PASSWORD_CHANGE = 'password.change',
  PASSWORD_RESET = 'password.reset',
  TWO_FA_ENABLED = '2fa.enabled',
  TWO_FA_DISABLED = '2fa.disabled',
  TWO_FA_VERIFIED = '2fa.verified',
  API_KEY_CREATED = 'api_key.created',
  API_KEY_ROTATED = 'api_key.rotated',
  API_KEY_DELETED = 'api_key.deleted',
  PAYMENT_SUCCESS = 'payment.success',
  PAYMENT_FAILED = 'payment.failed',
  SUBSCRIPTION_CREATED = 'subscription.created',
  SUBSCRIPTION_CANCELLED = 'subscription.cancelled',
  CV_UPLOADED = 'cv.uploaded',
  CV_DELETED = 'cv.deleted',
  INTERVIEW_STARTED = 'interview.started',
  INTERVIEW_COMPLETED = 'interview.completed',
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',
  UNAUTHORIZED_ACCESS = 'unauthorized.access',
  SUSPICIOUS_ACTIVITY = 'suspicious.activity',
}

/**
 * Audit log metadata interface
 */
export interface AuditLogMetadata {
  eventType: AuditEventType;
  userId?: string;
  telegramId?: number;
  ip?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  result?: 'success' | 'failure';
  errorMessage?: string;
  metadata?: Record<string, any>;
}

// Export singleton instance
export const logger = createWinstonLogger();
