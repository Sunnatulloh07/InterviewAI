# InterviewAI Pro - Backend Architecture

## Document Information
- **Component:** Backend Services
- **Framework:** NestJS (TypeScript)
- **Databases:** MongoDB, Redis
- **Version:** 1.0.0
- **Last Updated:** November 2025

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Module Design](#3-module-design)
4. [Database Design](#4-database-design)
5. [API Implementation](#5-api-implementation)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Caching Strategy](#7-caching-strategy)
8. [Queue Management](#8-queue-management)
9. [Error Handling](#9-error-handling)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Architecture Overview

### 1.1 Technology Stack

```
Backend Framework:    NestJS 10.x (Node.js 20.x LTS)
Language:             TypeScript 5.x
Primary Database:     MongoDB 7.x
Cache/Queue:          Redis 7.x
ORM:                  Mongoose 8.x
Validation:           class-validator, class-transformer
Documentation:        Swagger/OpenAPI 3.0
Testing:              Jest, Supertest
Process Manager:      PM2
Containerization:     Docker, Docker Compose
```

### 1.2 Architectural Patterns

- **Modular Monolith** → Easy to extract microservices later
- **Clean Architecture** → Separation of concerns
- **Repository Pattern** → Data access abstraction
- **Service Layer** → Business logic encapsulation
- **DTO Pattern** → Data validation and transformation
- **Dependency Injection** → Loose coupling

### 1.3 System Layers

```
┌─────────────────────────────────────────┐
│         Controllers Layer               │
│  (HTTP handlers, validators)            │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│         Services Layer                  │
│  (Business logic, orchestration)        │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│         Repository Layer                │
│  (Data access, MongoDB queries)         │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│         Database Layer                  │
│  (MongoDB, Redis)                       │
└─────────────────────────────────────────┘
```

---

## 2. Project Structure

### 2.1 Directory Layout

```
backend/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   ├── app.controller.ts
│   ├── app.service.ts
│   │
│   ├── common/                          # Shared utilities
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── roles.decorator.ts
│   │   │   └── public.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── rate-limit.guard.ts
│   │   ├── filters/
│   │   │   ├── http-exception.filter.ts
│   │   │   └── all-exceptions.filter.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   ├── transform.interceptor.ts
│   │   │   └── cache.interceptor.ts
│   │   ├── pipes/
│   │   │   ├── validation.pipe.ts
│   │   │   └── parse-objectid.pipe.ts
│   │   ├── interfaces/
│   │   ├── enums/
│   │   └── constants/
│   │
│   ├── config/                          # Configuration
│   │   ├── config.module.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── jwt.config.ts
│   │   ├── openai.config.ts
│   │   └── stripe.config.ts
│   │
│   ├── modules/
│   │   │
│   │   ├── auth/                        # Authentication module
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   ├── jwt-refresh.strategy.ts
│   │   │   │   └── google.strategy.ts
│   │   │   ├── dto/
│   │   │   │   ├── register.dto.ts
│   │   │   │   ├── login.dto.ts
│   │   │   │   └── refresh-token.dto.ts
│   │   │   └── interfaces/
│   │   │       └── jwt-payload.interface.ts
│   │   │
│   │   ├── users/                       # User management
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   ├── schemas/
│   │   │   │   └── user.schema.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-user.dto.ts
│   │   │   │   ├── update-user.dto.ts
│   │   │   │   └── user-response.dto.ts
│   │   │   └── interfaces/
│   │   │
│   │   ├── cv/                          # CV management
│   │   │   ├── cv.module.ts
│   │   │   ├── cv.controller.ts
│   │   │   ├── cv.service.ts
│   │   │   ├── cv.repository.ts
│   │   │   ├── cv-parser.service.ts
│   │   │   ├── cv-analyzer.service.ts
│   │   │   ├── schemas/
│   │   │   │   └── cv.schema.ts
│   │   │   ├── dto/
│   │   │   │   ├── upload-cv.dto.ts
│   │   │   │   ├── analyze-cv.dto.ts
│   │   │   │   └── optimize-cv.dto.ts
│   │   │   └── processors/
│   │   │       └── cv-analysis.processor.ts
│   │   │
│   │   ├── interviews/                  # Interview module
│   │   │   ├── interviews.module.ts
│   │   │   ├── interviews.controller.ts
│   │   │   ├── interviews.service.ts
│   │   │   ├── interviews.repository.ts
│   │   │   ├── questions.service.ts
│   │   │   ├── feedback.service.ts
│   │   │   ├── schemas/
│   │   │   │   ├── interview-session.schema.ts
│   │   │   │   └── interview-question.schema.ts
│   │   │   ├── dto/
│   │   │   │   ├── start-interview.dto.ts
│   │   │   │   ├── submit-answer.dto.ts
│   │   │   │   └── interview-feedback.dto.ts
│   │   │   └── processors/
│   │   │       └── interview-analysis.processor.ts
│   │   │
│   │   ├── ai/                          # AI processing
│   │   │   ├── ai.module.ts
│   │   │   ├── ai.controller.ts
│   │   │   ├── ai.service.ts
│   │   │   ├── providers/
│   │   │   │   ├── openai.provider.ts
│   │   │   │   ├── whisper.provider.ts
│   │   │   │   └── claude.provider.ts
│   │   │   ├── dto/
│   │   │   │   ├── transcribe.dto.ts
│   │   │   │   ├── generate-answer.dto.ts
│   │   │   │   └── ai-response.dto.ts
│   │   │   ├── processors/
│   │   │   │   ├── transcription.processor.ts
│   │   │   │   └── answer-generation.processor.ts
│   │   │   └── services/
│   │   │       ├── context-manager.service.ts
│   │   │       └── cache.service.ts
│   │   │
│   │   ├── payments/                    # Payment processing
│   │   │   ├── payments.module.ts
│   │   │   ├── payments.controller.ts
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   ├── stripe.service.ts
│   │   │   ├── schemas/
│   │   │   │   ├── subscription.schema.ts
│   │   │   │   └── payment.schema.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-checkout.dto.ts
│   │   │   │   └── subscription-webhook.dto.ts
│   │   │   └── webhooks/
│   │   │       └── stripe-webhook.handler.ts
│   │   │
│   │   ├── telegram/                    # Telegram bot
│   │   │   ├── telegram.module.ts
│   │   │   ├── telegram.controller.ts
│   │   │   ├── telegram.service.ts
│   │   │   ├── bot/
│   │   │   │   ├── bot.ts
│   │   │   │   ├── commands/
│   │   │   │   │   ├── start.command.ts
│   │   │   │   │   ├── profile.command.ts
│   │   │   │   │   ├── interview.command.ts
│   │   │   │   │   └── help.command.ts
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── voice.handler.ts
│   │   │   │   │   ├── text.handler.ts
│   │   │   │   │   └── callback.handler.ts
│   │   │   │   └── scenes/
│   │   │   │       └── live-interview.scene.ts
│   │   │   └── dto/
│   │   │
│   │   ├── websocket/                   # WebSocket gateway
│   │   │   ├── websocket.module.ts
│   │   │   ├── websocket.gateway.ts
│   │   │   ├── websocket.service.ts
│   │   │   └── dto/
│   │   │       ├── audio-chunk.dto.ts
│   │   │       └── ws-message.dto.ts
│   │   │
│   │   ├── storage/                     # File storage
│   │   │   ├── storage.module.ts
│   │   │   ├── storage.service.ts
│   │   │   ├── s3.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── notifications/               # Notifications
│   │   │   ├── notifications.module.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── email.service.ts
│   │   │   ├── sms.service.ts
│   │   │   └── processors/
│   │   │       └── notification.processor.ts
│   │   │
│   │   └── analytics/                   # Analytics
│   │       ├── analytics.module.ts
│   │       ├── analytics.controller.ts
│   │       ├── analytics.service.ts
│   │       ├── analytics.repository.ts
│   │       ├── schemas/
│   │       │   └── analytics-event.schema.ts
│   │       └── dto/
│   │
│   └── database/                        # Database utilities
│       ├── database.module.ts
│       ├── database.service.ts
│       ├── migrations/
│       └── seeds/
│
├── test/                                # E2E tests
│   ├── app.e2e-spec.ts
│   ├── auth.e2e-spec.ts
│   └── utils/
│
├── .env.example
├── .env.development
├── .env.production
├── .eslintrc.js
├── .prettierrc
├── tsconfig.json
├── package.json
├── nest-cli.json
├── docker-compose.yml
├── Dockerfile
└── README.md
```

---

## 3. Module Design

### 3.1 Auth Module Implementation

```typescript
// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: '15m',
          algorithm: 'RS256',
        },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy, GoogleStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

```typescript
// src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Check if user exists
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 12);

    // Create user
    const user = await this.usersService.create({
      ...registerDto,
      password: hashedPassword,
    });

    // Send verification email
    await this.sendVerificationEmail(user);

    return {
      success: true,
      message: 'Registration successful. Please verify your email.',
      userId: user.id,
    };
  }

  async login(loginDto: LoginDto) {
    // Find user
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if email verified
    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email first');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user: this.usersService.sanitizeUser(user),
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      // Find user
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid token');
      }

      // Generate new tokens
      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string) {
    // Invalidate refresh token (store in Redis blacklist)
    await this.revokeRefreshToken(refreshToken);
    return { success: true, message: 'Logged out successfully' };
  }

  private async generateTokens(user: any) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  private async sendVerificationEmail(user: any) {
    // Implementation for sending verification email
    // Using email service (e.g., SendGrid)
  }

  private async revokeRefreshToken(token: string) {
    // Store token in Redis blacklist with TTL = token expiry
    // Implementation in Redis service
  }
}
```

```typescript
// src/modules/auth/dto/register.dto.ts
import { IsEmail, IsString, MinLength, MaxLength, Matches, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(50)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, number/special character',
  })
  password: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @ApiProperty({ example: 'en' })
  @IsString()
  @MaxLength(5)
  language: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  termsAccepted: boolean;
}
```

```typescript
// src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
}
```

### 3.2 Users Module Implementation

```typescript
// src/modules/users/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  avatar?: string;

  @Prop()
  bio?: string;

  @Prop({ type: String, enum: ['user', 'pro', 'elite', 'admin'], default: 'user' })
  role: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop()
  telegramId?: number;

  @Prop({ type: Object })
  subscription: {
    plan: string;
    status: string;
    startDate: Date;
    endDate?: Date;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  };

  @Prop({ type: Object })
  preferences: {
    language: string;
    notifications: {
      email: boolean;
      telegram: boolean;
      push: boolean;
    };
    interviewSettings: {
      answerStyle: string;
      answerLength: string;
      autoTranscribe: boolean;
    };
    privacy: {
      saveHistory: boolean;
      shareAnalytics: boolean;
    };
  };

  @Prop({ type: Object })
  usage: {
    mockInterviewsThisMonth: number;
    cvAnalysesThisMonth: number;
    chromeQuestionsThisMonth: number;
    lastResetDate: Date;
  };

  @Prop()
  deletedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 });
