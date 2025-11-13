import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './common/services/redis.service';

@Injectable()
export class AppService {
  constructor(
    private configService: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  getInfo() {
    return {
      name: 'InterviewAI Pro API',
      version: '1.0.0',
      description: 'AI-powered interview preparation platform',
      environment: this.configService.get<string>('NODE_ENV'),
      message: 'Welcome to InterviewAI Pro API',
      documentation: '/api/docs',
      status: 'operational',
    };
  }

  async getHealth() {
    const redisHealth = this.redisService
      ? await this.redisService.checkHealth().catch(() => false)
      : null;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: this.configService.get<string>('NODE_ENV'),
      services: {
        redis: redisHealth === null ? 'not_configured' : redisHealth ? 'healthy' : 'unhealthy',
      },
    };
  }
}
