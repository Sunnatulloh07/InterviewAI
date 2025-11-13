# InterviewAI Pro - Backend Setup Guide

## 📋 Umumiy Ma'lumot

InterviewAI Pro backend qismi **NestJS** frameworki asosida qurilgan, **MongoDB** va **Redis** dan foydalanadi.

## 🏗️ Arxitektura

### Texnologiyalar Stack'i

```
Backend Framework:    NestJS 10.3.3
Language:             TypeScript 5.3.3
Primary Database:     MongoDB 7.x
Cache/Queue:          Redis 7.x
ORM:                  Mongoose 8.1.1
Validation:           class-validator, class-transformer
Documentation:        Swagger/OpenAPI 3.0
Testing:              Jest, Supertest
Authentication:       Passport, JWT
Payment:              Stripe 14.17.0
AI:                   OpenAI 4.28.0
Telegram:             Grammy 1.21.1
Storage:              AWS S3 SDK 3.515.0
```

### Asosiy Modullar

1. **Auth Module** - Authentication va Authorization
2. **Users Module** - Foydalanuvchilarni boshqarish
3. **CV Module** - CV/Resume upload va tahlil
4. **Interviews Module** - Mock interview sessiyalari
5. **AI Module** - OpenAI integratsiyasi (GPT-4, Whisper)
6. **Payments Module** - Stripe to'lovlar
7. **Telegram Module** - Telegram bot
8. **WebSocket Module** - Real-time audio processing
9. **Storage Module** - AWS S3 file storage
10. **Notifications Module** - Email va telegram xabarnomalar
11. **Analytics Module** - Foydalanuvchi statistikasi

## 🚀 O'rnatish

### 1. Talablar

- Node.js >= 20.0.0
- npm >= 10.0.0
- MongoDB >= 7.0
- Redis >= 7.0

### 2. Dependencies O'rnatish

```bash
cd api
npm install
```

### 3. Environment Variables Sozlash

```bash
cp .env.example .env
```

`.env` faylini tahrirlang va kerakli qiymatlarni kiriting:

**Majburiy:**
- `MONGODB_URI` - MongoDB connection string
- `JWT_ACCESS_SECRET` - JWT access token secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret
- `OPENAI_API_KEY` - OpenAI API key
- `STRIPE_API_KEY` - Stripe API key
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `TELEGRAM_BOT_TOKEN` - Telegram bot token

**Secret Key Generatsiya:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Serverni Ishga Tushirish

**Development:**
```bash
npm run start:dev
```

**Production:**
```bash
npm run build
npm run start:prod
```

**Debug mode:**
```bash
npm run start:debug
```

## 📁 Loyiha Strukturasi

```
api/
├── src/
│   ├── main.ts                      # Application entry point
│   ├── app.module.ts                # Root module
│   │
│   ├── config/                      # Configuration files
│   │   ├── database.config.ts       # MongoDB konfiguratsiyasi
│   │   ├── redis.config.ts          # Redis konfiguratsiyasi
│   │   ├── jwt.config.ts            # JWT konfiguratsiyasi
│   │   ├── openai.config.ts         # OpenAI konfiguratsiyasi
│   │   ├── stripe.config.ts         # Stripe konfiguratsiyasi
│   │   ├── aws.config.ts            # AWS S3 konfiguratsiyasi
│   │   └── telegram.config.ts       # Telegram konfiguratsiyasi
│   │
│   ├── common/                      # Shared resources
│   │   ├── guards/                  # Authentication guards
│   │   │   ├── jwt-auth.guard.ts    # JWT authentication
│   │   │   ├── roles.guard.ts       # Role-based authorization
│   │   │   └── rate-limit.guard.ts  # API rate limiting
│   │   │
│   │   ├── filters/                 # Exception filters
│   │   │   └── all-exceptions.filter.ts
│   │   │
│   │   ├── interceptors/            # Request/Response interceptors
│   │   │   ├── logging.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   │
│   │   └── decorators/              # Custom decorators
│   │       ├── public.decorator.ts
│   │       ├── roles.decorator.ts
│   │       ├── current-user.decorator.ts
│   │       └── rate-limit.decorator.ts
│   │
│   ├── database/                    # Database utilities
│   │   ├── database.module.ts
│   │   └── database.service.ts
│   │
│   └── modules/                     # Feature modules (to be implemented)
│       ├── auth/
│       ├── users/
│       ├── cv/
│       ├── interviews/
│       ├── ai/
│       ├── payments/
│       ├── telegram/
│       ├── websocket/
│       ├── storage/
│       ├── notifications/
│       └── analytics/
│
├── test/                            # E2E tests
├── .env                             # Environment variables
├── .env.example                     # Environment template
├── package.json                     # Dependencies
├── tsconfig.json                    # TypeScript config
└── nest-cli.json                    # NestJS config
```