UserSchema.index({ telegramId: 1 }, { sparse: true });
UserSchema.index({ 'subscription.plan': 1 });
UserSchema.index({ createdAt: 1 });

// Virtual properties
UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Exclude password from toJSON
UserSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    return ret;
  },
});
```

```typescript
// src/modules/users/users.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const user = new this.userModel({
      ...createUserDto,
      subscription: {
        plan: 'free',
        status: 'active',
        startDate: new Date(),
      },
      preferences: {
        language: createUserDto.language || 'en',
        notifications: {
          email: true,
          telegram: false,
          push: false,
        },
        interviewSettings: {
          answerStyle: 'balanced',
          answerLength: 'medium',
          autoTranscribe: true,
        },
        privacy: {
          saveHistory: true,
          shareAnalytics: false,
        },
      },
      usage: {
        mockInterviewsThisMonth: 0,
        cvAnalysesThisMonth: 0,
        chromeQuestionsThisMonth: 0,
        lastResetDate: new Date(),
      },
    });
    return user.save();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(id, { $set: updateUserDto }, { new: true })
      .exec();
  }

  async softDelete(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(id, { $set: { deletedAt: new Date() } }, { new: true })
      .exec();
  }

  async incrementUsage(userId: string, field: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, {
        $inc: { [`usage.${field}`]: 1 },
      })
      .exec();
  }

  async resetMonthlyUsage(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, {
        $set: {
          'usage.mockInterviewsThisMonth': 0,
          'usage.cvAnalysesThisMonth': 0,
          'usage.chromeQuestionsThisMonth': 0,
          'usage.lastResetDate': new Date(),
        },
      })
      .exec();
  }
}
```

### 3.3 CV Module Implementation

```typescript
// src/modules/cv/schemas/cv.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CvDocument = Cv & Document;

