import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../../common/logger/logger.service';

/**
 * Alert Severity Levels
 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Alert Interface
 */
export interface Alert {
  title: string;
  message: string;
  severity: AlertSeverity;
  metadata?: Record<string, any>;
  timestamp?: Date;
}

/**
 * Alerts Service
 * Sends critical alerts to configured channels
 */
@Injectable()
export class AlertsService {
  private readonly webhookUrl: string | undefined;
  private readonly enableAlerts: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AlertsService');
    this.webhookUrl = this.configService.get<string>('ALERT_WEBHOOK_URL');
    this.enableAlerts = !!this.webhookUrl;
  }

  /**
   * Send alert to configured channels
   */
  async sendAlert(alert: Alert): Promise<void> {
    if (!this.enableAlerts) {
      this.logger.debug('Alerts disabled - no webhook URL configured');
      return;
    }

    try {
      // Set timestamp if not provided
      if (!alert.timestamp) {
        alert.timestamp = new Date();
      }

      // Send to webhook (Slack, Discord, etc.)
      await this.sendToWebhook(alert);

      this.logger.log(`Alert sent: ${alert.title}`, { severity: alert.severity });
    } catch (error) {
      this.logger.error('Failed to send alert', error.stack, {
        alert,
        error: error.message,
      });
    }
  }

  /**
   * Send critical alert (always sent, even in development)
   */
  async sendCriticalAlert(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert({
      title,
      message,
      severity: AlertSeverity.CRITICAL,
      metadata,
    });
  }

  /**
   * Send error alert
   */
  async sendErrorAlert(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert({
      title,
      message,
      severity: AlertSeverity.ERROR,
      metadata,
    });
  }

  /**
   * Send warning alert
   */
  async sendWarningAlert(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert({
      title,
      message,
      severity: AlertSeverity.WARNING,
      metadata,
    });
  }

  /**
   * Send info alert
   */
  async sendInfoAlert(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert({
      title,
      message,
      severity: AlertSeverity.INFO,
      metadata,
    });
  }

  /**
   * Send to generic webhook
   */
  private async sendToWebhook(alert: Alert): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Webhook URL not configured');
    }

    try {
      // Detect webhook type by URL
      if (this.webhookUrl.includes('slack.com')) {
        await this.sendToSlack(alert);
      } else if (this.webhookUrl.includes('discord.com')) {
        await this.sendToDiscord(alert);
      } else {
        // Generic webhook format
        await firstValueFrom(
          this.httpService.post(this.webhookUrl, {
            title: alert.title,
            message: alert.message,
            severity: alert.severity,
            metadata: alert.metadata,
            timestamp: alert.timestamp,
            service: 'InterviewAI Pro',
            environment: process.env.NODE_ENV,
          }),
        );
      }
    } catch (error) {
      throw new Error(`Webhook delivery failed: ${error.message}`);
    }
  }

  /**
   * Send to Slack
   */
  private async sendToSlack(alert: Alert): Promise<void> {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    const payload = {
      attachments: [
        {
          color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Environment',
              value: process.env.NODE_ENV || 'unknown',
              short: true,
            },
            {
              title: 'Timestamp',
              value: alert.timestamp?.toISOString() || new Date().toISOString(),
              short: true,
            },
            ...(alert.metadata
              ? Object.entries(alert.metadata).map(([key, value]) => ({
                  title: key,
                  value: JSON.stringify(value),
                  short: true,
                }))
              : []),
          ],
          footer: 'InterviewAI Pro',
          ts: Math.floor((alert.timestamp || new Date()).getTime() / 1000),
        },
      ],
    };

    if (!this.webhookUrl) {
      throw new Error('Webhook URL not configured');
    }
    await firstValueFrom(this.httpService.post(this.webhookUrl, payload));
  }

  /**
   * Send to Discord
   */
  private async sendToDiscord(alert: Alert): Promise<void> {
    const color = this.getSeverityColorDecimal(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    const payload = {
      embeds: [
        {
          title: `${emoji} ${alert.title}`,
          description: alert.message,
          color,
          fields: [
            {
              name: 'Severity',
              value: alert.severity.toUpperCase(),
              inline: true,
            },
            {
              name: 'Environment',
              value: process.env.NODE_ENV || 'unknown',
              inline: true,
            },
            {
              name: 'Timestamp',
              value: alert.timestamp?.toISOString() || new Date().toISOString(),
              inline: true,
            },
            ...(alert.metadata
              ? Object.entries(alert.metadata).map(([key, value]) => ({
                  name: key,
                  value: JSON.stringify(value),
                  inline: true,
                }))
              : []),
          ],
          footer: {
            text: 'InterviewAI Pro',
          },
          timestamp: alert.timestamp?.toISOString() || new Date().toISOString(),
        },
      ],
    };

    if (!this.webhookUrl) {
      throw new Error('Webhook URL not configured');
    }
    await firstValueFrom(this.httpService.post(this.webhookUrl, payload));
  }

  /**
   * Get severity color for Slack
   */
  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '#FF0000'; // Red
      case AlertSeverity.ERROR:
        return '#FFA500'; // Orange
      case AlertSeverity.WARNING:
        return '#FFFF00'; // Yellow
      case AlertSeverity.INFO:
        return '#36A64F'; // Green
      default:
        return '#808080'; // Gray
    }
  }

  /**
   * Get severity color as decimal for Discord
   */
  private getSeverityColorDecimal(severity: AlertSeverity): number {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 16711680; // Red
      case AlertSeverity.ERROR:
        return 16753920; // Orange
      case AlertSeverity.WARNING:
        return 16776960; // Yellow
      case AlertSeverity.INFO:
        return 3581519; // Green
      default:
        return 8421504; // Gray
    }
  }

  /**
   * Get severity emoji
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '🔴';
      case AlertSeverity.ERROR:
        return '🟠';
      case AlertSeverity.WARNING:
        return '🟡';
      case AlertSeverity.INFO:
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * Common alerts for the application
   */

  async alertDatabaseDown(): Promise<void> {
    await this.sendCriticalAlert(
      'Database Connection Lost',
      'MongoDB connection has been lost. The application may be unable to serve requests.',
      {
        service: 'MongoDB',
        action: 'Check database server status and network connectivity',
      },
    );
  }

  async alertCacheDown(): Promise<void> {
    await this.sendErrorAlert(
      'Cache Connection Lost',
      'Redis connection has been lost. Performance may be degraded.',
      {
        service: 'Redis',
        action: 'Check Redis server status',
      },
    );
  }

  async alertHighErrorRate(errorRate: number): Promise<void> {
    await this.sendErrorAlert(
      'High Error Rate Detected',
      `Error rate has exceeded threshold: ${errorRate.toFixed(2)}%`,
      {
        errorRate: `${errorRate.toFixed(2)}%`,
        threshold: '5%',
        action: 'Check application logs for details',
      },
    );
  }

  async alertHighMemoryUsage(usage: number): Promise<void> {
    await this.sendWarningAlert(
      'High Memory Usage',
      `Memory usage has exceeded threshold: ${usage.toFixed(2)}%`,
      {
        usage: `${usage.toFixed(2)}%`,
        threshold: '90%',
        action: 'Consider scaling up or investigating memory leaks',
      },
    );
  }

  async alertSecurityThreat(threat: string, details: Record<string, any>): Promise<void> {
    await this.sendCriticalAlert(
      `Security Threat Detected: ${threat}`,
      'A potential security threat has been detected and blocked.',
      {
        threat,
        ...details,
        action: 'Review logs and investigate immediately',
      },
    );
  }

  async alertPaymentFailed(userId: string, amount: number, error: string): Promise<void> {
    await this.sendErrorAlert(
      'Payment Processing Failed',
      `Failed to process payment for user ${userId}`,
      {
        userId,
        amount: `$${amount.toFixed(2)}`,
        error,
        action: 'Investigate payment gateway logs',
      },
    );
  }

  async alertApiQuotaExceeded(service: string, usage: number, limit: number): Promise<void> {
    await this.sendWarningAlert(
      `API Quota Exceeded: ${service}`,
      `API usage has exceeded ${((usage / limit) * 100).toFixed(0)}% of the limit`,
      {
        service,
        usage,
        limit,
        percentage: `${((usage / limit) * 100).toFixed(0)}%`,
        action: 'Consider upgrading plan or optimizing usage',
      },
    );
  }

  async alertDeploymentSuccess(version: string): Promise<void> {
    await this.sendInfoAlert(
      'Deployment Successful',
      `Application version ${version} has been deployed successfully`,
      {
        version,
        environment: process.env.NODE_ENV,
      },
    );
  }
}
