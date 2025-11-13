# Monitoring & Security Features

This document describes the comprehensive monitoring and security features implemented in InterviewAI Pro.

## 🎯 Overview

InterviewAI Pro now includes **production-grade monitoring and security** features:

- ✅ **Structured Logging** (Winston)
- ✅ **Health Checks** (Terminus)
- ✅ **Metrics Collection** (Prometheus)
- ✅ **Audit Logging** (90-day retention)
- ✅ **2FA Authentication** (TOTP)
- ✅ **Advanced Rate Limiting**
- ✅ **Security Headers** (CSP, HSTS, etc.)
- ✅ **Alerting System** (Slack, Discord, Webhooks)
- ✅ **Performance Monitoring**

---

## 📊 Monitoring Features

### 1. Structured Logging (Winston)

**Location:** `src/common/logger/`

**Features:**
- JSON-formatted logs for easy parsing
- Daily log rotation with compression
- Separate files for different log types:
  - `application-*.log` - All logs
  - `error-*.log` - Error logs (30-day retention)
  - `http-*.log` - HTTP requests (7-day retention)
  - `audit-*.log` - Security events (90-day retention)
  - `exceptions-*.log` - Uncaught exceptions
  - `rejections-*.log` - Unhandled promise rejections

**Usage:**
```typescript
import { LoggerService } from './common/logger/logger.service';

constructor(private readonly logger: LoggerService) {
  this.logger.setContext('MyService');
}

// Log messages
this.logger.log('Operation successful');
this.logger.error('Operation failed', error.stack);
this.logger.warn('Warning message');

// Log performance
this.logger.performance('database query', 150); // 150ms

// Log API calls
this.logger.apiCall('OpenAI', '/v1/chat/completions', 2500, 200);

// Log security events
this.logger.security('Suspicious activity detected', 'high', { userId, ip });

// Log audit events
this.logger.audit({
  eventType: AuditEventType.USER_LOGIN,
  userId: user.id,
  ip: request.ip,
  result: 'success',
});
```

**Configuration:**
```env
LOG_LEVEL=debug          # error, warn, info, http, debug
LOG_CONSOLE=true         # Enable console logging
```

---

### 2. Health Checks

**Endpoint:** `GET /api/v1/health`

**Available Endpoints:**
- `/health` - Basic health check
- `/health/detailed` - Detailed health with all dependencies
- `/health/liveness` - Kubernetes liveness probe
- `/health/readiness` - Kubernetes readiness probe
- `/health/metrics` - Application metrics
- `/health/info` - System information

**Monitored Services:**
- MongoDB connection and performance
- Redis connection and latency
- OpenAI API availability
- AWS S3 connectivity
- Memory usage (RSS, Heap)
- Disk usage

**Example Response:**
```json
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up",
      "state": "connected",
      "host": "localhost",
      "collections": 12,
      "connections": 5
    },
    "cache": {
      "status": "up",
      "state": "connected",
      "latency": "2ms",
      "usedMemory": "1.5MB"
    },
    "openai": {
      "status": "up",
      "provider": "OpenAI",
      "latency": "150ms"
    }
  }
}
```

---

### 3. Prometheus Metrics

**Endpoint:** `GET /api/v1/metrics`

**Collected Metrics:**

**HTTP Metrics:**
- `http_requests_total` - Total HTTP requests (by method, route, status)
- `http_request_duration_ms` - Request duration histogram
- `http_requests_in_progress` - Current active requests

**Database Metrics:**
- `db_queries_total` - Total database queries
- `db_query_duration_ms` - Query duration histogram
- `db_connections_active` - Active connections

**Cache Metrics:**
- `cache_hits_total` - Cache hits
- `cache_misses_total` - Cache misses
- `cache_operation_duration_ms` - Cache operation duration

**External API Metrics:**
- `external_api_calls_total` - External API calls
- `external_api_duration_ms` - API call duration
- `external_api_errors_total` - API errors

**Business Metrics:**
- `interviews_started_total` - Interviews started
- `interviews_completed_total` - Interviews completed
- `cv_analyses_total` - CV analyses
- `active_users` - Current active users
- `subscriptions_active` - Active subscriptions by plan

