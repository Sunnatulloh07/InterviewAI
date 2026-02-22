import { Injectable, Logger, forwardRef, Inject, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bot } from 'grammy';
import { ConfigService } from '@nestjs/config';

import { NotificationLogRepository } from './notification-log.repository';
import { getTashkentMidnight } from '@common/utils/tashkent-time';
import { EngagementAiService } from './engagement-ai.service';
import { NotificationTrigger, NotificationDeliveryStatus } from './schemas/notification-log.schema';
import {
  EngagementUserContext,
  NotificationResult,
  CreateNotificationLogDto,
} from './dto/engagement.dto';
import { JobSeekingStatus } from './dto/job-seeking-status.enum';
import { UsersService } from '../users/users.service';
import { InterviewsService } from '../interviews/interviews.service';
import { TelegramService } from '../telegram/telegram.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * Backoff configuration for notification scheduling
 * Each consecutive ignore increases the delay before next notification
 */
const BACKOFF_DAYS: ReadonlyArray<number> = [1, 2, 4, 7, 14]; // Index = ignoreCount
const MAX_IGNORES = 5; // After 5 ignores, stop sending

/**
 * Trigger detection thresholds
 */
const TRIGGER_THRESHOLDS = {
  LONG_ABSENCE_DAYS: 3,
  INCOMPLETE_INTERVIEW_HOURS: 24,
  SCORE_DECLINE_THRESHOLD: 10,
  TRIAL_ENDING_DAYS: [3, 1],
  JOBSEEKER_INACTIVE_HOURS: 24, // Active job seekers inactive for 24h
} as const;

/**
 * EngagementService
 *
 * Core service for smart user engagement. Analyzes user state,
 * detects trigger conditions, applies backoff algorithm,
 * generates personalized messages via AI, and sends via Telegram.
 */
