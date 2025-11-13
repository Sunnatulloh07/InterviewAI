import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    this.connection.on('connected', () => {
      this.logger.log('✅ MongoDB connected successfully');
    });

    this.connection.on('error', (error) => {
      this.logger.error('❌ MongoDB connection error:', error);
    });

    this.connection.on('disconnected', () => {
      this.logger.warn('⚠️ MongoDB disconnected');
    });
  }

  async getHealth(): Promise<{
    status: string;
    readyState: number;
    host: string;
    name: string;
  }> {
    const { readyState, host, name } = this.connection;

    const stateMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };

    return {
      status: stateMap[readyState] || 'unknown',
      readyState,
      host,
      name,
    };
  }
}