**AI Metrics:**
- `ai_tokens_used_total` - AI tokens consumed
- `ai_requests_total` - AI API requests
- `ai_request_duration_ms` - AI request duration
- `ai_errors_total` - AI errors

**Integration:**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'interviewai'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/v1/metrics'
```

---

### 4. Audit Logging

**Purpose:** Track security-critical events for compliance and forensics.

**Retention:** 90 days

**Events Tracked:**
- User login/logout/register
- Password changes
- 2FA enable/disable
- API key operations
- Payment events
- Subscription changes
- CV uploads/deletes
- Interview sessions
- Rate limit violations
- Unauthorized access attempts
- Suspicious activity

**Log Format:**
```json
{
  "level": "audit",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "eventType": "user.login",
  "userId": "507f1f77bcf86cd799439011",
  "telegramId": 123456789,
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "result": "success"
}
```

---

### 5. Alerting System

**Configuration:**
```env
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Supported Channels:**
- Slack
- Discord
- Custom webhooks

**Alert Levels:**
- 🟢 `INFO` - Informational
- 🟡 `WARNING` - Warning
- 🟠 `ERROR` - Error
- 🔴 `CRITICAL` - Critical

**Pre-configured Alerts:**
- Database connection lost
- Cache connection lost
- High error rate (> 5%)
- High memory usage (> 90%)
- Security threats
- Payment failures
- API quota exceeded
- Deployment notifications

**Usage:**
```typescript
import { AlertsService } from './modules/alerts/alerts.service';

// Send critical alert
await this.alertsService.alertDatabaseDown();

// Send custom alert
await this.alertsService.sendCriticalAlert(
  'Custom Alert',
  'Something critical happened',
  { metadata: 'value' }
);
```

---

### 6. Performance Monitoring

**Features:**
- Automatic HTTP request tracking
- Method-level performance tracking
- Slow operation detection and warnings
- Database query profiling

**Usage:**
```typescript
import { TrackPerformance } from './common/decorators/track-performance.decorator';

@TrackPerformance('user_registration')
async registerUser(dto: RegisterDto) {
  // Automatically tracked
}
```

**Thresholds:**
- HTTP requests > 1s → Warning
- Database queries > 500ms → Warning
- Operations > 5s → Error
- API calls > 2s → Warning

---

## 🔒 Security Features

### 1. Two-Factor Authentication (2FA)

**Type:** TOTP (Time-based One-Time Password)

**Compatible Apps:**
- Google Authenticator
- Authy
- Microsoft Authenticator
- Any TOTP app

**Endpoints:**
- `POST /api/v1/two-factor/generate` - Generate secret & QR code
- `POST /api/v1/two-factor/enable` - Enable 2FA
- `POST /api/v1/two-factor/verify` - Verify token
- `DELETE /api/v1/two-factor/disable` - Disable 2FA
- `POST /api/v1/two-factor/backup-codes/regenerate` - Regenerate backup codes

**Features:**
- QR code generation
- 10 backup codes
- Rate limiting (5 attempts, 15-min lockout)
- Automatic account locking
- Audit logging

**Flow:**
1. User requests 2FA setup
2. Backend generates secret and QR code
3. User scans QR code with authenticator app
4. User verifies with first token
5. Backend enables 2FA and provides backup codes
6. User saves backup codes securely

---

### 2. Advanced Rate Limiting

**Implementation:** Redis-based distributed rate limiting

**Features:**
- IP-based and user-based limiting
- Progressive throttling
- Automatic IP banning (10 violations → 1-hour ban)
- Multiple time windows
- Detailed logging and metrics

**Configuration:**
```env
THROTTLE_TTL_SHORT=60
THROTTLE_LIMIT_SHORT=10      # 10 requests per minute

THROTTLE_TTL_MEDIUM=300
THROTTLE_LIMIT_MEDIUM=50     # 50 requests per 5 minutes

THROTTLE_TTL_LONG=3600
THROTTLE_LIMIT_LONG=200      # 200 requests per hour
```