@Injectable()
export class EngagementService implements OnModuleInit {
  private readonly logger = new Logger(EngagementService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationLogRepository: NotificationLogRepository,
    private readonly engagementAiService: EngagementAiService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => InterviewsService))
    private readonly interviewsService: InterviewsService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Try to initialize shared bot instance
   */
  async onModuleInit(): Promise<void> {
    this.getBotInstance();
  }

  /**
   * Helper to get bot instance lazily via shared TelegramService
   */
  private getBotInstance(): Bot | null {
    if (this.bot) return this.bot;
    try {
      const bot = this.telegramService.getBot();
      if (bot) {
        this.bot = bot;
        this.logger.log('EngagementService connected to shared Telegram bot');
      }
      return this.bot;
    } catch (error) {
      // TelegramService might not be ready yet or circular dependency issues
      return null;
    }
  }

  /**
   * Main entry point: Process a single user for potential notification
   */
  async processUserForEngagement(userId: string): Promise<NotificationResult | null> {
    const bot = this.getBotInstance();
    if (!bot) {
      this.logger.warn('Bot not initialized, skipping engagement processing');
      return null;
    }

    try {
      const user = await this.usersService.findById(userId);
      if (!user) {
        this.logger.warn(`User ${userId} not found`);
        return null;
      }

      if (!this.shouldSendNotification(user)) {
        return null;
      }

      const trigger = await this.detectTrigger(user);
      if (!trigger) {
        return null;
      }

      const context = await this.buildUserContext(user, trigger);
      const generated = await this.engagementAiService.generateMessage(trigger, context);

      // Skip if message content is empty (e.g., trial notifications handled by cron job)
      if (!generated.content || generated.content.trim() === '') {
        this.logger.debug(
          `Skipping empty engagement message for trigger=${trigger}, user=${userId}`,
        );
        return null;
      }

      return await this.sendNotification(user, trigger, generated.content, {
        aiGenerated: generated.model !== 'fallback-template',
        aiModel: generated.model,
        tokensUsed: generated.tokensUsed,
        consecutiveIgnoresAtSend: user.engagement?.consecutiveIgnores ?? 0,
        language: user.language || 'uz',
      });
    } catch (error) {
      this.logger.error(`Failed to process user ${userId}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if we should send a notification to this user
   */
  shouldSendNotification(user: UserDocument): boolean {
    const engagement = user.engagement;

    // No engagement data yet - user is eligible
    if (!engagement) {
      return true;
    }

    if (engagement.isBotBlocked) {
      return false;
    }

    if (engagement.notificationsPaused) {
      if (
        !engagement.notificationsPausedUntil ||
        new Date() < engagement.notificationsPausedUntil
      ) {
        return false;
      }
      // Pause expired, should resume
    }

    if (engagement.consecutiveIgnores >= MAX_IGNORES) {
      return false;
    }

    if (engagement.nextNotificationAt && new Date() < engagement.nextNotificationAt) {
      return false;
    }

    return true;
  }

  /**
   * Detect which trigger applies to this user
   */
  async detectTrigger(user: UserDocument): Promise<NotificationTrigger | null> {
    const now = new Date();
    const lastActiveAt = user.engagement?.lastActiveAt || user.createdAt;

    // Priority 1: Incomplete Interview (paused session > 24h)
    try {
      const pausedSession = await this.interviewsService.findPausedSessionForUser(user.id);
      if (pausedSession) {
        const sessionDoc = pausedSession as any;
        const sessionTime = new Date(sessionDoc.updatedAt || sessionDoc.createdAt || now);
        const hoursSincePaused = (now.getTime() - sessionTime.getTime()) / (1000 * 60 * 60);
        if (hoursSincePaused >= TRIGGER_THRESHOLDS.INCOMPLETE_INTERVIEW_HOURS) {
          return NotificationTrigger.INCOMPLETE_INTERVIEW;
        }
      }
    } catch (error) {
      this.logger.debug(`Error checking paused session: ${error.message}`);
    }

    // Priority 2: Trial ending soon
    if (user.subscription?.status === 'trialing' && user.subscription?.trialEndsAt) {
      const daysUntilTrialEnd = Math.ceil(
        (new Date(user.subscription.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if ((TRIGGER_THRESHOLDS.TRIAL_ENDING_DAYS as readonly number[]).includes(daysUntilTrialEnd)) {
        return NotificationTrigger.TRIAL_ENDING;
      }
    }

    // Priority 3: Long absence
    const daysSinceActive = Math.floor(
      (now.getTime() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceActive >= TRIGGER_THRESHOLDS.LONG_ABSENCE_DAYS) {
      return NotificationTrigger.LONG_ABSENCE;
    }

    // Priority 4: Score decline (check last 3 interviews)
    try {
      const recentScores = await this.getRecentScores(user.id, 3);
      if (recentScores.length >= 3) {
        // Check if scores are declining
        const isDecline = recentScores[0] < recentScores[1] && recentScores[1] < recentScores[2];
        const totalDecline = recentScores[2] - recentScores[0];
        if (isDecline && totalDecline >= TRIGGER_THRESHOLDS.SCORE_DECLINE_THRESHOLD) {
          return NotificationTrigger.SCORE_DECLINE;
        }
      }
    } catch (error) {
      this.logger.debug(`Error checking score decline: ${error.message}`);
    }

    // Priority 5: Job-seeker inactivity (active job seekers inactive 24h+)
    if (user.engagement?.jobSeekingStatus === JobSeekingStatus.ACTIVELY_LOOKING) {
      const hoursSinceActive =
        (now.getTime() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60);
      if (
        hoursSinceActive >= TRIGGER_THRESHOLDS.JOBSEEKER_INACTIVE_HOURS &&
        hoursSinceActive < 48
      ) {
        return NotificationTrigger.JOBSEEKER_INACTIVE;
      }
    }

    return null;
  }

  /**
   * Build user context for AI message generation
   */
  private async buildUserContext(
    user: UserDocument,
    trigger: NotificationTrigger,
  ): Promise<EngagementUserContext> {
    const now = new Date();
    const lastActiveAt = user.engagement?.lastActiveAt || user.createdAt;

    // Get interview stats with error handling
    let interviewStats: {
      averageScore: number;
      correctQuestions: string[];
      incorrectQuestions: string[];
      allQuestions: string[];
    } = { averageScore: 0, correctQuestions: [], incorrectQuestions: [], allQuestions: [] };
    try {
      interviewStats = await this.interviewsService.getUserInterviewContext(user.id, 5);
    } catch (error) {
      this.logger.debug(`Error getting interview context: ${error.message}`);
    }

    // Get paused session info
    let pausedSession: any = null;
    try {
      pausedSession = await this.interviewsService.findPausedSessionForUser(user.id);
    } catch (error) {
      this.logger.debug(`Error getting paused session: ${error.message}`);
    }

    const daysSinceActive = Math.floor(
      (now.getTime() - new Date(lastActiveAt).getTime()) / (1000 * 60 * 60 * 24),
    );

    // Calculate trial days remaining
    let trialDaysRemaining: number | undefined;
    if (user.subscription?.status === 'trialing' && user.subscription?.trialEndsAt) {
      trialDaysRemaining = Math.ceil(
        (new Date(user.subscription.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    // Get recent scores
    const recentScores = await this.getRecentScores(user.id, 3);

    // Get completed count
    const completedInterviews = await this.getCompletedInterviewCount(user.id);

    // Get technology info safely
    const pausedTechnology = pausedSession?.technology;
    const pausedInterviewTechnology = Array.isArray(pausedTechnology)
      ? pausedTechnology.join(', ')
      : pausedTechnology || undefined;

    return {
      firstName: user.firstName || user.telegramFirstName || 'Foydalanuvchi',
      language: user.language || 'uz',
      daysSinceActive,
      averageScore: Math.round((interviewStats.averageScore || 0) * 10), // 0-10 to 0-100
      hasPausedInterview: !!pausedSession,
      pausedInterviewTechnology,
      lastTechnology: Array.isArray(pausedTechnology) ? pausedTechnology[0] : pausedTechnology,
      completedInterviews,
      subscriptionPlan: user.subscription?.plan || 'free_trial',
      trialDaysRemaining,
      recentScores,
    };
  }

  /**
   * Send notification via Telegram and log it
   */
  async sendNotification(
    user: UserDocument,
    trigger: NotificationTrigger,
    content: string,
    metadata: CreateNotificationLogDto['metadata'],
  ): Promise<NotificationResult> {
    if (!this.bot) {
      return { success: false, error: 'Bot not initialized' };
    }

    // Create log entry first
    const log = await this.notificationLogRepository.create({
      userId: user.id,
      telegramId: user.telegramId,
      trigger,
      content,
      metadata,
    });

    try {
      await this.bot.api.sendMessage(user.telegramId, content, {
        parse_mode: 'HTML',
      });

      await this.updateUserAfterSend(user.id);

      this.logger.log(`Sent ${trigger} notification to user ${user.telegramId}`);

      return { success: true, logId: log.id };
    } catch (error) {
      return await this.handleSendError(error, log.id, user.id, user.telegramId);
    }
  }

  /**
   * Handle Telegram send errors with proper status updates
   */
  private async handleSendError(
    error: any,
    logId: string,
    userId: string,
    telegramId: number,
  ): Promise<NotificationResult> {
    const errorMessage = error.description || error.message || 'Unknown error';

    // Check for block errors
    if (
      errorMessage.includes('bot was blocked') ||
      errorMessage.includes('user is deactivated') ||
      errorMessage.includes('chat not found') ||
      errorMessage.includes('Forbidden')
    ) {
      await this.markUserBlocked(userId);
      const status = errorMessage.includes('deactivated')
        ? NotificationDeliveryStatus.DEACTIVATED
        : NotificationDeliveryStatus.BLOCKED;
      await this.notificationLogRepository.markFailed(logId, status, errorMessage);
      return { success: false, error: errorMessage, blocked: true };
    }

    // Generic failure
    await this.notificationLogRepository.markFailed(
      logId,
      NotificationDeliveryStatus.FAILED,
      errorMessage,
    );
    this.logger.error(`Failed to send notification to ${telegramId}: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }

  /**
   * Update user's engagement state after sending notification
   */
  /**
   * Update user's engagement state after sending notification
   * randomized to spread load across the day (09:00 - 21:00 Tashkent Time)
   */
  private async updateUserAfterSend(userId: string): Promise<void> {
    const now = new Date();
    const backoffDays = BACKOFF_DAYS[0]; // 1 day

    // Randomize next notification time to prevent spikes
    // Target window: Tomorrow 09:00 - 21:00 Tashkent Time
    // Tashkent is UTC+5, so UTC window is 04:00 - 16:00
    const nextNotificationAt = new Date(now.getTime() + backoffDays * 24 * 60 * 60 * 1000);

    // Use UTC to be server-timezone agnostic
    // 4 (04:00 UTC) + 0..11 hours = 04:00 .. 15:59 UTC
    const randomHourUtc = 4 + Math.floor(Math.random() * 12);
    const randomMinute = Math.floor(Math.random() * 60);

    nextNotificationAt.setUTCHours(randomHourUtc, randomMinute, 0, 0);

    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          'engagement.lastNotificationSentAt': now,
          'engagement.nextNotificationAt': nextNotificationAt,
        },
      },
    );
  }

  /**
   * Check if user responded to notification and reset backoff
   * Called from telegram-commands.service.ts on user interaction
   */
  async checkAndMarkNotificationResponse(userId: string): Promise<boolean> {
    try {
      const pendingNotification =
        await this.notificationLogRepository.findLastUnrespondedForUser(userId);

      if (!pendingNotification) {
        return false;
      }

      // Mark notification as responded
      await this.notificationLogRepository.markResponded(pendingNotification._id.toString());

      // Reset consecutive ignores and update activity
      await this.userModel.updateOne(
        { _id: new Types.ObjectId(userId) },
        {
          $set: {
            'engagement.consecutiveIgnores': 0,
            'engagement.lastNotificationRespondedAt': new Date(),
            'engagement.lastActiveAt': new Date(),
          },
        },
      );

      this.logger.debug(`User ${userId} responded to notification, reset backoff`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to check notification response: ${error.message}`);
      return false;
    }
  }

  /**
   * Process expired notifications and increment ignore counts
   * Called by scheduler after 24h window expires
   */
  async processExpiredNotifications(): Promise<{ processed: number; errors: number }> {
    const expired = await this.notificationLogRepository.findExpiredUnresponded();
    let processed = 0;
    let errors = 0;

    for (const notification of expired) {
      try {
        const userId = notification.userId.toString();

        // Mark this notification as PROCESSED (expired), but NOT responded
        // This ensures analytics are correct (user did not respond)
        await this.notificationLogRepository.markProcessed(notification._id.toString());

        const user = await this.usersService.findById(userId);
        if (!user) {
          processed++;
          continue;
        }

        const currentIgnores = (user.engagement?.consecutiveIgnores ?? 0) + 1;
        const backoffDays = BACKOFF_DAYS[Math.min(currentIgnores, BACKOFF_DAYS.length - 1)] || 14;
        const nextNotificationAt = new Date(Date.now() + backoffDays * 24 * 60 * 60 * 1000);

        await this.userModel.updateOne(
          { _id: new Types.ObjectId(userId) },
          {
            $set: {
              'engagement.consecutiveIgnores': currentIgnores,
              'engagement.nextNotificationAt': nextNotificationAt,
            },
          },
        );

        this.logger.debug(
          `User ${userId} ignored, ignores=${currentIgnores}, next in ${backoffDays} days`,
        );
        processed++;
      } catch (error) {
        this.logger.error(`Failed to process expired notification: ${error.message}`);
        errors++;
      }
    }

    if (processed > 0) {
      this.logger.log(`Processed ${processed} expired notifications, ${errors} errors`);
    }

    return { processed, errors };
  }

  /**
   * Mark user as blocked
   */
  private async markUserBlocked(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          'engagement.isBotBlocked': true,
          'engagement.botBlockedAt': new Date(),
        },
      },
    );
    this.logger.warn(`Marked user ${userId} as blocked`);
  }

  /**
   * Pause notifications for a user
   */
  async pauseNotifications(userId: string, until?: Date): Promise<void> {
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          'engagement.notificationsPaused': true,
          'engagement.notificationsPausedUntil': until || null,
        },
      },
    );
    this.logger.log(`Paused notifications for user ${userId}`);
  }

  /**
   * Resume notifications for a user
   */
  async resumeNotifications(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          'engagement.notificationsPaused': false,
          'engagement.notificationsPausedUntil': null,
          'engagement.isBotBlocked': false,
          'engagement.botBlockedAt': null, // Clear blocked timestamp for consistency
        },
      },
    );
    this.logger.log(`Resumed notifications for user ${userId}`);
  }

  /**
   * Update last active timestamp
   */
  async updateLastActive(userId: string): Promise<void> {
    try {
      await this.userModel.updateOne(
        { _id: new Types.ObjectId(userId) },
        {
          $set: {
            'engagement.lastActiveAt': new Date(),
            'engagement.isBotBlocked': false,
            'engagement.botBlockedAt': null,
          },
        },
      );
    } catch (error) {
      // Don't throw - this is a non-critical operation
      this.logger.debug(`Failed to update lastActiveAt for ${userId}: ${error.message}`);
    }
  }

  /**
   * Get recent interview scores for trend analysis
   */
  private async getRecentScores(userId: string, limit: number): Promise<number[]> {
    try {
      // Get recent sessions with their scores
      const sessions = await this.interviewsService.getHistory(userId, limit, 0);

      // Extract scores from completed sessions (convert 0-10 to 0-100)
      const scores = sessions
        .filter((s: any) => s.status === 'completed' && typeof s.overallScore === 'number')
        .map((s: any) => Math.round((s.overallScore || 0) * 10))
        .slice(0, limit);

      return scores;
    } catch (error) {
      this.logger.debug(`Error getting recent scores: ${error.message}`);
      return [];
    }
  }

  /**
   * Get completed interview count for a user
   */
  private async getCompletedInterviewCount(userId: string): Promise<number> {
    try {
      const stats = await this.interviewsService.getStats(userId);
      return stats?.totalInterviews ?? 0;
    } catch (error) {
      this.logger.debug(`Error getting interview count: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get users eligible for notifications (for scheduler)
   */
  async getEligibleUsers(limit = 100): Promise<string[]> {
    const now = new Date();
    // Use Tashkent midnight so the "sent today" guard aligns with user-facing
    // day boundaries, not the server's local timezone.
    const startOfToday = getTashkentMidnight(now);

    try {
      const users = await this.userModel
        .find({
          // Exclude blocked users
          $or: [
            { 'engagement.isBotBlocked': { $exists: false } },
            { 'engagement.isBotBlocked': false },
          ],
          // Exclude paused users
          $and: [
            {
              $or: [
                { 'engagement.notificationsPaused': { $exists: false } },
                { 'engagement.notificationsPaused': false },
                { 'engagement.notificationsPausedUntil': { $lte: now } },
              ],
            },
            // STRICT CHECK: Ensure not sent today (Double safety)
            {
              $or: [
                { 'engagement.lastNotificationSentAt': { $exists: false } },
                { 'engagement.lastNotificationSentAt': { $lt: startOfToday } },
              ],
            },
            // Exclude users who hit max ignores
            {
              $or: [
                { 'engagement.consecutiveIgnores': { $exists: false } },
                { 'engagement.consecutiveIgnores': { $lt: MAX_IGNORES } },
              ],
            },
            // Only users due for notification
            {
              $or: [
                { 'engagement.nextNotificationAt': { $exists: false } },
                { 'engagement.nextNotificationAt': null },
                { 'engagement.nextNotificationAt': { $lte: now } },
              ],
            },
          ],
        })
        .select('_id')
        .limit(limit)
        .lean();

      return users.map((u) => u._id.toString());
    } catch (error) {
      this.logger.error(`Failed to get eligible users: ${error.message}`);
      return [];
    }
  }
}
