import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import {
  UserStreak,
  UserStreakDocument,
  STREAK_MILESTONES,
  type StreakState,
} from './schemas/user-streak.schema';
import { getTashkentMidnight } from '../../common/utils/tashkent-time';
import { APP_EVENTS } from '../../common/constants/events.constants';
import {
  canUseStreakFreeze,
  getStreakFreezeLimit,
} from '../../common/constants/plan-limits.constant';

/**
 * StreakService — core streak engine
 *
 * Responsibilities:
 * - Record daily activity (from daily tasks or IRS tests)
 * - State machine transitions
 * - Streak freeze logic
 * - Milestone detection
 * - Event emission for downstream consumers (leaderboard, badges, notifications)
 *
 * Listens to:
 * - daily.tasks.all_completed → recordActivity
 * - irs.test.completed → recordActivity (free users only)
 *
 * Emits:
 * - streak.updated → { userId, currentStreak, isNewMilestone }
 * - streak.broken → { userId, lostStreak, reason }
 * - streak.milestone → { userId, milestoneDay, currentStreak }
 */
@Injectable()
export class StreakService implements OnModuleInit {
  private readonly logger = new Logger(StreakService.name);

  constructor(
    @InjectModel(UserStreak.name)
    private streakModel: Model<UserStreakDocument>,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
    @InjectRedis() private redis: Redis,
  ) {}

