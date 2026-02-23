import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EngagementService } from './engagement.service';
import { SurveyHandlerService } from './survey-handler.service';
import { PositionPromptService } from './position-prompt.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { JobSeekingStatus } from './dto/job-seeking-status.enum';
import { getTashkentMidnight } from '@common/utils/tashkent-time';

/**
 * Scheduler configuration
 */
const SCHEDULER_CONFIG = {
  /** Maximum users to process per batch */
  BATCH_SIZE: 50,
  /** Delay between processing each user (ms) - prevents rate limiting */
  USER_DELAY_MS: 200,
  /** Maximum concurrent notifications */
  MAX_CONCURRENT: 5,
  /** Maximum users to process per single run (safety limit) */
  MAX_USERS_PER_RUN: 500,
} as const;

/**
 * Job run statistics
 */
interface JobRunStats {
  lastRunAt: Date | null;
  lastRunDurationMs: number;
  lastRunResults: { sent: number; failed: number; skipped: number };
  totalRunsToday: number;
  totalSentToday: number;
}

/**
 * EngagementSchedulerService
 *
 * Handles scheduled tasks for the engagement system:
 * - Daily notification processing (09:00 UTC+5 = 04:00 UTC)
 * - Expired notification cleanup
 * - Batch processing with rate limiting
 *
 * Features:
 * - Environment-based enable/disable
 * - Graceful shutdown support
 * - Run statistics for monitoring
 * - Duplicate processing prevention
 */
