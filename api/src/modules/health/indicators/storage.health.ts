import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

/**
 * Storage Health Indicator
 * Checks AWS S3 connectivity and bucket access
 */
@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  private readonly s3Client: S3Client;
  private readonly isConfigured: boolean;

  constructor(private readonly configService: ConfigService) {
    super();

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = this.configService.get<string>('AWS_REGION');

    this.isConfigured = !!(accessKeyId && secretAccessKey && region);

    if (this.isConfigured && accessKeyId && secretAccessKey && region) {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.isConfigured) {
      // Storage is optional, so we return healthy but not configured
      return this.getStatus(key, true, {
        state: 'not_configured',
        message: 'AWS S3 is not configured (using local storage)',
      });
    }

    try {
      const startTime = Date.now();

      // Try to list buckets to verify credentials
      const command = new ListBucketsCommand({});
      const response = await this.s3Client.send(command);

      const latency = Date.now() - startTime;

      const cvBucket = this.configService.get<string>('AWS_S3_BUCKET_CV');
      const audioBucket = this.configService.get<string>('AWS_S3_BUCKET_AUDIO');

      return this.getStatus(key, true, {
        state: 'connected',
        latency: `${latency}ms`,
        bucketsConfigured: {
          cv: cvBucket || 'not_set',
          audio: audioBucket || 'not_set',
        },
        totalBuckets: response.Buckets?.length || 0,
      });
    } catch (error) {
      // Don't expose credentials in error messages
      const safeError = error.name || 'Unknown error';

      throw new HealthCheckError(
        'Storage check failed',
        this.getStatus(key, false, {
          state: 'error',
          message: safeError,
        }),
      );
    }
  }
}
