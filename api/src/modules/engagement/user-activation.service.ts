import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
   * FIX #96: REMOVED engageNonRegisteredUsers()
   *
   * This was a dead TODO stub with a cron schedule identical to
   * UnregisteredUserService.engageNonRegisteredUsers() (every 6 hours).
   * Having two cron jobs with the same name/schedule causes confusion.
   * The actual implementation lives in UnregisteredUserService.
   */

  /**
   * Remind free trial users about their trial
   *
   * FIX #95: DISABLED CRON — This was a DUPLICATE of TrialNotificationService
   * which runs at 10:00 AM Tashkent. Both services sent trial reminders to the
   * same users, and when both ran at 10:00 there was a race condition on
   * `lastTrialNotificationDate`. TrialNotificationService is kept because it
   * has personalized messages (active vs inactive users) and upgrade keyboard.
   *
   * This method is kept for manual invocation via sendActivationMessage() but
   * the cron is removed to prevent duplicate notifications.
   */
  // @Cron('0 10,18 * * *') — REMOVED (FIX #95: duplicate of TrialNotificationService)
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
          // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
          const totalInterviews = 1;
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
        // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
        const totalInterviews = 1;

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
