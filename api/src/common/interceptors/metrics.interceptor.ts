import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, finalize } from 'rxjs/operators';
import { MetricsService } from '../../modules/metrics/metrics.service';

/**
 * Metrics Interceptor
 * Automatically tracks HTTP requests and performance
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, route } = request;
    const routePath = route?.path || request.url;
    const startTime = Date.now();

    // Track request start
    this.metricsService.recordHttpRequestStart();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const duration = Date.now() - startTime;

        // Record successful request
        this.metricsService.recordHttpRequest(method, routePath, statusCode, duration);
      }),
      finalize(() => {
        // Always track request end, even on error
        this.metricsService.recordHttpRequestEnd();

        // If request failed, record with error status
        const response = context.switchToHttp().getResponse();
        if (response.statusCode >= 400) {
          const duration = Date.now() - startTime;
          this.metricsService.recordHttpRequest(method, routePath, response.statusCode, duration);
        }
      }),
    );
  }
}