## 🔐 Guards va Security

### 1. JWT Auth Guard

Barcha protected endpoint'larni himoya qiladi:

```typescript
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Get('protected')
protectedRoute() {
  return 'This is protected';
}
```

### 2. Roles Guard

Role-based access control:

```typescript
import { Roles } from './common/decorators/roles.decorator';
import { UserRole } from './common/guards/roles.guard';

@Roles(UserRole.ADMIN, UserRole.ELITE)
@Get('admin-only')
adminOnlyRoute() {
  return 'Admin only';
}
```

### 3. Rate Limit Guard

API rate limiting:

```typescript
import { RateLimit } from './common/decorators/rate-limit.decorator';

@RateLimit(10, 60) // 10 requests per minute
@Post('expensive')
expensiveOperation() {
  return 'Limited endpoint';
}
```

### 4. Public Endpoints

Authentication'dan ozod qilish:

```typescript
import { Public } from './common/decorators/public.decorator';

@Public()
@Get('public')
publicRoute() {
  return 'This is public';
}
```

## 🔧 Konfiguratsiyalar

### MongoDB

```typescript
// Automatic connection pooling
// Min: 10, Max: 100 connections
// Auto-indexing in development
```

### Redis

```typescript
// Key prefix: 'interviewai:'
// DB 0: Sessions
// DB 1: Cache
// DB 2: Queues
```

### Bull Queue

```typescript
// Automatic retries: 3 attempts
// Exponential backoff: 2 seconds
// Auto-cleanup: completed jobs after 1 hour
```

### Rate Limiting

```typescript
// Short: 10 requests/second
// Medium: 100 requests/minute
// Long: 1000 requests/15 minutes
```

## 📊 API Documentation

Development rejimida Swagger dokumentatsiyasi mavjud:

```
http://localhost:3000/api/docs
```

## 🧪 Testing

### Unit Tests

```bash
npm run test
```

### E2E Tests

```bash
npm run test:e2e
```

### Test Coverage

```bash
npm run test:cov
```

## 📦 Latest Package Versions

### Core Dependencies
- @nestjs/common: ^10.3.3
- @nestjs/core: ^10.3.3
- @nestjs/mongoose: ^10.0.4
- mongoose: ^8.1.1
- @nestjs-modules/ioredis: ^2.0.2
- ioredis: ^5.3.2

### Authentication
- @nestjs/jwt: ^10.2.0
- @nestjs/passport: ^10.0.3
- passport-jwt: ^4.0.1
- bcrypt: ^5.1.1

### Validation
- class-validator: ^0.14.1
- class-transformer: ^0.5.1
- joi: ^17.12.1

### AI & External Services
- openai: ^4.28.0
- stripe: ^14.17.0
- grammy: ^1.21.1
- @aws-sdk/client-s3: ^3.515.0

### Queue Management
- @nestjs/bull: ^10.1.0
- bull: ^4.12.2

### Documentation
- @nestjs/swagger: ^7.3.0

### Security
- helmet: ^7.1.0
- @nestjs/throttler: ^5.1.2

### Utilities
- winston: ^3.11.0
- compression: ^1.7.4
- moment: ^2.30.1
- lodash: ^4.17.21

## 🎯 Keyingi Qadamlar

1. **Auth Module** yaratish
2. **Users Module** yaratish
3. **CV Module** yaratish
4. **Interviews Module** yaratish
5. **AI Module** yaratish
6. **Payments Module** yaratish
7. **Telegram Bot** yaratish
8. **WebSocket Gateway** yaratish

## 💡 Best Practices

1. **Validation:** Barcha input'larni validate qiling
2. **Error Handling:** Global exception filter ishlatiladi
3. **Logging:** Winston logger bilan log'lar saqlanadi
4. **Rate Limiting:** Har bir endpoint uchun limit belgilang
5. **Caching:** Tez-tez so'raladigan ma'lumotlarni cache qiling
6. **Testing:** Har bir service va controller uchun test yozing
7. **Documentation:** Swagger bilan API dokumentatsiya qiling
8. **Security:** JWT, helmet, CORS sozlamalari

## 🔍 Monitoring

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

## 🐛 Debugging

1. VSCode debug konfiguratsiyasi
2. Winston logger logs
3. Swagger API testing
4. MongoDB Compass
5. Redis Commander

## 📞 Support

Savol yoki muammo bo'lsa:
- GitHub Issues
- Email: support@interviewai.pro
- Telegram: @interviewai_support

---

**Built with ❤️ using NestJS**

