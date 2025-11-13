import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'path';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  // Create NestJS application
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    cors: true,
  });

  // Get config service
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const env = configService.get<string>('NODE_ENV', 'development');

  // Set global prefix
  app.setGlobalPrefix('api/v1');

  // Enable versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Security middlewares
  app.use(
    helmet({
      contentSecurityPolicy: env === 'production',
      crossOriginEmbedderPolicy: env === 'production',
    }),
  );

  // Compression
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // CORS configuration
  app.enableCors({
    origin: configService.get<string>('ALLOWED_ORIGINS', '*').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Page-Size'],
  });

  // Serve static files for local uploads
  const uploadPath = configService.get<string>('LOCAL_UPLOAD_PATH', './uploads');
  app.useStaticAssets(join(__dirname, '..', uploadPath), {
    prefix: '/uploads/',
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: env === 'production',
    }),
  );

  // Global filters
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // Swagger documentation (only in development)
  if (env !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('InterviewAI Pro API')
      .setDescription('AI-powered interview preparation platform API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('cv', 'CV/Resume management')
      .addTag('interviews', 'Mock interviews')
      .addTag('ai', 'AI processing')
      .addTag('payments', 'Payment and subscriptions')
      .addTag('telegram', 'Telegram bot')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
      },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();

  // Start server
  await app.listen(port, '0.0.0.0');

  console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║   🚀 InterviewAI Pro API Server Started!             ║
    ║                                                       ║
    ║   🌍 Environment: ${env.padEnd(20)}              ║
    ║   🔗 API URL: http://localhost:${port}/api/v1         ║
    ║   📚 API Docs: http://localhost:${port}/api/docs      ║
    ║   ⏰ Started at: ${new Date().toISOString()}          ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
  `);
}

bootstrap().catch((error) => {
  console.error('❌ Application failed to start:', error);
  process.exit(1);
});