@Schema({ timestamps: true })
export class Cv {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  storageUrl: string;

  @Prop({ default: 1 })
  version: number;

  @Prop({ type: Object })
  parsedData: {
    personalInfo: {
      name?: string;
      email?: string;
      phone?: string;
      location?: string;
      linkedin?: string;
      github?: string;
    };
    summary?: string;
    experience: Array<{
      title: string;
      company: string;
      location?: string;
      startDate: Date;
      endDate?: Date;
      current: boolean;
      description: string;
      achievements: string[];
    }>;
    education: Array<{
      degree: string;
      institution: string;
      location?: string;
      graduationDate?: Date;
      gpa?: number;
    }>;
    skills: string[];
    languages: string[];
    certifications: string[];
  };

  @Prop({ type: Object })
  analysis?: {
    atsScore: number;
    overallRating: number;
    strengths: string[];
    weaknesses: string[];
    missingKeywords: string[];
    suggestions: Array<{
      category: string;
      severity: string;
      message: string;
      suggestion: string;
    }>;
    sectionScores: {
      personalInfo: number;
      summary: number;
      experience: number;
      education: number;
      skills: number;
      formatting: number;
    };
    analyzedAt: Date;
    aiModel: string;
  };

  @Prop({ type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' })
  analysisStatus: string;
}

export const CvSchema = SchemaFactory.createForClass(Cv);

// Indexes
CvSchema.index({ userId: 1, createdAt: -1 });
CvSchema.index({ analysisStatus: 1 });
```

```typescript
// src/modules/cv/cv.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { CvRepository } from './cv.repository';
import { StorageService } from '../storage/storage.service';
import { CvParserService } from './cv-parser.service';
import { UsersService } from '../users/users.service';
import { UploadCvDto } from './dto/upload-cv.dto';

@Injectable()
export class CvService {
  constructor(
    private readonly cvRepository: CvRepository,
    private readonly storageService: StorageService,
    private readonly cvParserService: CvParserService,
    private readonly usersService: UsersService,
    @InjectQueue('cv-analysis') private cvAnalysisQueue: Queue,
  ) {}

  async upload(userId: string, file: Express.Multer.File, dto: UploadCvDto) {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only PDF, DOCX, and TXT are allowed.');
    }

    // Check user's monthly limit
    const user = await this.usersService.findById(userId);
    const plan = user.subscription.plan;
    const limit = this.getMonthlyLimit(plan, 'cvAnalyses');
    
    if (user.usage.cvAnalysesThisMonth >= limit) {
      throw new BadRequestException('Monthly CV analysis limit reached. Please upgrade your plan.');
    }

    // Upload file to S3
    const storageUrl = await this.storageService.uploadCv(file);

    // Parse CV
    const parsedData = await this.cvParserService.parse(file.buffer, file.mimetype);

    // Save to database
    const cv = await this.cvRepository.create({
      userId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      storageUrl,
      parsedData,
      analysisStatus: 'processing',
    });

    // Queue analysis job
    await this.cvAnalysisQueue.add('analyze-cv', {
      cvId: cv.id,
      jobDescription: dto.jobDescription,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    // Increment usage
    await this.usersService.incrementUsage(userId, 'cvAnalysesThisMonth');

    return {
      cvId: cv.id,
      fileName: cv.fileName,
      status: cv.analysisStatus,
      message: 'CV uploaded successfully. Analysis in progress.',
    };
  }

  async getCv(userId: string, cvId: string) {
    const cv = await this.cvRepository.findById(cvId);
    
    if (!cv) {
      throw new NotFoundException('CV not found');
    }

    if (cv.userId.toString() !== userId) {
      throw new BadRequestException('Unauthorized access');
    }

    return cv;
  }

  async getUserCvs(userId: string, page: number = 1, limit: number = 10) {
    return this.cvRepository.findByUserId(userId, page, limit);
  }

  async deleteCv(userId: string, cvId: string) {
    const cv = await this.getCv(userId, cvId);
    
    // Delete file from S3
    await this.storageService.deleteFile(cv.storageUrl);

    // Delete from database
    await this.cvRepository.delete(cvId);

    return { success: true, message: 'CV deleted successfully' };
  }

  private getMonthlyLimit(plan: string, type: string): number {
    const limits = {
      free: { cvAnalyses: 2 },
      pro: { cvAnalyses: -1 }, // unlimited
      elite: { cvAnalyses: -1 },
    };
    return limits[plan]?.[type] ?? 0;
  }
}
```

```typescript
// src/modules/cv/processors/cv-analysis.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';

import { CvRepository } from '../cv.repository';
import { CvAnalyzerService } from '../cv-analyzer.service';

@Processor('cv-analysis')
export class CvAnalysisProcessor {
  private readonly logger = new Logger(CvAnalysisProcessor.name);

  constructor(
    private readonly cvRepository: CvRepository,
    private readonly cvAnalyzerService: CvAnalyzerService,
  ) {}

  @Process('analyze-cv')
  async handleAnalyzeCv(job: Job) {
    const { cvId, jobDescription } = job.data;

    this.logger.log(`Starting CV analysis for CV: ${cvId}`);

    try {
      // Update status to processing
      await this.cvRepository.updateStatus(cvId, 'processing');

      // Get CV data
      const cv = await this.cvRepository.findById(cvId);
      if (!cv) {
        throw new Error('CV not found');
      }

      // Perform AI analysis
      const analysis = await this.cvAnalyzerService.analyze(
        cv.parsedData,
        jobDescription,
      );

      // Update CV with analysis results
      await this.cvRepository.updateAnalysis(cvId, analysis);

      // Update status to completed
      await this.cvRepository.updateStatus(cvId, 'completed');

      this.logger.log(`CV analysis completed for CV: ${cvId}`);

      return { success: true };
    } catch (error) {
      this.logger.error(`CV analysis failed for CV: ${cvId}`, error.stack);

      // Update status to failed
      await this.cvRepository.updateStatus(cvId, 'failed');

      throw error;
    }
  }
}
```

### 3.4 AI Module Implementation

```typescript
// src/modules/ai/ai.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { OpenAIProvider } from './providers/openai.provider';
import { WhisperProvider } from './providers/whisper.provider';
import { ContextManagerService } from './services/context-manager.service';
import { CacheService } from './services/cache.service';
import { TranscribeDto } from './dto/transcribe.dto';
import { GenerateAnswerDto } from './dto/generate-answer.dto';

@Injectable()
export class AiService {
  constructor(
    private readonly openaiProvider: OpenAIProvider,
    private readonly whisperProvider: WhisperProvider,
    private readonly contextManager: ContextManagerService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    @InjectQueue('ai-processing') private aiProcessingQueue: Queue,
  ) {}

  async transcribe(dto: TranscribeDto) {
    const startTime = Date.now();

    try {
      // Check if we have cached result
      const cacheKey = this.cacheService.generateAudioCacheKey(dto.audio);
      const cached = await this.cacheService.get(cacheKey);
      
      if (cached) {
        return {
          ...cached,
          cached: true,
          processingTime: Date.now() - startTime,
        };
      }

      // Transcribe using Whisper
      const result = await this.whisperProvider.transcribe({
        audio: dto.audio,
        language: dto.language,
      });

      // Cache the result
      await this.cacheService.set(cacheKey, result, 3600); // 1 hour

      return {
        ...result,
        cached: false,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      throw new BadRequestException('Transcription failed: ' + error.message);
    }
  }

  async generateAnswer(dto: GenerateAnswerDto) {
    const startTime = Date.now();

    try {
      // Build cache key
      const cacheKey = this.cacheService.generateAnswerCacheKey(
        dto.question,
        dto.context,
        dto.options,
      );

      // Check cache
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          cached: true,
          processingTime: Date.now() - startTime,
        };
      }

      // Get or create context
      const sessionContext = await this.contextManager.getContext(
        dto.context.sessionId,
      );

      // Add current question to context
      await this.contextManager.updateContext(dto.context.sessionId, {
        role: 'user',
        content: dto.question,
        type: 'question',
      });

      // Generate answer using AI
      const answers = await this.openaiProvider.generateAnswer({
        question: dto.question,
        context: {
          ...dto.context,
          conversationHistory: sessionContext.messages,
        },
        options: dto.options,
      });

      // Cache the result
      await this.cacheService.set(cacheKey, answers, 86400); // 24 hours

      // Add answer to context
      await this.contextManager.updateContext(dto.context.sessionId, {
        role: 'assistant',
        content: answers[0].content,
        type: 'answer',
      });

      return {
        answers,
        cached: false,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      throw new BadRequestException('Answer generation failed: ' + error.message);
    }
  }
}
```

```typescript
// src/modules/ai/providers/openai.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAIProvider {
  private openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      organization: this.configService.get<string>('OPENAI_ORGANIZATION'),
    });
  }

  async generateAnswer(params: any) {
    const { question, context, options } = params;

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context, options);

    // Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...context.conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: 'user', content: question },
    ];

    // Generate answers for each style
    const answers = await Promise.all(
      ['professional', 'balanced', 'simple'].map(async (style) => {
        const completion = await this.openai.chat.completions.create({
          model: options.model || 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: systemPrompt + `\n\nAnswer style: ${style}`,
            },
            ...messages.slice(1),
          ],
          temperature: 0.7,
          max_tokens: options.maxTokens || 1000,
        });

        const content = completion.choices[0].message.content;

        return {
          variant: style,
          content,
          keyPoints: this.extractKeyPoints(content),
          confidence: this.calculateConfidence(completion),
        };
      }),
    );

    return answers;
  }

  private buildSystemPrompt(context: any, options: any): string {
    return `You are an AI interview assistant helping a candidate answer interview questions.

User Profile:
- Name: ${context.userProfile.firstName} ${context.userProfile.lastName}
- Role: ${context.userProfile.role}
- Experience: ${context.cvData?.experience?.length || 0} years

Context:
${context.cvData?.summary || 'No additional context'}

Instructions:
1. Provide clear, concise, and professional answers
2. Use the STAR method for behavioral questions
3. Include specific examples from the user's experience
4. Keep answers between ${this.getAnswerLength(options.length)}
5. Focus on key achievements and skills
6. Be confident but honest
7. Answer in ${context.userProfile.language || 'English'}

Answer the following interview question:`;
  }

  private getAnswerLength(length: string): string {
    const lengths = {
      short: '30-60 seconds',
      medium: '1-2 minutes',
      long: '3-5 minutes',
    };
    return lengths[length] || lengths.medium;
  }

  private extractKeyPoints(content: string): string[] {
    // Simple extraction - can be improved with NLP
    const sentences = content.split(/[.!?]/).filter((s) => s.trim().length > 0);
    return sentences.slice(0, 3).map((s) => s.trim());
  }

  private calculateConfidence(completion: any): number {
    // Calculate based on finish_reason and logprobs if available
    return completion.choices[0].finish_reason === 'stop' ? 0.9 : 0.7;
  }
}
```

---

## 4. Database Design

### 4.1 MongoDB Connection Setup

```typescript
// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        useNewUrlParser: true,
        useUnifiedTopology: true,
        autoIndex: true,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4,
        // Connection pool settings
        maxPoolSize: 100,
        minPoolSize: 10,
        // Retry settings
        retryWrites: true,
        w: 'majority',
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
```

### 4.2 Redis Connection Setup

```typescript
// src/config/redis.config.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisModuleOptions, RedisModuleOptionsFactory } from '@nestjs-modules/ioredis';

