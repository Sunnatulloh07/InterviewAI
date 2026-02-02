import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  FailedNotification,
  FailedNotificationDocument,
} from './schemas/failed-notification.schema';
import { TelegramService } from '../telegram/telegram.service';
import { UsersService } from '../users/users.service';
import { PositionPromptService } from './position-prompt.service';
import { SurveyHandlerService } from './survey-handler.service';

@Injectable()
export class FailedNotificationRetryService {
  private readonly logger = new Logger(FailedNotificationRetryService.name);
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly RETRY_DELAYS_HOURS = [1, 3, 6, 12, 24];

  constructor(
    @InjectModel(FailedNotification.name)
    private readonly failedNotificationModel: Model<FailedNotificationDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => PositionPromptService))
    private readonly positionPromptService: PositionPromptService,
    @Inject(forwardRef(() => SurveyHandlerService))
    private readonly surveyHandlerService: SurveyHandlerService,
  ) {}

  async trackFailedNotification(
    userId: string,
    telegramChatId: number,
    notificationType: string,
    errorMessage: string,
    errorCode?: number,
    metadata?: any,
  ): Promise<void> {
    try {
      const nextRetryAt = new Date();
      nextRetryAt.setHours(nextRetryAt.getHours() + this.RETRY_DELAYS_HOURS[0]);

      await this.failedNotificationModel.create({
        userId,
        telegramChatId,
        notificationType,
        errorMessage,
        errorCode,
        retryCount: 0,
        isPermanentlyFailed: false,
        nextRetryAt,
        metadata,
      });

      this.logger.warn(
        `Tracked failed ${notificationType} for user ${userId}: ${errorMessage} (retry scheduled in ${this.RETRY_DELAYS_HOURS[0]}h)`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to track failed notification: ${error.message}`);
    }
  }

  /**
   * Process retry queue every 15 minutes (SCALABILITY FIX)
   * Old: 100 notifications/hour = very slow for large queues
   * New: 500 notifications/15min = 2000/hour = much faster
   */
  @Cron('*/15 * * * *', {
    name: 'retry-failed-notifications',
    timeZone: 'Asia/Tashkent',
  })
  async processRetryQueue(): Promise<void> {
    try {
      const now = new Date();

      // SCALABILITY FIX: Count total first to monitor queue size
      const totalFailed = await this.failedNotificationModel.countDocuments({
        isPermanentlyFailed: false,
        nextRetryAt: { $lte: now },
        retryCount: { $lt: this.MAX_RETRY_ATTEMPTS },
      });

      if (totalFailed === 0) {
        return;
      }

      this.logger.log(`Retrying failed notifications: ${totalFailed} total in queue`);

      // SCALABILITY FIX: Increase batch size from 100 to 500
      // Process up to 500 notifications per hour = ~8.3 per minute (manageable)
      const BATCH_SIZE = 500;

      const failedNotifications = await this.failedNotificationModel
        .find({
          isPermanentlyFailed: false,
          nextRetryAt: { $lte: now },
          retryCount: { $lt: this.MAX_RETRY_ATTEMPTS },
        })
        .sort({ createdAt: 1 }) // Oldest first (FIFO)
        .limit(BATCH_SIZE);

      if (failedNotifications.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${failedNotifications.length} failed notifications (${totalFailed} remaining)`,
      );

      let success = 0;
      let failed = 0;
      let permanentlyFailed = 0;

      for (const notification of failedNotifications) {
        try {
          const user = await this.usersService.findById(notification.userId.toString());
          if (!user || user.engagement?.isBotBlocked) {
            await this.markAsPermanentlyFailed(
              (notification as any)._id.toString(),
              'User not found or blocked bot',
            );
            permanentlyFailed++;
            continue;
          }

          const bot = this.telegramService.getBot();
          if (!bot) {
            this.logger.error('Bot not available for retry');
            failed++;
            continue;
          }

          let message: string;
          let retrySuccess = false;

          switch (notification.notificationType) {
            case 'daily_task_delivery':
              message = 'Your daily tasks are ready! Use /tasks to see them.';
              break;
            case 'trial_reminder':
              message = 'Reminder: Your free trial is ending soon!';
              break;
            case 'trial_expiry':
              message = notification.metadata?.messageContent || 'Your trial has expired!';
              break;
            case 'first_reminder':
            case 'second_reminder':
            case 'third_reminder':
              message =
                notification.metadata?.messageContent || 'Please complete your daily tasks!';
              break;
            case 'engagement':
            case 'inactivity':
              message =
                notification.metadata?.messageContent || 'We miss you! Come back to practice.';
              break;
            case 'limit_exhausted':
              message =
                notification.metadata?.messageContent ||
                'Your free trial limits have been reached!';
              break;
            // 🔧 NEW: Handle position prompt retry
            case 'position_prompt':
              try {
                this.logger.debug(`Retrying position prompt for user ${notification.userId}`);
                const lang = notification.metadata?.userLanguage || user.language || 'uz';
                const result = await this.positionPromptService.sendPositionPrompt(
                  notification.userId.toString(),
                  notification.telegramChatId,
                  lang,
                );
                retrySuccess = result.success;
                if (retrySuccess) {
                  await this.markAsCompleted((notification as any)._id.toString());
                  success++;
                } else {
                  await this.incrementRetryCount((notification as any)._id.toString());
                  failed++;
                }
                continue;
              } catch (error: any) {
                this.logger.error(`Position prompt retry failed: ${error.message}`);
                await this.incrementRetryCount((notification as any)._id.toString());
                failed++;
                continue;
              }
            // 🔧 NEW: Handle employment survey retry
            case 'employment_survey':
              try {
                this.logger.debug(`Retrying employment survey for user ${notification.userId}`);
                const lang = notification.metadata?.userLanguage || user.language || 'uz';
                const result = await this.surveyHandlerService.sendSurvey(
                  notification.userId.toString(),
                  notification.telegramChatId,
                  lang,
                );
                retrySuccess = result;
                if (retrySuccess) {
                  await this.markAsCompleted((notification as any)._id.toString());
                  success++;
                } else {
                  await this.incrementRetryCount((notification as any)._id.toString());
                  failed++;
                }
                continue;
              } catch (error: any) {
                this.logger.error(`Employment survey retry failed: ${error.message}`);
                await this.incrementRetryCount((notification as any)._id.toString());
                failed++;
                continue;
              }
            default:
              message =
                notification.metadata?.messageContent || 'New notification from InterviewAI Pro';
          }

          await bot.api.sendMessage(notification.telegramChatId, message, {
            parse_mode: 'HTML',
          });

          await this.failedNotificationModel.findByIdAndDelete(notification._id);

          success++;
          this.logger.debug(
            `Successfully resent ${notification.notificationType} to user ${notification.userId}`,
          );
        } catch (error: any) {
          const errorMessage = error.description || error.message;
          const isBlockedError =
            errorMessage?.includes('bot was blocked') ||
            errorMessage?.includes('user is deactivated') ||
            errorMessage?.includes('chat not found') ||
            errorMessage?.includes('Forbidden');

          if (isBlockedError || notification.retryCount >= this.MAX_RETRY_ATTEMPTS - 1) {
            await this.markAsPermanentlyFailed(
              (notification as any)._id.toString(),
              isBlockedError
                ? 'User blocked bot'
                : `Max retries (${this.MAX_RETRY_ATTEMPTS}) exceeded`,
            );
            permanentlyFailed++;
          } else {
            const nextRetryDelay = this.RETRY_DELAYS_HOURS[notification.retryCount + 1] || 24;
            const nextRetryAt = new Date();
            nextRetryAt.setHours(nextRetryAt.getHours() + nextRetryDelay);

            await this.failedNotificationModel.findByIdAndUpdate(notification._id, {
              $inc: { retryCount: 1 },
              $set: { nextRetryAt, errorMessage: errorMessage },
            });

            failed++;
            this.logger.warn(
              `Retry ${notification.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS} failed for ${notification.userId}: ${errorMessage} (next retry in ${nextRetryDelay}h)`,
            );
          }
        }

        // SCALABILITY FIX: Reduce delay from 200ms to 50ms (20 msg/sec)
        await this.delay(50);
      }

      this.logger.log(
        `Retry queue processed: success=${success}, failed=${failed}, permanentlyFailed=${permanentlyFailed}`,
      );
    } catch (error: any) {
      this.logger.error(`Retry queue processing failed: ${error.message}`);
    }
  }

  private async markAsPermanentlyFailed(notificationId: string, reason: string): Promise<void> {
    await this.failedNotificationModel.findByIdAndUpdate(notificationId, {
      $set: { isPermanentlyFailed: true, errorMessage: reason },
    });
    this.logger.warn(`Marked notification ${notificationId} as permanently failed: ${reason}`);
  }

  /**
   * Mark notification as completed (successfully retried)
   */
  private async markAsCompleted(notificationId: string): Promise<void> {
    await this.failedNotificationModel.findByIdAndDelete(notificationId);
    this.logger.debug(`Notification ${notificationId} successfully retried and removed from queue`);
  }

  /**
   * Increment retry count and schedule next retry
   */
  private async incrementRetryCount(notificationId: string): Promise<void> {
    const notification = await this.failedNotificationModel.findById(notificationId);
    if (!notification) return;

    const nextRetryDelay = this.RETRY_DELAYS_HOURS[notification.retryCount + 1] || 24;
    const nextRetryAt = new Date();
    nextRetryAt.setHours(nextRetryAt.getHours() + nextRetryDelay);

    await this.failedNotificationModel.findByIdAndUpdate(notificationId, {
      $inc: { retryCount: 1 },
      $set: { nextRetryAt },
    });

    this.logger.debug(
      `Retry ${notification.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS} scheduled for notification ${notificationId} (next retry in ${nextRetryDelay}h)`,
    );
  }

  @Cron('0 2 * * *', {
    name: 'cleanup-permanently-failed-notifications',
    timeZone: 'Asia/Tashkent',
  })
  async cleanupPermanentlyFailed(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await this.failedNotificationModel.deleteMany({
        isPermanentlyFailed: true,
        updatedAt: { $lt: thirtyDaysAgo },
      });

      if (result.deletedCount > 0) {
        this.logger.log(
          `Cleaned up ${result.deletedCount} permanently failed notifications older than 30 days`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to cleanup old notifications: ${error.message}`);
    }
  }

  async getStats(): Promise<{
    totalFailed: number;
    pendingRetry: number;
    permanentlyFailed: number;
    byType: Record<string, number>;
  }> {
    try {
      const [totalFailed, pendingRetry, permanentlyFailed] = await Promise.all([
        this.failedNotificationModel.countDocuments({}),
        this.failedNotificationModel.countDocuments({ isPermanentlyFailed: false }),
        this.failedNotificationModel.countDocuments({ isPermanentlyFailed: true }),
      ]);

      const byTypeAgg = await this.failedNotificationModel.aggregate([
        { $group: { _id: '$notificationType', count: { $sum: 1 } } },
      ]);

      const byType: Record<string, number> = {};
      byTypeAgg.forEach((item) => {
        byType[item._id] = item.count;
      });

      return { totalFailed, pendingRetry, permanentlyFailed, byType };
    } catch (error: any) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      return { totalFailed: 0, pendingRetry: 0, permanentlyFailed: 0, byType: {} };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