  async onModuleInit() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) {
      this.logger.warn('Streak feature is DISABLED');
      return;
    }
    this.logger.log('StreakService initialized');
  }

  // ─── Event Listeners ────────────────────────────────────────

  /**
   * When ALL daily tasks are completed → record streak activity
   */
  // FIX P2-M2: Wrap @OnEvent handler in try/catch to prevent event pipeline crash
  @OnEvent(APP_EVENTS.DAILY_TASKS_ALL_COMPLETED)
  async onDailyTasksCompleted(payload: {
    userId: string;
    telegramId: number;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>('features.streakEnabled');
      if (!isEnabled) return;

      this.logger.debug(
        `Daily tasks completed for user ${payload.userId}, recording activity`,
      );

      await this.recordActivity(
        payload.userId,
        payload.telegramId,
        'daily_task',
      );
    } catch (error: any) {
      this.logger.error(`[onDailyTasksCompleted] Error: ${error.message}`, error.stack);
    }
  }

  /**
   * When IRS test is completed → record activity for free users
   * (Premium users get streak from daily tasks instead)
   */
  // FIX P2-M2: Wrap @OnEvent handler in try/catch
  @OnEvent(APP_EVENTS.IRS_TEST_COMPLETED)
  async onIrsTestCompleted(payload: {
    userId: string | null;
    telegramId: number;
    score: number;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>('features.streakEnabled');
      if (!isEnabled) return;

      // Only count for registered users
      if (!payload.userId) return;

      // Check if user already has daily task activity today
      // (don't double-count if they also completed daily tasks)
      const streak = await this.getOrCreateStreak(payload.userId);
      const todayStart = getTashkentMidnight();

      if (
        streak.lastActivityDate &&
        streak.lastActivityDate >= todayStart &&
        streak.lastActivityType === 'daily_task'
      ) {
        // Already recorded via daily task today — skip
        return;
      }

      this.logger.debug(
        `IRS test completed for user ${payload.userId}, recording activity`,
      );

      await this.recordActivity(
        payload.userId,
        payload.telegramId,
        'irs_test',
      );
    } catch (error: any) {
      this.logger.error(`[onIrsTestCompleted] Error: ${error.message}`, error.stack);
    }
  }

  // ─── Core: Record Activity ─────────────────────────────────

  /**
   * Record a daily activity for streak tracking.
   *
   * Logic:
   * 1. Get or create UserStreak document
   * 2. Check if already recorded today → no-op
   * 3. Determine if streak continues (yesterday) or starts fresh
   * 4. Increment streak, update longestStreak
   * 5. Check milestones
   * 6. Emit events
   */
  /**
   * FIX P2-C2: Use atomic findOneAndUpdate with lastActivityDate < todayStart as filter
   * to prevent double-increment of totalActiveDays from concurrent events.
   * Only one concurrent call will match the filter and win the update.
   */
  async recordActivity(
    userId: string,
    telegramId: number,
    activityType: 'daily_task' | 'irs_test',
  ): Promise<UserStreakDocument> {
    const streak = await this.getOrCreateStreak(userId, telegramId);
    const todayStart = getTashkentMidnight();

    // Already recorded today?
    if (streak.lastActivityDate && streak.lastActivityDate >= todayStart) {
      this.logger.debug(
        `Activity already recorded today for user ${userId}`,
      );
      return streak;
    }

    // Determine if this continues an existing streak
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const wasActiveYesterday =
      streak.lastActivityDate &&
      streak.lastActivityDate >= yesterdayStart &&
      streak.lastActivityDate < todayStart;
    const wasFrozen = streak.state === 'frozen';

    let newStreak: number;

    if (wasActiveYesterday || wasFrozen) {
      // Streak continues
      newStreak = streak.currentStreak + 1;
    } else if (streak.state === 'inactive' || streak.state === 'broken' || !streak.lastActivityDate) {
      // New streak
      newStreak = 1;
    } else {
      // Gap > 1 day without freeze → new streak
      newStreak = 1;
    }

    const newLongest = Math.max(streak.longestStreak, newStreak);
    const isNewStreak = newStreak === 1 && streak.currentStreak === 0;

    // FIX P2-C2: Atomic update with filter that ensures lastActivityDate < todayStart.
    // This prevents two concurrent calls from both incrementing totalActiveDays.
    // Only the first call to match this filter wins; the second sees lastActivityDate = todayStart
    // and fails to match, returning null.
    const updated = await this.streakModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        $or: [
          { lastActivityDate: { $lt: todayStart } },
          { lastActivityDate: { $exists: false } },
          { lastActivityDate: null },
        ],
      },
      {
        $set: {
          currentStreak: newStreak,
          longestStreak: newLongest,
          state: 'active' as StreakState,
          lastActivityDate: todayStart,
          lastActivityType: activityType,
          telegramId,
        },
        $inc: {
          totalActiveDays: 1,
          ...(isNewStreak ? { totalStreaksStarted: 1 } : {}),
        },
      },
      { new: true },
    );

    if (!updated) {
      // Another concurrent call already recorded today's activity — fetch fresh
      this.logger.debug(
        `Concurrent streak update detected for user ${userId}, returning current state`,
      );
      return await this.getOrCreateStreak(userId, telegramId);
    }

    // Check milestones
    const newMilestone = await this.checkMilestones(updated);

    // Emit streak updated event
    this.eventEmitter.emit(APP_EVENTS.STREAK_UPDATED, {
      userId,
      telegramId,
      currentStreak: newStreak,
      isNewMilestone: !!newMilestone,
      milestoneDay: newMilestone || undefined,
      activityType,
    });

    this.logger.log(
      `Streak updated: user=${userId}, streak=${newStreak}, longest=${newLongest}` +
        (newMilestone ? `, milestone=${newMilestone}!` : ''),
    );

    return updated;
  }

  // ─── Midnight Check (called by StreakCronService) ──────────

  /**
   * Check all active/at_risk/frozen streaks at midnight.
   * For users who missed yesterday:
   * - If freeze available → use freeze
   * - Otherwise → break streak
   *
   * Returns counts for logging.
   */
  async performMidnightCheck(): Promise<{
    checked: number;
    frozen: number;
    broken: number;
    safe: number;
  }> {
    const todayStart = getTashkentMidnight();
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    // Find users with active streaks who did NOT complete yesterday
    const atRiskUsers = await this.streakModel
      .find({
        state: { $in: ['active', 'at_risk', 'frozen'] },
        currentStreak: { $gt: 0 },
        $or: [
          { lastActivityDate: { $lt: yesterdayStart } }, // Missed yesterday entirely
          { lastActivityDate: { $exists: false } },
        ],
      })
      .lean();

    let frozen = 0;
    let broken = 0;
    let safe = 0;

    for (const streak of atRiskUsers) {
      const userId = streak.userId.toString();

      // Try to use freeze
      const frozeSuccessfully = await this.tryFreeze(userId, streak);

      if (frozeSuccessfully) {
        frozen++;
      } else {
        // Break the streak
        await this.breakStreak(userId, streak.currentStreak);
        broken++;
      }
    }

    // Users who were active yesterday are safe
    const safeCount = await this.streakModel.countDocuments({
      state: { $in: ['active'] },
      currentStreak: { $gt: 0 },
      lastActivityDate: { $gte: yesterdayStart },
    });
    safe = safeCount;

    this.logger.log(
      `Midnight streak check: checked=${atRiskUsers.length}, frozen=${frozen}, broken=${broken}, safe=${safe}`,
    );

    return {
      checked: atRiskUsers.length,
      frozen,
      broken,
      safe,
    };
  }

  /**
   * Mark users as "at_risk" at 18:00 if they haven't completed today
   * Used for notification targeting.
   */
  async markAtRiskUsers(): Promise<number> {
    const todayStart = getTashkentMidnight();

    const result = await this.streakModel.updateMany(
      {
        state: 'active',
        currentStreak: { $gt: 0 },
        $or: [
          { lastActivityDate: { $lt: todayStart } },
          { lastActivityDate: { $exists: false } },
        ],
      },
      { $set: { state: 'at_risk' as StreakState } },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Marked ${result.modifiedCount} users as at_risk for today`,
      );
    }

    return result.modifiedCount;
  }

  // ─── Freeze Logic ─────────────────────────────────────────

  /**
   * Try to use a streak freeze for the user.
   * Returns true if freeze was used, false if not available.
   *
   * FIX SLB-3: Use atomic $inc with filter { freezesRemaining: { $gt: 0 } }
   * to prevent race condition where concurrent execution reads stale freezesRemaining
   * and both try to decrement it.
   */
  private async tryFreeze(
    userId: string,
    streak: any,
  ): Promise<boolean> {
    // Check if user's plan supports freeze
    const userPlan = await this.getUserPlan(userId);
    if (!canUseStreakFreeze(userPlan)) return false;

    // Ensure monthly freeze counter is current
    const currentMonth = this.getCurrentMonthKey();

    if (streak.freezeResetMonth !== currentMonth) {
      // New month — reset freeze counter atomically first
      const planFreezeLimit = getStreakFreezeLimit(userPlan);
      await this.streakModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          $or: [
            { freezeResetMonth: { $ne: currentMonth } },
            { freezeResetMonth: { $exists: false } },
          ],
        },
        {
          $set: {
            freezesRemaining: planFreezeLimit,
            freezesUsedThisMonth: 0,
            freezeResetMonth: currentMonth,
          },
        },
      );
    }

    // FIX SLB-3: Atomic freeze — use $inc: -1 with filter that ensures freezesRemaining > 0
    // Also enforce per-plan cap at usage time (FIX SLB-10)
    const planFreezeLimit = getStreakFreezeLimit(userPlan);
    const now = new Date();
    const result = await this.streakModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        freezesRemaining: { $gt: 0 },
        freezeResetMonth: currentMonth,
      },
      {
        $set: {
          state: 'frozen' as StreakState,
        },
        $inc: {
          freezesRemaining: -1,
          freezesUsedThisMonth: 1,
        },
        $push: { freezeUsedDates: now },
      },
      { new: true },
    );

    if (!result) {
      // No freeze available (either 0 remaining or month mismatch)
      return false;
    }

    // FIX SLB-10: Enforce per-plan cap — if freezesUsedThisMonth exceeded plan limit, rollback
    if (result.freezesUsedThisMonth > planFreezeLimit) {
      // Rollback — this shouldn't normally happen but is a safety check
      await this.streakModel.updateOne(
        { userId: new Types.ObjectId(userId) },
        {
          $inc: { freezesRemaining: 1, freezesUsedThisMonth: -1 },
          $pop: { freezeUsedDates: 1 },
        },
      );
      return false;
    }

    this.logger.log(
      `Streak freeze used for user ${userId}. Remaining: ${result.freezesRemaining}`,
    );

    return true;
  }

  // ─── Break Streak ──────────────────────────────────────────

  /**
   * Break a user's streak.
   */
  private async breakStreak(
    userId: string,
    lostStreak: number,
  ): Promise<void> {
    await this.streakModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          currentStreak: 0,
          state: 'broken' as StreakState,
        },
        $inc: { totalStreaksBroken: 1 },
      },
    );

    // Emit streak broken event
    this.eventEmitter.emit(APP_EVENTS.STREAK_BROKEN, {
      userId,
      lostStreak,
      reason: 'missed_day' as const,
    });

    this.logger.log(
      `Streak broken for user ${userId}. Lost: ${lostStreak} days`,
    );
  }

  // ─── Milestones ────────────────────────────────────────────

  /**
   * Check if the user has reached a new streak milestone.
   * Returns the HIGHEST new milestone day if any, null otherwise.
   *
   * FIX SLB-1: Don't return on first eligible milestone — check ALL eligible milestones.
   * When a user jumps multiple days (e.g., streak goes from 0 to 7 via migration),
   * the old code returned after awarding the 3-day milestone, skipping 5 and 7.
   */
  private async checkMilestones(
    streak: UserStreakDocument,
  ): Promise<number | null> {
    const currentStreak = streak.currentStreak;
    const existingMilestones = new Set(
      streak.milestones.map((m) => m.days),
    );

    let highestNewMilestone: number | null = null;

    for (const milestone of STREAK_MILESTONES) {
      if (
        currentStreak >= milestone &&
        !existingMilestones.has(milestone)
      ) {
        // New milestone achieved!
        await this.streakModel.updateOne(
          { _id: streak._id },
          {
            $push: {
              milestones: {
                days: milestone,
                achievedAt: new Date(),
                rewardClaimed: false,
              },
            },
          },
        );

        // Emit milestone event
        this.eventEmitter.emit(APP_EVENTS.STREAK_MILESTONE, {
          userId: streak.userId.toString(),
          milestoneDay: milestone,
          currentStreak,
        });

        this.logger.log(
          `Milestone reached! User ${streak.userId}: ${milestone}-day streak`,
        );

        highestNewMilestone = milestone;
        // FIX SLB-1: Continue checking remaining milestones instead of returning
      }
    }

    return highestNewMilestone;
  }

  // ─── Monthly Freeze Reset ──────────────────────────────────

  /**
   * Reset freeze counters for all users at the start of each month.
   * Called by StreakCronService on the 1st of each month.
   */
  /**
   * FIX P2-H7: Also reset freezesRemaining to the default for each user's plan.
   * Since we can't efficiently look up each user's plan in a bulk update,
   * we set freezesRemaining to the max (Elite: 3) and let tryFreeze enforce
   * the actual plan-specific limit at usage time.
   */
  async resetMonthlyFreezes(): Promise<number> {
    const currentMonth = this.getCurrentMonthKey();

    // Reset for users whose freeze month is not current
    const maxFreezes = getStreakFreezeLimit('elite'); // Use max tier's limit as default
    const result = await this.streakModel.updateMany(
      {
        $or: [
          { freezeResetMonth: { $ne: currentMonth } },
          { freezeResetMonth: { $exists: false } },
        ],
      },
      {
        $set: {
          freezesUsedThisMonth: 0,
          freezeResetMonth: currentMonth,
          freezesRemaining: maxFreezes,
        },
      },
    );

    this.logger.log(
      `Monthly freeze reset: ${result.modifiedCount} users updated for ${currentMonth} (freezes=${maxFreezes})`,
    );

    return result.modifiedCount;
  }

  // ─── Public Query Methods ──────────────────────────────────

  /**
   * Get or create a UserStreak document for a user.
   */
  /**
   * FIX P2-M7: Use findOneAndUpdate with upsert to prevent E11000 race condition.
   * Two concurrent calls to create() would both fail the uniqueness constraint.
   */
  async getOrCreateStreak(
    userId: string,
    telegramId?: number,
  ): Promise<UserStreakDocument> {
    // Build the upsert operation — telegramId goes in $set to backfill on existing docs,
    // and also in $setOnInsert for new docs (no conflict since $set won't have it in $setOnInsert)
    const setOnInsert: any = {
      userId: new Types.ObjectId(userId),
      currentStreak: 0,
      longestStreak: 0,
      state: 'inactive' as StreakState,
      totalActiveDays: 0,
      totalStreaksStarted: 0,
      totalStreaksBroken: 0,
      freezesRemaining: 0,
      freezesUsedThisMonth: 0,
      milestones: [],
      badges: [],
    };

    const update: any = { $setOnInsert: setOnInsert };

    // Backfill telegramId on both new and existing docs
    if (telegramId) {
      update.$set = { telegramId };
    }

    const streak = await this.streakModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      update,
      { upsert: true, new: true },
    );

    return streak as UserStreakDocument;
  }

  /**
   * Get streak info for a user (for display).
   */
  async getStreakInfo(userId: string): Promise<{
    currentStreak: number;
    longestStreak: number;
    state: StreakState;
    totalActiveDays: number;
    freezesRemaining: number;
    milestones: Array<{ days: number; achievedAt: Date; rewardClaimed: boolean }>;
    badges: string[];
  }> {
    const streak = await this.getOrCreateStreak(userId);
    return {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      state: streak.state,
      totalActiveDays: streak.totalActiveDays,
      freezesRemaining: streak.freezesRemaining,
      milestones: streak.milestones,
      badges: streak.badges,
    };
  }

  /**
   * Get users with active streaks (for notifications).
   */
  async getActiveStreakUsers(): Promise<UserStreakDocument[]> {
    return this.streakModel
      .find({
        state: { $in: ['active', 'at_risk'] },
        currentStreak: { $gt: 0 },
      })
      .lean() as any;
  }

  /**
   * Get users who haven't completed today's activity (for at_risk notifications).
   */
  async getUsersAtRisk(): Promise<UserStreakDocument[]> {
    return this.streakModel
      .find({ state: 'at_risk', currentStreak: { $gt: 0 } })
      .lean() as any;
  }

  /**
   * Get users with specific streak threshold (for notifications).
   */
  async getUsersWithStreakAbove(minStreak: number): Promise<UserStreakDocument[]> {
    return this.streakModel
      .find({
        state: { $in: ['active', 'at_risk'] },
        currentStreak: { $gte: minStreak },
      })
      .lean() as any;
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Get user's subscription plan.
   * Uses Redis cache to avoid hitting User collection on every check.
   */
  private async getUserPlan(userId: string): Promise<string> {
    const cacheKey = `user:plan:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    // Fallback: we don't import UsersService to avoid circular deps
    // The plan is cached when daily tasks are delivered
    // If cache miss, assume free_trial (safe default — no freeze)
    return 'free_trial';
  }

  /**
   * Cache a user's plan (called externally when plan is known).
   */
  async cacheUserPlan(userId: string, plan: string): Promise<void> {
    await this.redis.setex(`user:plan:${userId}`, 86400, plan);
  }

  /**
   * FIX P2-H1: Use Tashkent time (UTC+5) instead of server timezone for month key.
   */
  private getCurrentMonthKey(): string {
    const now = new Date();
    const tashkentMs = now.getTime() + 5 * 60 * 60 * 1000;
    const tashkent = new Date(tashkentMs);
    const year = tashkent.getUTCFullYear();
    const month = String(tashkent.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
}