@Injectable()
export class RedisConfigService implements RedisModuleOptionsFactory {
  constructor(private configService: ConfigService) {}

  createRedisModuleOptions(): RedisModuleOptions {
    return {
      config: {
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD'),
        db: this.configService.get<number>('REDIS_DB', 0),
        keyPrefix: 'interviewai:',
        retryStrategy: (times: number) => {
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 50, 2000);
        },
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
      },
    };
  }
}
```

### 4.3 Database Indexing Strategy

```typescript
// Indexes to create for optimal performance

// Users collection
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ telegramId: 1 }, { sparse: true, unique: true });
db.users.createIndex({ 'subscription.plan': 1 });
db.users.createIndex({ 'subscription.endDate': 1 });
db.users.createIndex({ createdAt: 1 });
db.users.createIndex({ deletedAt: 1 }, { sparse: true });

// CV documents collection
db.cvdocuments.createIndex({ userId: 1, createdAt: -1 });
db.cvdocuments.createIndex({ analysisStatus: 1 });
db.cvdocuments.createIndex({ 'analysis.atsScore': 1 });

// Interview sessions collection
db.interviewsessions.createIndex({ userId: 1, createdAt: -1 });
db.interviewsessions.createIndex({ status: 1 });
db.interviewsessions.createIndex({ type: 1, difficulty: 1 });

