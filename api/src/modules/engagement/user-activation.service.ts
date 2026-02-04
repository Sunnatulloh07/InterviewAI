import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
import {
  getRandomNonRegisteredMessage,
  getTrialReminderMessage,
  getTrialEndingSoonMessage,
} from './constants/engagement-messages';

/**
 * User Activation Service
 *
 * Handles engagement for two user segments:
 *
 * 1. NON-REGISTERED USERS (started bot but didn't register)
 *    - Send 10 different motivational messages
 *    - Goal: Convert to registered users
 *    - Schedule: Every 6 hours, send 1 random message
 *
 * 2. FREE TRIAL USERS (registered but not fully using features)
 *    - Remind about trial expiration
 *    - Show remaining days and unused features
 *    - Goal: Activate features and convert to paid users
 *    - Schedule: Daily at 10:00 and 18:00
 */
@Injectable()
export class UserActivationService {
  private readonly logger = new Logger(UserActivationService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
  ) {}

  /**
   * Engage non-registered users
   * Runs every 6 hours to send motivational messages
   *
   * Note: Non-registered users don't have User document yet,
   * so we track them via TelegramSession with a flag
   */
  @Cron('0 */6 * * *', {
    name: 'engage-non-registered-users',
    timeZone: 'Asia/Tashkent',
  })
  async engageNonRegisteredUsers() {
    try {
      // TODO: Implement tracking for users who started bot but didn't register
      // This requires adding a flag to TelegramSession or creating a separate collection
      // For now, we'll skip this as it needs schema changes

      this.logger.log('Non-registered user engagement - pending implementation');

      // Implementation plan:
      // 1. Track users who pressed /start in TelegramSession
      // 2. Check if they completed registration (have User document)
      // 3. Send random engagement message every 6 hours
      // 4. Stop after registration or after 10 messages (60 hours)
    } catch (error: any) {
      this.logger.error(`Non-registered user engagement failed: ${error.message}`);
    }
  }

  /**
   * Remind free trial users about their trial
   * Runs twice daily at 10:00 and 18:00 (Tashkent time)
   */
  @Cron('0 10,18 * * *', {
    name: 'trial-user-reminders',
    timeZone: 'Asia/Tashkent',
  })
  async sendTrialReminders() {
    try {
      const now = new Date();

      // Find users on free trial
      const trialUsers = await this.userModel
        .find({
          'subscription.status': 'trialing',
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $gt: now }, // Trial not expired yet
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
        })
        .select('_id telegramId language subscription usage lastTrialNotificationDate')
        .lean();

      this.logger.log(`Found ${trialUsers.length} trial users for reminders`);

      let sent = 0;
      let skipped = 0;

      for (const user of trialUsers) {
        try {
          // CRITICAL FIX: Check if we already sent a notification today
          // Use date-only comparison (ignore time) to prevent duplicate sends
          const lastNotificationDate = user.lastTrialNotificationDate;
          if (lastNotificationDate) {
            const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const lastNotifStr = new Date(lastNotificationDate).toISOString().split('T')[0];

            if (lastNotifStr === todayStr) {
              skipped++;
              continue; // Already sent today
            }
          }

          // Calculate days remaining
          if (!user.subscription.trialEndsAt) {
            skipped++;
            continue; // No trial end date
          }

          const trialEndsAt = new Date(user.subscription.trialEndsAt);
          // ✅ FIX: Math.ceil → Math.floor for accurate remaining days
          // If trial ends 2026-02-11 10:00 and now is 2026-02-11 09:00 (1h left),
          // Math.ceil would show "1 day" which is misleading
          // Math.floor shows "0 days" which triggers urgent message correctly
          const daysRemaining = Math.floor(
            (trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          if (daysRemaining <= 0) {
            skipped++;
            continue; // Trial expired
          }

          // Get trial limits based on plan features
          // ✅ FIX: 5 → 3 (per COMPLETE_PLAN_LIMITS and PROJECT_OVERVIEW_V2.md)
          const totalInterviews = 3; // Free trial limit (text only)
          const usedInterviews = user.usage?.mockInterviewsThisMonth || 0;

          let message: string;

          if (daysRemaining === 1) {
            // Trial ending tomorrow - urgent message
            message = getTrialEndingSoonMessage(user.language || 'uz');
          } else {
            // Regular trial reminder
            message = getTrialReminderMessage(
              daysRemaining,
              usedInterviews,
              totalInterviews,
              user.language || 'uz',
            );
          }

          // Send message
          const bot = this.telegramService.getBot();
          if (bot && user.telegramId) {
            try {
              await bot.api.sendMessage(user.telegramId, message, {
                parse_mode: 'HTML',
              });

              // Update last notification date
              await this.userModel.findByIdAndUpdate(user._id, {
                $set: { lastTrialNotificationDate: now },
              });

              sent++;
              this.logger.debug(
                `Sent trial reminder to user ${user._id} (${daysRemaining} days remaining)`,
              );
            } catch (sendError: any) {
              // CRITICAL: Handle Telegram bot block errors
              const errorCode = sendError.error_code;
              const errorDescription = sendError.description || '';

              if (
                errorCode === 403 ||
                errorDescription.includes('bot was blocked') ||
                errorDescription.includes('user is deactivated') ||
                errorDescription.includes('chat not found')
              ) {
                this.logger.warn(`User ${user._id} blocked bot. Marking as blocked.`);

                await this.userModel.findByIdAndUpdate(user._id, {
                  $set: {
                    'engagement.isBotBlocked': true,
                    'engagement.botBlockedAt': now,
                  },
                });
              } else {
                // Track for retry
                await this.retryService.trackFailedNotification(
                  user._id.toString(),
                  user.telegramId,
                  'trial_reminder',
                  errorDescription,
                  errorCode,
                  {
                    daysRemaining,
                    messageContent: message,
                    usedInterviews,
                    totalInterviews,
                  },
                );
                throw sendError;
              }
            }
          }

          // Rate limiting
          await this.delay(200);
        } catch (userError: any) {
          this.logger.error(
            `Failed to send trial reminder to user ${user._id}: ${userError.message}`,
          );
        }
      }

      this.logger.log(`Trial reminders: sent=${sent}, skipped=${skipped}`);
    } catch (error: any) {
      this.logger.error(`Trial reminder job failed: ${error.message}`);
    }
  }

  /**
   * Send activation message to specific user (can be called manually)
   */
  async sendActivationMessage(
    userId: string,
    messageType: 'trial' | 'non_registered',
  ): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId).lean();
      if (!user || !user.telegramId) {
        return false;
      }

