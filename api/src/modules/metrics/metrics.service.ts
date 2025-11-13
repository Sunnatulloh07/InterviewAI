import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Metrics Service
 * Prometheus-compatible metrics collection
 */
@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // HTTP Metrics
  private readonly httpRequestsTotal: Counter;
  private readonly httpRequestDuration: Histogram;
  private readonly httpRequestsInProgress: Gauge;

  // Database Metrics
  private readonly dbQueriesTotal: Counter;
  private readonly dbQueryDuration: Histogram;
  private readonly dbConnectionsActive: Gauge;

  // Cache Metrics
  private readonly cacheHitsTotal: Counter;
  private readonly cacheMissesTotal: Counter;
  private readonly cacheOperationDuration: Histogram;

  // External API Metrics
  private readonly externalApiCallsTotal: Counter;
  private readonly externalApiDuration: Histogram;
  private readonly externalApiErrors: Counter;

  // Business Metrics
  private readonly interviewsStarted: Counter;
  private readonly interviewsCompleted: Counter;
  private readonly cvAnalysesTotal: Counter;
  private readonly activeUsers: Gauge;
  private readonly subscriptionsActive: Gauge;

  // AI Metrics
  private readonly aiTokensUsed: Counter;
  private readonly aiRequestsTotal: Counter;
  private readonly aiRequestDuration: Histogram;
  private readonly aiErrors: Counter;

  constructor() {
    // Create registry
    this.registry = new Registry();

    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // Initialize HTTP metrics
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.httpRequestsInProgress = new Gauge({
      name: 'http_requests_in_progress',
      help: 'Number of HTTP requests currently being processed',
      registers: [this.registry],
    });

    // Initialize Database metrics
    this.dbQueriesTotal = new Counter({
      name: 'db_queries_total',
      help: 'Total number of database queries',
      labelNames: ['collection', 'operation'],
      registers: [this.registry],
    });

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_ms',
      help: 'Database query duration in milliseconds',
      labelNames: ['collection', 'operation'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });

    this.dbConnectionsActive = new Gauge({
      name: 'db_connections_active',
      help: 'Number of active database connections',
      registers: [this.registry],
    });

    // Initialize Cache metrics
    this.cacheHitsTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_name'],
      registers: [this.registry],
    });

    this.cacheMissesTotal = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_name'],
      registers: [this.registry],
    });

    this.cacheOperationDuration = new Histogram({
      name: 'cache_operation_duration_ms',
      help: 'Cache operation duration in milliseconds',
      labelNames: ['cache_name', 'operation'],
      buckets: [1, 2, 5, 10, 25, 50, 100],
      registers: [this.registry],
    });

    // Initialize External API metrics
    this.externalApiCallsTotal = new Counter({
      name: 'external_api_calls_total',
      help: 'Total number of external API calls',
      labelNames: ['service', 'endpoint', 'status'],
      registers: [this.registry],
    });

    this.externalApiDuration = new Histogram({
      name: 'external_api_duration_ms',
      help: 'External API call duration in milliseconds',
      labelNames: ['service', 'endpoint'],
      buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
      registers: [this.registry],
    });

    this.externalApiErrors = new Counter({
      name: 'external_api_errors_total',
      help: 'Total number of external API errors',
      labelNames: ['service', 'endpoint', 'error_type'],
      registers: [this.registry],
    });

    // Initialize Business metrics
    this.interviewsStarted = new Counter({
      name: 'interviews_started_total',
      help: 'Total number of interviews started',
      labelNames: ['type', 'difficulty'],
      registers: [this.registry],
    });

    this.interviewsCompleted = new Counter({
      name: 'interviews_completed_total',
      help: 'Total number of interviews completed',
      labelNames: ['type', 'difficulty'],
      registers: [this.registry],
    });

    this.cvAnalysesTotal = new Counter({
      name: 'cv_analyses_total',
      help: 'Total number of CV analyses performed',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.activeUsers = new Gauge({
      name: 'active_users',
      help: 'Number of active users',
      registers: [this.registry],
    });

    this.subscriptionsActive = new Gauge({
      name: 'subscriptions_active',
      help: 'Number of active subscriptions by plan',
      labelNames: ['plan'],
      registers: [this.registry],
    });

    // Initialize AI metrics
    this.aiTokensUsed = new Counter({
      name: 'ai_tokens_used_total',
      help: 'Total number of AI tokens used',
      labelNames: ['model', 'type'],
      registers: [this.registry],
    });

    this.aiRequestsTotal = new Counter({
      name: 'ai_requests_total',
      help: 'Total number of AI requests',
      labelNames: ['model', 'operation'],
      registers: [this.registry],
    });

    this.aiRequestDuration = new Histogram({
      name: 'ai_request_duration_ms',
      help: 'AI request duration in milliseconds',
      labelNames: ['model', 'operation'],
      buckets: [500, 1000, 2000, 3000, 5000, 10000, 15000, 30000],
      registers: [this.registry],
    });

    this.aiErrors = new Counter({
      name: 'ai_errors_total',
      help: 'Total number of AI errors',
      labelNames: ['model', 'error_type'],
      registers: [this.registry],
    });
  }

  /**
   * Get Prometheus metrics
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(method: string, route: string, status: number, duration: number) {
    this.httpRequestsTotal.inc({ method, route, status });
    this.httpRequestDuration.observe({ method, route, status }, duration);
  }

  /**
   * Record HTTP request start
   */
  recordHttpRequestStart() {
    this.httpRequestsInProgress.inc();
  }

  /**
   * Record HTTP request end
   */
  recordHttpRequestEnd() {
    this.httpRequestsInProgress.dec();
  }

  /**
   * Record database query
   */
  recordDbQuery(collection: string, operation: string, duration: number) {
    this.dbQueriesTotal.inc({ collection, operation });
    this.dbQueryDuration.observe({ collection, operation }, duration);
  }

  /**
   * Update active database connections
   */
  updateDbConnections(count: number) {
    this.dbConnectionsActive.set(count);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(cacheName: string) {
    this.cacheHitsTotal.inc({ cache_name: cacheName });
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(cacheName: string) {
    this.cacheMissesTotal.inc({ cache_name: cacheName });
  }

  /**
   * Record cache operation
   */
  recordCacheOperation(cacheName: string, operation: string, duration: number) {
    this.cacheOperationDuration.observe({ cache_name: cacheName, operation }, duration);
  }

  /**
   * Record external API call
   */
  recordExternalApiCall(service: string, endpoint: string, status: number, duration: number) {
    this.externalApiCallsTotal.inc({ service, endpoint, status });
    this.externalApiDuration.observe({ service, endpoint }, duration);
  }

  /**
   * Record external API error
   */
  recordExternalApiError(service: string, endpoint: string, errorType: string) {
    this.externalApiErrors.inc({ service, endpoint, error_type: errorType });
  }

  /**
   * Record interview started
   */
  recordInterviewStarted(type: string, difficulty: string) {
    this.interviewsStarted.inc({ type, difficulty });
  }

  /**
   * Record interview completed
   */
  recordInterviewCompleted(type: string, difficulty: string) {
    this.interviewsCompleted.inc({ type, difficulty });
  }

  /**
   * Record CV analysis
   */
  recordCvAnalysis(status: 'success' | 'error') {
    this.cvAnalysesTotal.inc({ status });
  }

  /**
   * Update active users count
   */
  updateActiveUsers(count: number) {
    this.activeUsers.set(count);
  }

  /**
   * Update active subscriptions
   */
  updateActiveSubscriptions(plan: string, count: number) {
    this.subscriptionsActive.set({ plan }, count);
  }

  /**
   * Record AI tokens used
   */
  recordAiTokensUsed(model: string, type: 'prompt' | 'completion', tokens: number) {
    this.aiTokensUsed.inc({ model, type }, tokens);
  }

  /**
   * Record AI request
   */
  recordAiRequest(model: string, operation: string, duration: number) {
    this.aiRequestsTotal.inc({ model, operation });
    this.aiRequestDuration.observe({ model, operation }, duration);
  }

  /**
   * Record AI error
   */
  recordAiError(model: string, errorType: string) {
    this.aiErrors.inc({ model, error_type: errorType });
  }
}