// Interview questions collection
db.interviewquestions.createIndex({ category: 1, difficulty: 1 });
db.interviewquestions.createIndex({ technology: 1 });
db.interviewquestions.createIndex({ tags: 1 });
db.interviewquestions.createIndex({ timesAsked: -1 });

// Analytics events collection (with TTL)
db.analyticsevents.createIndex({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days
db.analyticsevents.createIndex({ userId: 1, timestamp: -1 });
db.analyticsevents.createIndex({ eventType: 1, timestamp: -1 });
```

---

## 5. API Implementation

### 5.1 REST API Controllers

```typescript
// src/modules/interviews/interviews.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { InterviewsService } from './interviews.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StartInterviewDto } from './dto/start-interview.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

@ApiTags('interviews')
@ApiBearerAuth()
@Controller('interviews')
@UseGuards(JwtAuthGuard)
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a new mock interview session' })
  @ApiResponse({ status: 201, description: 'Interview session created successfully' })
  async startInterview(
    @CurrentUser('id') userId: string,
    @Body() dto: StartInterviewDto,
  ) {
    return this.interviewsService.startInterview(userId, dto);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Get interview session details' })
  async getSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.interviewsService.getSession(userId, sessionId);
  }

  @Post(':sessionId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit answer to interview question' })
  async submitAnswer(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.interviewsService.submitAnswer(userId, sessionId, dto);
  }

  @Get(':sessionId/feedback')
  @ApiOperation({ summary: 'Get interview feedback' })
  async getFeedback(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.interviewsService.getFeedback(userId, sessionId);
  }

  @Patch(':sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete interview session' })
  async completeInterview(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.interviewsService.completeInterview(userId, sessionId);
  }

  @Get()
  @ApiOperation({ summary: 'Get user interview history' })
  async getHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.interviewsService.getUserInterviews(userId, page, limit);
  }
}
```

### 5.2 WebSocket Gateway

```typescript
// src/modules/websocket/websocket.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';

