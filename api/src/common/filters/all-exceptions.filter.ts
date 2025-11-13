import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger/logger.service';

/**
 * Global Exception Filter with Enhanced Logging
 * - Structured error logging
 * - Security event tracking
 * - User-friendly error responses
 * - Stack trace in development only
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: LoggerService;

  constructor() {
    this.logger = new LoggerService();
    this.logger.setContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        error = (exceptionResponse as any).error || error;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    // Extract request metadata
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const requestId = (request as any).requestId;
    const userId = (request as any).user?.id;

    // Log error with full context
    this.logger.error(
      `Exception: ${method} ${url} - ${status} ${error}`,
      exception instanceof Error ? exception.stack : undefined,
      {
        requestId,
        method,
        url,
        statusCode: status,
        error,
        message,
        ip,
        userAgent,
        userId,
      },
    );

    // Log security events
    if (status === 401) {
      this.logger.security('Unauthorized access attempt', 'medium', {
        requestId,
        url,
        ip,
        userAgent,
      });
    } else if (status === 403) {
      this.logger.security('Forbidden access attempt', 'high', {
        requestId,
        url,
        ip,
        userAgent,
        userId,
      });
    } else if (status === 429) {
      this.logger.security('Rate limit exceeded', 'medium', {
        requestId,
        url,
        ip,
        userAgent,
        userId,
      });
    } else if (status >= 500) {
      this.logger.security('Server error occurred', 'critical', {
        requestId,
        url,
        statusCode: status,
        error,
        message,
      });
    }

    // Prepare error response
    const errorResponse: any = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: url,
      method,
      error,
      message,
      requestId,
    };

    // Include stack trace only in development
    if (process.env.NODE_ENV === 'development' && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    // Send error response
    response.status(status).json(errorResponse);
  }
}