      let message: string;

      if (messageType === 'trial') {
        if (!user.subscription.trialEndsAt) {
          return false; // No trial end date
        }

        const now = new Date();
        const trialEndsAt = new Date(user.subscription.trialEndsAt);
        // ✅ FIX: Math.ceil → Math.floor for accurate remaining days
        const daysRemaining = Math.floor(
          (trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const usedInterviews = user.usage?.mockInterviewsThisMonth || 0;
        // ✅ FIX: 5 → 3 (per COMPLETE_PLAN_LIMITS)
        const totalInterviews = 3;

        message = getTrialReminderMessage(
          daysRemaining,
          usedInterviews,
          totalInterviews,
          user.language || 'uz',
        );
      } else {
        message = getRandomNonRegisteredMessage(user.language || 'uz');
      }

      const bot = this.telegramService.getBot();
      if (bot) {
        try {
          await bot.api.sendMessage(user.telegramId, message);
          return true;
        } catch (sendError: any) {
          // Handle bot block errors
          const errorCode = sendError.error_code;
          const errorDescription = sendError.description || '';

          if (
            errorCode === 403 ||
            errorDescription.includes('bot was blocked') ||
            errorDescription.includes('user is deactivated') ||
            errorDescription.includes('chat not found')
          ) {
            this.logger.warn(`User ${userId} blocked bot. Marking as blocked.`);

            await this.userModel.findByIdAndUpdate(userId, {
              $set: {
                'engagement.isBotBlocked': true,
                'engagement.botBlockedAt': new Date(),
              },
            });
          }

          return false;
        }
      }

      return false;
    } catch (error: any) {
      this.logger.error(`Failed to send activation message: ${error.message}`);
      return false;
    }
  }

  /**
   * Get trial users statistics (for monitoring)
   */
  async getTrialUsersStats(): Promise<{
    total: number;
    expiringSoon: number; // 1-2 days left
    lowUsage: number; // Used < 2 interviews
  }> {
    try {
      const now = new Date();
      const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

      const [total, expiringSoon, lowUsage] = await Promise.all([
        this.userModel.countDocuments({
          'subscription.status': 'trialing',
          'subscription.plan': 'free_trial',
        }),
        this.userModel.countDocuments({
          'subscription.status': 'trialing',
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $lte: twoDaysFromNow, $gt: now },
        }),
        this.userModel.countDocuments({
          'subscription.status': 'trialing',
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $lt: 2 },
        }),
      ]);

      return { total, expiringSoon, lowUsage };
    } catch (error: any) {
      this.logger.error(`Failed to get trial stats: ${error.message}`);
      return { total: 0, expiringSoon: 0, lowUsage: 0 };
    }
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