import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { AiService } from '../ai/ai.service';
import { AudioChunkDto } from './dto/audio-chunk.dto';

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  },
  namespace: '/audio',
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private readonly sessions = new Map<string, any>();

  constructor(private readonly aiService: AiService) {}

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.sessions.delete(client.id);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('start_stream')
  async handleStartStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; config: any },
  ) {
    this.sessions.set(client.id, {
      sessionId: data.sessionId,
      config: data.config,
      buffer: [],
    });

    client.emit('stream_started', { sessionId: data.sessionId });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('audio_chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: AudioChunkDto,
  ) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'No active session' });
      return;
    }

    // Add chunk to buffer
    session.buffer.push(data.data);

    // If buffer is large enough, process
    if (session.buffer.length >= 10) { // ~2 seconds of audio
      const audioBuffer = Buffer.concat(
        session.buffer.map((chunk) => Buffer.from(chunk, 'base64')),
      );

      // Transcribe
      const transcription = await this.aiService.transcribe({
        audio: audioBuffer,
        language: session.config.language,
      });

      // Send transcription to client
      client.emit('transcription', {
        sessionId: data.sessionId,
        text: transcription.text,
        isFinal: false,
        confidence: transcription.confidence,
      });

      // Generate answer
      const answer = await this.aiService.generateAnswer({
        question: transcription.text,
        context: { sessionId: data.sessionId },
        options: { style: 'professional', length: 'medium' },
      });

      // Send answer to client
      client.emit('answer', {
        sessionId: data.sessionId,
        answers: answer.answers,
        processingTime: answer.processingTime,
      });

      // Clear buffer
      session.buffer = [];
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('end_stream')
  async handleEndStream(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    this.sessions.delete(client.id);
    client.emit('stream_ended', { sessionId: data.sessionId });
  }
}
```

---

## 6. Authentication & Authorization

### 6.1 JWT Guards

```typescript
// src/common/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

