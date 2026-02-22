import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { DailyTask, DailyTaskDocument } from '../tasks/schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
import { getTashkentMidnight, getTashkentHour } from '@common/utils/tashkent-time';

@Injectable()
export class NotificationConsistencyChecker {
  private readonly logger = new Logger(NotificationConsistencyChecker.name);

  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
  ) {}

  /**
   * 🔧 FIXED: Missed notification checker - runs every 30 minutes between 09:00-22:00
   * Checks for missed notifications and sends them BEFORE 22:00 (not AT 22:00)
   * This ensures users receive important notifications during the day, not late at night
   */
  @Cron('*/30 9-21 * * *', {
    name: 'missed-notification-checker',
    timeZone: 'Asia/Tashkent',
  })
  async runMissedNotificationCheck(): Promise<void> {
    try {
      const now = new Date();
      // FIX #29: Use Tashkent hour, not server-local hour.
      // The cron runs on Asia/Tashkent schedule, so the guard must
      // also use Tashkent time to stay consistent.
      const currentHour = getTashkentHour(now);

      // Don't run if it's past 22:00 (21:30-21:59 is last run)
      if (currentHour >= 22) {
        this.logger.debug('Skipping missed notification check after 22:00 Tashkent');
        return;
      }

      this.logger.log(
        `Running missed notification check at ${currentHour}:${now.getMinutes().toString().padStart(2, '0')}`,
      );

      const results = await Promise.all([
        this.checkMissedPositionPrompts(),
        this.checkMissedEmploymentSurveys(),
      ]);

      const totalIssues = results.reduce((sum, r) => sum + r.missed, 0);
      const totalFixed = results.reduce((sum, r) => sum + r.fixed, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      if (totalIssues > 0) {
        this.logger.log(
          `Missed notification check: issues=${totalIssues}, fixed=${totalFixed}, failed=${totalFailed}`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Missed notification check failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Daily summary check - runs at 23:00 to report missed notifications for the day.
   *
   * FIX #40: Removed `checkFirstReminders`, `checkSecondReminders`,
   * `checkThirdReminders` from this summary.  Those methods add entries
   * to the retry queue, but:
   *   - The retry queue cannot update `DailyTask.reminders` fields
   *   - This causes an infinite loop (see FIX #40 in retry service)
   *   - TaskReminderService is the authoritative source for reminders
   *   - At 23:00 the day is over, retrying reminders is meaningless
   *
   * We now only monitor task delivery and engagement notifications,
   * which CAN be meaningfully retried by the retry queue.
   *
   * The 23:00 summary now uses monitoring-only stat methods that
   * COUNT missed items but do NOT write to the retry queue.
   */
  @Cron('0 23 * * *', {
    name: 'daily-notification-summary',
    timeZone: 'Asia/Tashkent',
  })
  async runDailySummary(): Promise<void> {
    try {
      this.logger.log('Running daily notification summary...');

      // FIX #40: 23:00 summary is MONITORING ONLY — no retry queue writes.
      // At 23:00 the day is over; creating retry records here would:
      //   - daily_task_delivery: immediately marked permanently failed (FIX #39) — wasteful
      //   - engagement: retried next morning — but the engagement cron already handles this
      //   - reminders: would cause infinite loop (FIX #40)
      // Instead, we just COUNT missed items and log for visibility.
      const results = await Promise.all([
        this.getEndOfDayTaskDeliveryStats(),
        this.getEndOfDayEngagementStats(),
        this.getEndOfDayReminderStats(),
      ]);

      const totalIssues = results.reduce((sum, r) => sum + r.missed, 0);
      const totalFixed = results.reduce((sum, r) => sum + r.fixed, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      this.logger.log(
        `Daily summary complete: issues=${totalIssues}, fixed=${totalFixed}, failed=${totalFailed}`,
      );
    } catch (error: any) {
      this.logger.error(`Daily summary failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Monitoring-only: Count users who didn't receive daily tasks today.
   * Does NOT add to retry queue — the 11:00 verification cron handles this.
   */
  private async getEndOfDayTaskDeliveryStats(): Promise<{
    missed: number;
    fixed: number;
    failed: number;
  }> {
    try {
      const now = new Date();
      const today = getTashkentMidnight(now);

      const paidUsersCount = await this.userModel.countDocuments({
        'subscription.status': 'active',
        'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
        $or: [
          { 'subscription.endDate': { $exists: false } },
          { 'subscription.endDate': null },
          { 'subscription.endDate': { $gt: now } },
        ],
        isBlocked: false,
        'engagement.isBotBlocked': { $ne: true },
        createdAt: { $lt: new Date(now.getTime() - 60 * 60 * 1000) },
      });

      const usersWithTasksCount = await this.dailyTaskModel.countDocuments({
        date: today,
      });

      const missedCount = Math.max(0, paidUsersCount - usersWithTasksCount);

      if (missedCount > 0) {
        this.logger.warn(
          `End-of-day task delivery stats: ${missedCount} paid users without daily tasks (monitoring only)`,
        );
      }

      return { missed: missedCount, fixed: 0, failed: 0 };
    } catch (error: any) {
      this.logger.error(`Task delivery stats check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  /**
   * Monitoring-only: Count users who missed engagement notifications today.
   * Does NOT add to retry queue — the hourly engagement cron handles this.
   */
  private async getEndOfDayEngagementStats(): Promise<{
    missed: number;
    fixed: number;
    failed: number;
  }> {
    try {
      const now = new Date();
      const startOfToday = getTashkentMidnight(now);

      const missedCount = await this.userModel.countDocuments({
        'engagement.isBotBlocked': { $ne: true },
        'engagement.notificationsPaused': { $ne: true },
        'engagement.consecutiveIgnores': { $lt: 5 },
        $or: [
          { 'engagement.nextNotificationAt': { $exists: false } },
          { 'engagement.nextNotificationAt': null },
          { 'engagement.nextNotificationAt': { $lte: now } },
        ],
        $and: [
          {
            $or: [
              { 'engagement.lastNotificationSentAt': { $exists: false } },
              { 'engagement.lastNotificationSentAt': null },
              { 'engagement.lastNotificationSentAt': { $lt: startOfToday } },
            ],
          },
        ],
      });

      if (missedCount > 0) {
        this.logger.warn(
          `End-of-day engagement stats: ${missedCount} users missed engagement notifications (monitoring only)`,
        );
      }

      return { missed: missedCount, fixed: 0, failed: 0 };
    } catch (error: any) {
      this.logger.error(`Engagement stats check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  /**
   * Monitoring-only: Count how many reminders were missed today.
   * Does NOT add to retry queue — just logs for visibility.
   */
  private async getEndOfDayReminderStats(): Promise<{
    missed: number;
    fixed: number;
    failed: number;
  }> {
    try {
      const today = getTashkentMidnight();

      const [missedFirst, missedSecond, missedThird] = await Promise.all([
        this.dailyTaskModel.countDocuments({
          date: today,
          status: 'pending',
          'reminders.firstReminderSentAt': null,
        }),
        this.dailyTaskModel.countDocuments({
          date: today,
          status: 'pending',
          'reminders.secondReminderSentAt': null,
        }),
        this.dailyTaskModel.countDocuments({
          date: today,
          status: 'pending',
          'reminders.thirdReminderSentAt': null,
        }),
      ]);

      const totalMissed = missedFirst + missedSecond + missedThird;

      if (totalMissed > 0) {
        this.logger.warn(
          `End-of-day reminder stats: ` +
          `first=${missedFirst}, second=${missedSecond}, third=${missedThird} missed (monitoring only)`,
        );
      }

      // fixed=0 because we don't take action — monitoring only
      return { missed: totalMissed, fixed: 0, failed: 0 };
    } catch (error: any) {
      this.logger.error(`Reminder stats check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  // FIX #40: Removed checkDailyTaskDelivery, checkFirstReminders,
  // checkSecondReminders, checkThirdReminders, checkEngagementNotifications
  // from runDailySummary.  These methods added to retry queue, but at 23:00:
  //   - daily_task_delivery retries are immediately permanently-failed (FIX #39)
  //   - reminders cause infinite loops (FIX #40)
  //   - engagement retries at night are meaningless
  // All replaced by monitoring-only stat methods above.

  /**
   * 🔧 FIXED: Check for missed position prompts
   * Finds users who need position confirmation:
   * - Registered 4+ hours ago
   * - Position is UNKNOWN: null, undefined, missing, or default 'junior'
   * - Haven't confirmed position yet
   */
  private async checkMissedPositionPrompts(): Promise<{
    missed: number;
    fixed: number;
    failed: number;
  }> {
    try {
      const now = new Date();
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

      // Find users with UNKNOWN position (null, undefined, missing, or junior)
      const missedUsers = await this.userModel
        .find({
          createdAt: { $lte: fourHoursAgo },
          // ✅ CRITICAL FIX: Complex $or with all conditions
          $or: [
            // Case 1: Position field doesn't exist
            {
              'profile.position': { $exists: false },
              $or: [
                { 'engagement.positionConfirmed': { $exists: false } },
                { 'engagement.positionConfirmed': { $ne: true } },
              ],
            },
            // Case 2: Position is null
            {
              'profile.position': null,
              $or: [
                { 'engagement.positionConfirmed': { $exists: false } },
                { 'engagement.positionConfirmed': { $ne: true } },
              ],
            },
            // Case 3: Position is default 'junior' and not confirmed
            {
              'profile.position': 'junior',
              $or: [
                { 'engagement.positionConfirmed': { $exists: false } },
                { 'engagement.positionConfirmed': { $ne: true } },
              ],
            },
          ],
          'engagement.isBotBlocked': { $ne: true },
          telegramId: { $exists: true, $ne: null },
          deletedAt: null,
        })
        .select('_id telegramId language profile engagement')
        .limit(100)
        .lean();

      if (missedUsers.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      this.logger.warn(
        `Found ${missedUsers.length} users with UNKNOWN position (null/undefined/junior)`,
      );

      let fixed = 0;
      let failed = 0;

      for (const user of missedUsers) {
        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'position_prompt',
            'Position prompt not delivered (position unknown)',
            undefined,
            {
              userLanguage: user.language,
              currentPosition: user.profile?.position || 'UNKNOWN',
            },
          );
          fixed++;
        } catch (error: any) {
          this.logger.error(
            `Failed to track missed position prompt for user ${user._id}: ${error.message}`,
          );
          failed++;
        }
      }

      return { missed: missedUsers.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Position prompt check failed: ${error.message}`, error.stack);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  /**
   * 🔧 FIXED: Check for missed employment status surveys
   * Finds users who need employment status:
   * - Registered 3+ hours ago
   * - Employment status is UNKNOWN: null, undefined, missing, or NOT_SET
   * - Haven't completed survey yet
   */
  private async checkMissedEmploymentSurveys(): Promise<{
    missed: number;
    fixed: number;
    failed: number;
  }> {
    try {
      const now = new Date();
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

      // Find users with UNKNOWN employment status
      const missedUsers = await this.userModel
        .find({
          createdAt: { $lte: threeHoursAgo },
          // ✅ CRITICAL FIX: Check for ALL unknown states
          $or: [
            // Case 1: Field doesn't exist
            {
              'engagement.jobSeekingStatus': { $exists: false },
              $or: [
                { 'engagement.surveyCompletedAt': { $exists: false } },
                { 'engagement.surveyCompletedAt': null },
              ],
            },
            // Case 2: Explicitly null
            {
              'engagement.jobSeekingStatus': null,
              $or: [
                { 'engagement.surveyCompletedAt': { $exists: false } },
                { 'engagement.surveyCompletedAt': null },
              ],
            },
            // Case 3: NOT_SET (user declined but might change mind)
            // We still prompt them once a week
            {
              'engagement.jobSeekingStatus': 'NOT_SET',
              $or: [
                { 'engagement.lastNotificationSentAt': { $exists: false } },
                { 'engagement.lastNotificationSentAt': null },
                {
                  'engagement.lastNotificationSentAt': {
                    $lte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
                  },
                },
              ],
            },
          ],
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          telegramId: { $exists: true, $ne: null },
          deletedAt: null,
        })
        .select('_id telegramId language engagement')
        .limit(100)
        .lean();

      if (missedUsers.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      this.logger.warn(
        `Found ${missedUsers.length} users with UNKNOWN employment status (null/undefined/NOT_SET)`,
      );

      let fixed = 0;
      let failed = 0;

      for (const user of missedUsers) {
        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'employment_survey',
            'Employment survey not delivered (status unknown)',
            undefined,
            {
              userLanguage: user.language,
              currentStatus: user.engagement?.jobSeekingStatus || 'UNKNOWN',
            },
          );
          fixed++;
        } catch (error: any) {
          this.logger.error(`Failed to track missed survey for user ${user._id}: ${error.message}`);
          failed++;
        }
      }

      return { missed: missedUsers.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Employment survey check failed: ${error.message}`, error.stack);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  async getConsistencyStats(): Promise<{
    lastCheckAt: Date | null;
    issuesFound: number;
    issuesFixed: number;
    issuesFailed: number;
  }> {
    return {
      lastCheckAt: new Date(),
      issuesFound: 0,
      issuesFixed: 0,
      issuesFailed: 0,
    };
  }
}
