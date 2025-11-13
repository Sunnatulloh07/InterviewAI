import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AlertsService } from './alerts.service';

/**
 * Alerts Module
 * Sends alerts to configured channels:
 * - Slack
 * - Discord
 * - Email
 * - Telegram
 * - Custom webhooks
 */
@Module({
  imports: [HttpModule],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