```typescript
// src/common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.role === role);
  }
}
```

```typescript
// src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

### 6.2 Rate Limiting

```typescript
// src/common/guards/rate-limit.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Let auth guard handle this
    }

    // Get rate limit config from decorator
    const limit = this.reflector.get<number>('rateLimit', context.getHandler()) || 100;
    const window = this.reflector.get<number>('rateLimitWindow', context.getHandler()) || 60;

    const key = `ratelimit:${user.id}:${request.route.path}`;

    // Get current count
    const current = await this.redis.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) {
      throw new Error('Rate limit exceeded');
    }

    // Increment counter
    const multi = this.redis.multi();
    multi.incr(key);
    if (count === 0) {
      multi.expire(key, window);
    }
    await multi.exec();

    return true;
  }
}
```

---

## 7. Caching Strategy

```typescript
// src/modules/ai/services/cache.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

@Injectable()
export class CacheService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async get(key: string): Promise<any> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  generateAudioCacheKey(audio: Buffer): string {
    const hash = crypto.createHash('sha256').update(audio).digest('hex');
    return `audio:transcript:${hash}`;
  }

  generateAnswerCacheKey(question: string, context: any, options: any): string {
    const data = JSON.stringify({ question, context, options });
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `ai:answer:${hash}`;
  }
}
```

---

## 8. Queue Management

```typescript
// src/modules/cv/cv.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

import { CvController } from './cv.controller';
import { CvService } from './cv.service';
import { CvRepository } from './cv.repository';
import { CvAnalysisProcessor } from './processors/cv-analysis.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'cv-analysis',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [CvController],
  providers: [CvService, CvRepository, CvAnalysisProcessor],
  exports: [CvService],
})
export class CvModule {}
```

---

## 9. Error Handling

```typescript
// src/common/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : exception,
    );

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: message,
    });
  }
}
```

---

## 10. Testing Strategy

```typescript
// test/users/users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

describe('UsersService', () => {
  let service: UsersService;
  let repository: UsersRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByEmail: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<UsersRepository>(UsersRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return a user', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
      };

      jest.spyOn(repository, 'findById').mockResolvedValue(mockUser as any);

      const result = await service.findById('123');
      expect(result).toEqual(mockUser);
      expect(repository.findById).toHaveBeenCalledWith('123');
    });
  });
});
```

---

**Document End**

This comprehensive backend architecture document provides all necessary implementation details for building a production-ready NestJS backend with MongoDB and Redis.

**Next documents to create:**
1. Frontend Architecture (React, TailwindCSS, shadcn)
2. Chrome Extension Architecture
3. Docker Compose Setup
4. Deployment Guide
