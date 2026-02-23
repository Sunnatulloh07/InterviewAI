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

  /**
   * Track a failed notification for retry.
   *
   * FIX #33: Uses `findOneAndUpdate` with `upsert` instead of `create` to
   * prevent duplicate records when the same (userId, notificationType)
   * notification is tracked multiple times (e.g., the consistency checker
   * runs every 30 minutes and re-detects the same "missed" notification).
   *
   * If a pending (non-permanently-failed) record already exists for this
   * user+type combination, we simply update its metadata and leave the
   * retry schedule untouched.  Only when no record exists do we insert.
   */
  async trackFailedNotification(
    userId: string,
    telegramChatId: number,
    notificationType: string,
    errorMessage: string,
    errorCode?: number,
    metadata?: any,
  ): Promise<void> {
    try {
      const nextRetryAt = new Date(
        Date.now() + this.RETRY_DELAYS_HOURS[0] * 60 * 60 * 1000,
      );

      // FIX #119: telegramChatId was in BOTH $setOnInsert AND $set, causing
      // MongoDB conflict error: "Updating the path 'telegramChatId' would
      // create a conflict at 'telegramChatId'".
      // Solution: Keep telegramChatId ONLY in $set (works for both insert and update).
      await this.failedNotificationModel.findOneAndUpdate(
        {
          userId,
          notificationType,
          isPermanentlyFailed: false,
        },
        {
          $setOnInsert: {
            userId,
            notificationType,
            retryCount: 0,
            isPermanentlyFailed: false,
            nextRetryAt,
          },
          $set: {
            errorMessage,
            errorCode,
            metadata,
            telegramChatId, // Always update to latest value
          },
        },
        { upsert: true },
      );

      this.logger.warn(
        `Tracked failed ${notificationType} for user ${userId}: ${errorMessage} (retry scheduled in ${this.RETRY_DELAYS_HOURS[0]}h)`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to track failed notification: ${error.message}`);
    }
  }

  /**
   * Process retry queue every 15 minutes DURING BUSINESS HOURS ONLY
   * CRITICAL FIX: Don't send notifications at night (00:00-08:00)
   * Runs from 9 AM to 9 PM Tashkent time only (not 24/7 like before)
   */
  @Cron('*/15 9-21 * * *', {
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

          // FIX #37: Use the user's language for retry messages.
          // Previously all retry messages were hardcoded in English,
          // even though the bot supports uz/ru/en.
          const userLang: string =
            notification.metadata?.userLanguage || (user as any).language || 'en';

          switch (notification.notificationType) {
            // FIX #39: `daily_task_delivery` should NOT be retried here.
            // The retry system can only re-send a plain text message, but
            // what the user actually needs is a DailyTask *document* created
            // in MongoDB + questions generated.  Only DailyTasksService's
            // `verifyAndFixMissedDeliveries` (11:00 Tashkent cron) can do
            // that correctly.  Sending a "tasks are ready!" message when no
            // task doc exists leads the user to /tasks showing nothing.
            //
            // Mark as permanently failed so the consistency checker doesn't
            // keep re-creating it, and let the 11:00 verification cron
            // handle the actual task creation + notification.
            case 'daily_task_delivery': {
              this.logger.debug(
                `Skipping retry for daily_task_delivery (user ${notification.userId}) — ` +
                `task creation requires DailyTasksService, not simple message retry`,
              );
              await this.markAsPermanentlyFailed(
                (notification as any)._id.toString(),
                'daily_task_delivery must be handled by verifyAndFixMissedDeliveries cron, not retry queue',
              );
              permanentlyFailed++;
              continue;
            }
            // FIX #40: `first_reminder`, `second_reminder`, `third_reminder`
            // should NOT be retried here.  The retry system can only re-send
            // a plain text message, but it CANNOT update
            // `DailyTask.reminders.firstReminderSentAt` (etc.), because it
            // has no DailyTask model injected and no knowledge of which task
            // doc to update.
            //
            // This causes an INFINITE LOOP:
            //   1. consistency-checker finds task with `firstReminderSentAt: null`
            //   2. Adds to retry queue
            //   3. Retry sends a plain text message → deletes FailedNotification
            //   4. BUT `DailyTask.reminders.firstReminderSentAt` is STILL null
            //   5. Next consistency-checker run → finds same task → goto 2
            //
            // TaskReminderService already handles reminders correctly at
            // 09:30 / 13:30 / 18:00 with proper `DailyTask.reminders`
            // field updates.  Mark these as permanently failed so the
            // consistency checker doesn't keep re-creating them.
            case 'first_reminder':
            case 'second_reminder':
            case 'third_reminder': {
              this.logger.debug(
                `Skipping retry for ${notification.notificationType} (user ${notification.userId}) — ` +
                `reminder retry cannot update DailyTask.reminders field, causes infinite loop`,
              );
              await this.markAsPermanentlyFailed(
                (notification as any)._id.toString(),
                `${notification.notificationType} must be handled by TaskReminderService, not retry queue (would cause infinite loop)`,
              );
              permanentlyFailed++;
              continue;
            }
            case 'trial_reminder': {
              const trialMessages: Record<string, string> = {
                uz: "Eslatma: Bepul sinov muddatingiz tez orada tugaydi!",
                ru: 'Напоминание: Ваш пробный период скоро заканчивается!',
                en: 'Reminder: Your free trial is ending soon!',
              };
              message = trialMessages[userLang] || trialMessages.en;
              break;
            }
            case 'trial_expiry':
              message = notification.metadata?.messageContent || 'Your trial has expired!';
              break;
            // NOTE: first_reminder/second_reminder/third_reminder are handled
            // above (marked permanently failed) — they never reach here.
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
                  await this.incrementRetryCount((notification as any)._id.toString(), notification.retryCount);
                  failed++;
                }
                continue;
              } catch (error: any) {
                this.logger.error(`Position prompt retry failed: ${error.message}`);
                await this.incrementRetryCount((notification as any)._id.toString(), notification.retryCount);
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
                  await this.incrementRetryCount((notification as any)._id.toString(), notification.retryCount);
                  failed++;
                }
                continue;
              } catch (error: any) {
                this.logger.error(`Employment survey retry failed: ${error.message}`);
                await this.incrementRetryCount((notification as any)._id.toString(), notification.retryCount);
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
            const nextRetryAt = new Date(Date.now() + nextRetryDelay * 60 * 60 * 1000);

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
  private async incrementRetryCount(
    notificationId: string,
    currentRetryCount?: number,
  ): Promise<void> {
    // If currentRetryCount provided (from caller), skip extra DB round-trip
    let retryCount = currentRetryCount;
    if (retryCount === undefined) {
      const notification = await this.failedNotificationModel.findById(notificationId);
      if (!notification) return;
      retryCount = notification.retryCount;
    }

    const nextRetryDelay = this.RETRY_DELAYS_HOURS[retryCount + 1] || 24;
    const nextRetryAt = new Date(Date.now() + nextRetryDelay * 60 * 60 * 1000);

    await this.failedNotificationModel.findByIdAndUpdate(notificationId, {
      $inc: { retryCount: 1 },
      $set: { nextRetryAt },
    });

    this.logger.debug(
      `Retry ${retryCount + 1}/${this.MAX_RETRY_ATTEMPTS} scheduled for notification ${notificationId} (next retry in ${nextRetryDelay}h)`,
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