**Endpoint-Specific Limits:**
```typescript
@UseGuards(AdvancedThrottleGuard)
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 per minute
async sensitiveOperation() {
  // ...
}
```

---

### 3. Security Headers

**Implemented Headers:**
- `Content-Security-Policy` - XSS protection
- `Strict-Transport-Security` - HSTS (production only)
- `X-Frame-Options` - Clickjacking protection
- `X-Content-Type-Options` - MIME sniffing protection
- `X-XSS-Protection` - Legacy XSS protection
- `Referrer-Policy` - Referrer control
- `Permissions-Policy` - Feature control
- `Cross-Origin-*` policies - CORS protection

**Configuration:**
All headers are configured automatically in `SecurityMiddleware`.

---

### 4. CSRF Protection

**Implementation:** Token-based CSRF protection

**Features:**
- Automatic CSRF token generation
- Session-based validation
- Skips safe methods (GET, HEAD, OPTIONS)
- Skips Bearer token auth
- Skips public endpoints

---

### 5. Input Validation & Sanitization

**Implementation:** `class-validator` + `class-transformer`

**Features:**
- Whitelist validation (removes unknown properties)
- Type transformation
- Custom validators
- Nested object validation

---

### 6. Secrets Management

**Best Practices:**
- ✅ All secrets in environment variables
- ✅ `.env.example` template provided
- ✅ Strong validation (min 32 characters for JWT secrets)
- ✅ `.gitignore` configured properly
- ✅ No hardcoded secrets in code
- ❌ Never commit `.env` files

**How to Generate Secrets:**
```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSL
openssl rand -hex 32
```

---

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Copy example environment file
cp api/.env.example api/.env

# Edit .env and fill in your secrets
nano api/.env
```

### 2. Install Dependencies

```bash
cd api
npm install
```

### 3. Start Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### 4. Verify Features

**Health Check:**
```bash
curl http://localhost:3000/api/v1/health
```

**Metrics:**
```bash
curl http://localhost:3000/api/v1/metrics
```

**Logs:**
```bash
tail -f api/logs/application-*.log
```

---

## 📈 Monitoring Setup

### Option 1: Prometheus + Grafana

**1. Install Prometheus:**
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'interviewai'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/v1/metrics'
```

**2. Install Grafana:**
- Add Prometheus data source
- Import InterviewAI dashboard (create custom)

### Option 2: Cloud Monitoring

**DataDog:**
```bash
npm install @datadog/browser-rum
```

**New Relic:**
```bash
npm install newrelic
```

---

## 🔐 Security Checklist

Before going to production:

- [ ] Change all default passwords
- [ ] Generate strong random secrets (min 32 chars)
- [ ] Enable HTTPS/SSL
- [ ] Configure firewall rules
- [ ] Set up backup system
- [ ] Configure log rotation
- [ ] Set up monitoring alerts
- [ ] Review CORS configuration
- [ ] Enable 2FA for admin accounts
- [ ] Test rate limiting
- [ ] Review audit logs
- [ ] Configure Sentry for error tracking
- [ ] Set up automated security scanning
- [ ] Review database permissions
- [ ] Secure Redis with password
- [ ] Configure webhook alerts

---

## 📞 Support

For questions or issues:
- Review logs in `api/logs/`
- Check health endpoint: `/api/v1/health/detailed`
- Review metrics: `/api/v1/metrics`
- Check audit logs: `api/logs/audit-*.log`

---

## 🎉 Summary

InterviewAI Pro now has **enterprise-grade monitoring and security**:

**Monitoring:**
- ✅ Winston structured logging
- ✅ Comprehensive health checks
- ✅ Prometheus metrics
- ✅ Audit logging (90-day retention)
- ✅ Real-time alerting
- ✅ Performance tracking

**Security:**
- ✅ 2FA authentication
- ✅ Advanced rate limiting
- ✅ Security headers (CSP, HSTS, etc.)
- ✅ CSRF protection
- ✅ Input validation
- ✅ Secrets management

**Production Ready:** ✅

All features are **100% implemented** and **ready for production use**!