@Injectable()
export class EngagementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngagementSchedulerService.name);
  private isProcessing = false;
  private isEnabled = true;
  private shouldStop = false;

  private stats: JobRunStats = {
    lastRunAt: null,
    lastRunDurationMs: 0,
    lastRunResults: { sent: 0, failed: 0, skipped: 0 },
    totalRunsToday: 0,
    totalSentToday: 0,
  };

  constructor(
    private readonly engagementService: EngagementService,
    private readonly surveyHandlerService: SurveyHandlerService,
    private readonly positionPromptService: PositionPromptService,
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  onModuleInit(): void {
    // Check if scheduler is enabled via environment
    const disabled = this.configService.get<string>('ENGAGEMENT_SCHEDULER_DISABLED');
    const nodeEnv = this.configService.get<string>('NODE_ENV');

    // Disable in test environment by default
    if (disabled === 'true' || nodeEnv === 'test') {
      this.isEnabled = false;
      this.logger.warn(
        'EngagementSchedulerService DISABLED (set ENGAGEMENT_SCHEDULER_DISABLED=false to enable)',
      );
      return;
    }

    this.logger.log('EngagementSchedulerService initialized and enabled');
  }

  onModuleDestroy(): void {
    // Signal jobs to stop gracefully
    this.shouldStop = true;
    this.logger.log('EngagementSchedulerService shutting down gracefully');
  }

  /**
   * AI engagement notifications — fires at 10:00 and 18:00 Tashkent.
   *
   * Two windows per day is enough for free/trial users.
   * Premium users receive task reminders at 10:30 / 13:30 / 18:30 via TaskReminderService.
   * The engagement.service dedup guard (lastNotificationSentAt < today) ensures each
   * user receives at most ONE AI engagement message per calendar day regardless of how
   * many times this cron fires.
   */
  @Cron('0 10,18 * * *', { name: 'hourly-engagement-notifications', timeZone: 'Asia/Tashkent' })
  async handleDailyNotifications(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug('Scheduler disabled, skipping daily notifications');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('Daily notification job already running, skipping');
      return;
    }

    this.isProcessing = true;
    this.shouldStop = false;
    const startTime = Date.now();
    this.logger.log('Starting daily engagement notification job');

    try {
      const results = await this.processNotificationBatches();

      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);

      // Update stats
      this.updateStats(durationMs, results);

      this.logger.log(
        `Daily notification job completed in ${durationSec}s: ` +
          `sent=${results.sent}, failed=${results.failed}, skipped=${results.skipped}`,
      );
    } catch (error) {
      this.logger.error(`Daily notification job failed: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Expired notifications job - runs every 6 hours
   * Marks notifications as ignored if 24h response window expired
   */
  @Cron('0 */6 * * *', { name: 'process-expired-notifications' })
  async handleExpiredNotifications(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug('Processing expired notifications');

    try {
      const result = await this.engagementService.processExpiredNotifications();

      if (result.processed > 0) {
        this.logger.log(
          `Processed ${result.processed} expired notifications, ${result.errors} errors`,
        );
      }
    } catch (error) {
      this.logger.error(`Expired notifications job failed: ${error.message}`);
    }
  }

  /**
   * Pending surveys job - runs every 15 minutes between 09:00-21:00 (Tashkent time)
   * Handles two categories:
   * 1. NEW USERS: Scheduled surveys (scheduledSurveyAt set by pre-save hook, 3-4h after registration)
   * 2. EXISTING USERS: Backfill users who haven't completed survey and don't have scheduledSurveyAt
   *
   * SCALABILITY: Processes max 1000 users per run = 4000/hour
   */
  /**
   * Pending surveys job - runs daily at 10:05 Tashkent (staggered 5 min after engagement cron).
   * Handles two categories:
   * 1. NEW USERS: Scheduled surveys (scheduledSurveyAt set by pre-save hook, 3-4h after registration)
   * 2. EXISTING USERS: Backfill users who haven't completed survey (7-day re-send guard)
   *
   * SCALABILITY: Processes max 1000 users per run
   */
  @Cron('5 10 * * *', { name: 'process-pending-surveys', timeZone: 'Asia/Tashkent' })
  async handlePendingSurveys(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug('Processing pending surveys');

    try {
      const now = new Date();
      const startOfToday = getTashkentMidnight(now);

      const BATCH_SIZE = 1000;

      // ═══════════════════════════════════════════════════════════════════════
      // QUERY 1: New users with scheduled surveys
      // ═══════════════════════════════════════════════════════════════════════
      const scheduledUsers = await this.userModel
        .find({
          'engagement.scheduledSurveyAt': { $lte: now, $ne: null },
          'engagement.surveyCompletedAt': null,
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          // Safety: Don't send if already notified today
          $or: [
            { 'engagement.lastNotificationSentAt': null },
            { 'engagement.lastNotificationSentAt': { $lt: startOfToday } },
          ],
          deletedAt: null,
        })
        .select('_id telegramId language')
        .limit(BATCH_SIZE)
        .lean()
        .exec();

      // ═══════════════════════════════════════════════════════════════════════
      // QUERY 2: Users with UNKNOWN status
      // ═══════════════════════════════════════════════════════════════════════
      const remainingSlots = BATCH_SIZE - scheduledUsers.length;
      let existingUsers: any[] = [];

      if (remainingSlots > 0) {
        // Users with unknown/unset job-seeking status: only those who:
        //   - registered at least 3h ago (bot onboarding settled)
        //   - have NEVER been surveyed OR last survey notification was 7+ days ago (weekly retry)
        //   - survey still not completed
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        existingUsers = await this.userModel
          .find({
            createdAt: { $lte: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
            'engagement.surveyCompletedAt': null,
            'engagement.isBotBlocked': { $ne: true },
            'engagement.notificationsPaused': { $ne: true },
            telegramId: { $exists: true, $ne: null },
            deletedAt: null,
            // Use $and to avoid duplicate $or key (TS1117)
            $and: [
              // Status is genuinely unknown (not_set / null / missing field)
              {
                $or: [
                  { 'engagement.jobSeekingStatus': { $exists: false } },
                  { 'engagement.jobSeekingStatus': null },
                  { 'engagement.jobSeekingStatus': 'not_set' }, // canonical lowercase enum value
                ],
              },
              // 7-day re-send guard: never notified OR last notification was 7+ days ago
              {
                $or: [
                  { 'engagement.lastNotificationSentAt': null },
                  { 'engagement.lastNotificationSentAt': { $exists: false } },
                  { 'engagement.lastNotificationSentAt': { $lte: sevenDaysAgo } },
                ],
              },
            ],
          })
          .select('_id telegramId language engagement')
          .limit(remainingSlots)
          .lean()
          .exec();
      }

      const allUsers = [...scheduledUsers, ...existingUsers];

      if (allUsers.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${allUsers.length} surveys: scheduled=${scheduledUsers.length}, existing=${existingUsers.length}`,
      );

      let sent = 0;
      let failed = 0;

      for (const user of allUsers) {
        if (this.shouldStop) break;

        try {
          const success = await this.surveyHandlerService.sendSurvey(
            user._id.toString(),
            user.telegramId,
            user.language || 'uz',
          );

          if (success) {
            sent++;
          } else {
            failed++;
          }

          // Rate limiting: 200ms delay between surveys (5 per sec = 300 per min)
          await this.delay(200);
        } catch (error) {
          failed++;
          this.logger.error(`Failed to send survey to user ${user._id}: ${error.message}`);
        }
      }

      this.logger.log(`Pending surveys processed: sent=${sent}, failed=${failed}`);
    } catch (error) {
      this.logger.error(`Pending surveys job failed: ${error.message}`);
    }
  }

  /**
   * Job-seeker inactivity check - runs twice daily at 10:00 and 18:00 (Tashkent time)
   * Sends motivational nudges to active job seekers who haven't used the bot in 24h
   */
  // Staggered 10 min after surveys (10:10) to avoid DB collision at 10:00.
  // 18:10 second run catches users who became inactive since morning.
  @Cron('10 10,18 * * *', { name: 'jobseeker-inactivity-check', timeZone: 'Asia/Tashkent' })
  async handleJobseekerInactivity(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug('Checking job-seeker inactivity');

    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      // Find active job seekers inactive for 24-48h
      const inactiveJobseekers = await this.userModel
        .find({
          'engagement.jobSeekingStatus': JobSeekingStatus.ACTIVELY_LOOKING,
          'engagement.lastActiveAt': {
            $lte: twentyFourHoursAgo,
            $gte: fortyEightHoursAgo, // Don't spam users who've been inactive longer
          },
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          // Avoid sending if we already sent a notification recently
          $or: [
            { 'engagement.lastNotificationSentAt': null },
            { 'engagement.lastNotificationSentAt': { $lte: twentyFourHoursAgo } },
          ],
          deletedAt: null,
        })
        .select('_id')
        .limit(100)
        .lean()
        .exec();

      if (inactiveJobseekers.length === 0) {
        return;
      }

      this.logger.log(`Found ${inactiveJobseekers.length} inactive job seekers`);

      // Process through engagement service which handles AI message generation
      for (const user of inactiveJobseekers) {
        if (this.shouldStop) break;

        try {
          await this.engagementService.processUserForEngagement(user._id.toString());
          await this.delay(200);
        } catch (error) {
          this.logger.error(`Failed to notify inactive jobseeker ${user._id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Job-seeker inactivity check failed: ${error.message}`);
    }
  }

  /**
   * 🔧 FIX: Position prompt handler - runs every 15 minutes between 09:00-21:00 (Tashkent time)
   * Prompts users to confirm their position if:
   * - 4+ hours have passed since registration
   * - Still have default 'junior' position
   * - Haven't manually confirmed their position
   */
  // Position prompts: once daily at 10:15 (staggered after surveys + inactivity).
  // One-shot per user (positionPromptSentAt guard), no need to run every 15 min.
  @Cron('15 10 * * *', { name: 'position-prompts', timeZone: 'Asia/Tashkent' })
  async handlePositionPrompts(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug('Processing scheduled position prompts');

    try {
      const now = new Date();

      // Query 1: Users with scheduled position prompt time that has passed
      const scheduledUsers = await this.userModel
        .find({
          'engagement.scheduledPositionPromptAt': {
            $lte: now,
            $ne: null,
          },
          'engagement.positionConfirmed': false, // Not yet confirmed
          'engagement.positionPromptSentAt': null, // CRITICAL: Never sent before (no retries)
          'profile.position': 'junior', // Still default
          'engagement.isBotBlocked': { $ne: true },
          deletedAt: null,
        })
        .select('_id telegramId language profile engagement')
        .limit(50)
        .lean()
        .exec();

      // Query 2: Backfill for existing users without scheduled time (created before this feature)
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const backfillUsers = await this.userModel
        .find({
          createdAt: { $lte: fourHoursAgo },
          'profile.position': 'junior',
          'engagement.positionConfirmed': { $ne: true },
          'engagement.scheduledPositionPromptAt': null, // No schedule set
          'engagement.positionPromptSentAt': null, // CRITICAL: Never sent before (no retries)
          'engagement.isBotBlocked': { $ne: true },
          deletedAt: null,
        })
        .select('_id telegramId language profile engagement')
        .limit(20)
        .lean()
        .exec();

      const allUsers = [...scheduledUsers, ...backfillUsers];

      if (allUsers.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${allUsers.length} users needing position prompts ` +
          `(${scheduledUsers.length} scheduled, ${backfillUsers.length} backfill)`,
      );

      let sent = 0;
      let failed = 0;

      for (const user of allUsers) {
        if (this.shouldStop) break;

        try {
          const result = await this.positionPromptService.sendPositionPrompt(
            user._id.toString(),
            user.telegramId,
            user.language || 'uz',
          );

          if (result.success) {
            sent++;

            // CRITICAL: Mark as sent and clear scheduled time to prevent re-sending.
            // Also update shared daily cap so AI engagement cron skips this user today.
            await this.userModel.findByIdAndUpdate(user._id, {
              $set: {
                'engagement.scheduledPositionPromptAt': null,
                'engagement.positionPromptSentAt': new Date(),
                'engagement.lastNotificationSentAt': new Date(),
              },
            });
          } else {
            failed++;
          }

          // Rate limiting delay
          await this.delay(200);
        } catch (error) {
          this.logger.error(`Failed to send position prompt to user ${user._id}: ${error.message}`);
          failed++;
        }
      }

      this.logger.log(`Position prompts processed: sent=${sent}, failed=${failed}`);
    } catch (error) {
      this.logger.error(`Position prompts job failed: ${error.message}`);
    }
  }

  /**
   * Process notifications in batches with rate limiting
   * Uses a Set to prevent processing the same user twice in one run
   */
  private async processNotificationBatches(): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Safety: prevent infinite loops
    let totalProcessedCount = 0;
    const MAX_TOTAL_USERS = 10000;

    // Keep track of users processed effectively in this run to avoid duplicates
    // This is crucial if a user fails but remains "eligible" in DB
    const processedUserIds = new Set<string>();

    let hasMoreUsers = true;
    let batchIndex = 0;

    this.logger.log('Starting batched user processing...');

    while (hasMoreUsers && !this.shouldStop) {
      if (totalProcessedCount >= MAX_TOTAL_USERS) {
        this.logger.warn(`Hit MAX_TOTAL_USERS limit (${MAX_TOTAL_USERS}). Stopping job.`);
        break;
      }

      // Fetch next batch of users
      // We rely on previous batch having their 'nextNotificationAt' updated
      // so they are no longer eligible.
      // Failed users (not updated) are filtered by processedUserIds check.
      const users = await this.engagementService.getEligibleUsers(
        SCHEDULER_CONFIG.MAX_USERS_PER_RUN,
      );

      if (users.length === 0) {
        hasMoreUsers = false;
        break;
      }

      // Filter out already processed users (to prevent infinite loop on failed-but-eligible users)
      const newUsers = users.filter((id) => !processedUserIds.has(id));

      if (newUsers.length === 0) {
        this.logger.debug('Fetched users were already processed. Stopping loop.');
        hasMoreUsers = false;
        break;
      }

      this.logger.debug(`Batch ${batchIndex + 1}: Found ${newUsers.length} new eligible users`);

      // Process this batch
      const results = await this.processBatch(newUsers);

      // Track processed IDs
      newUsers.forEach((id) => processedUserIds.add(id));
      totalProcessedCount += newUsers.length;

      totalSent += results.sent;
      totalFailed += results.failed;
      totalSkipped += results.skipped;

      batchIndex++;

      // Small delay between generic batches to be nice to DB/CPU
      await this.delay(SCHEDULER_CONFIG.USER_DELAY_MS);
    }

    return { sent: totalSent, failed: totalFailed, skipped: totalSkipped };
  }

  /**
   * Process a batch of users with controlled concurrency
   */
  private async processBatch(userIds: string[]): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Process in chunks for controlled concurrency
    for (let i = 0; i < userIds.length; i += SCHEDULER_CONFIG.MAX_CONCURRENT) {
      // Check for graceful shutdown
      if (this.shouldStop) break;

      const chunk = userIds.slice(i, i + SCHEDULER_CONFIG.MAX_CONCURRENT);

      const results = await Promise.allSettled(chunk.map((userId) => this.processUser(userId)));

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value === 'sent') sent++;
          else if (result.value === 'skipped') skipped++;
          else if (result.value === 'failed') failed++;
        } else {
          failed++;
        }
      }

      // Add delay between chunks to prevent rate limiting
      if (i + SCHEDULER_CONFIG.MAX_CONCURRENT < userIds.length) {
        await this.delay(SCHEDULER_CONFIG.USER_DELAY_MS);
      }
    }

    return { sent, failed, skipped };
  }

  /**
   * Process a single user for notification
   */
  private async processUser(userId: string): Promise<'sent' | 'failed' | 'skipped'> {
    try {
      const result = await this.engagementService.processUserForEngagement(userId);

      if (!result) {
        return 'skipped'; // No trigger or not eligible
      }

      return result.success ? 'sent' : 'failed';
    } catch (error) {
      this.logger.debug(`Failed to process user ${userId}: ${error.message}`);
      return 'failed';
    }
  }

  /**
   * Update run statistics
   */
  private updateStats(
    durationMs: number,
    results: { sent: number; failed: number; skipped: number },
  ): void {
    const now = new Date();
    const lastRunDate = this.stats.lastRunAt;

    // Reset daily counts if it's a new day
    if (!lastRunDate || lastRunDate.toDateString() !== now.toDateString()) {
      this.stats.totalRunsToday = 0;
      this.stats.totalSentToday = 0;
    }

    this.stats.lastRunAt = now;
    this.stats.lastRunDurationMs = durationMs;
    this.stats.lastRunResults = results;
    this.stats.totalRunsToday++;
    this.stats.totalSentToday += results.sent;
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing (can be called via admin endpoint)
   */
  async triggerManualRun(): Promise<{ sent: number; failed: number; skipped: number }> {
    if (!this.isEnabled) {
      throw new Error('Scheduler is disabled');
    }

    if (this.isProcessing) {
      throw new Error('Job already running');
    }

    this.logger.log('Manual engagement run triggered');
    this.isProcessing = true;
    this.shouldStop = false;
    const startTime = Date.now();

    try {
      const results = await this.processNotificationBatches();
      this.updateStats(Date.now() - startTime, results);
      return results;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get scheduler status and statistics (for monitoring)
   */
  getStatus(): {
    isEnabled: boolean;
    isProcessing: boolean;
    stats: JobRunStats;
  } {
    return {
      isEnabled: this.isEnabled,
      isProcessing: this.isProcessing,
      stats: { ...this.stats },
    };
  }

  /**
   * Enable/disable scheduler dynamically
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.logger.log(`Scheduler ${enabled ? 'enabled' : 'disabled'}`);
  }
}
