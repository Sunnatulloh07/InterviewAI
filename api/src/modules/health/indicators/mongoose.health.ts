import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/**
 * MongoDB Health Indicator
 * Checks MongoDB connection and responsiveness
 */
@Injectable()
export class MongooseHealthIndicator extends HealthIndicator {
  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = this.connection.readyState === 1; // 1 = connected

    if (isHealthy) {
      // Get additional database stats
      const dbStats = await this.getDatabaseStats();

      return this.getStatus(key, true, {
        state: 'connected',
        host: this.connection.host,
        name: this.connection.name,
        ...dbStats,
      });
    }

    throw new HealthCheckError(
      'MongoDB check failed',
      this.getStatus(key, false, {
        state: 'disconnected',
        readyState: this.connection.readyState,
      }),
    );
  }

  /**
   * Get database statistics
   */
  private async getDatabaseStats() {
    try {
      if (!this.connection.db) {
        return {
          collections: Object.keys(this.connection.collections).length,
          error: 'Database not available',
        };
      }
      const admin = this.connection.db.admin();
      const serverStatus = await admin.serverStatus();

      return {
        collections: Object.keys(this.connection.collections).length,
        connections: serverStatus.connections?.current || 0,
        uptime: serverStatus.uptime || 0,
        version: serverStatus.version || 'unknown',
      };
    } catch (error) {
      return {
        collections: Object.keys(this.connection.collections).length,
        error: 'Could not fetch stats',
      };
    }
  }
}
