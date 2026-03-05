import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import {
  LeaderboardEntry,
  LeaderboardEntryDocument,
  LeaderboardPeriod,
} from './schemas/leaderboard-entry.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { APP_EVENTS } from '../../common/constants/events.constants';
import { canParticipateInLeaderboard } from '../../common/constants/plan-limits.constant';
import { getTashkentMidnight } from '../../common/utils/tashkent-time';

/**
 * LeaderboardService — point awarding, daily cap enforcement, ranking
 *
 * Listens to:
 *   - daily.task.completed     → +10 points (max 3/day = 30), +5 if score>=8, +10 if perfect 10
 *   - daily.tasks.all_completed → (no-op, points already awarded per task)
 *   - streak.updated           → +2 streak continuation
 *   - mock.completed           → +25 per mock
 *   - irs.test.completed       → +5 (max 1/week)
 *   - referral.confirmed       → +15 (max 10/month)
 *
 * Cron:
 *   - Every 15 min: recalculate ranks
 *   - Monday 00:05: archive previous weekly period
 *   - 1st 00:05: archive previous monthly period
 *
 * Anti-gaming:
 *   - Daily point cap: 35 (from env LB_DAILY_POINT_CAP)
 *   - Referral points only after referred user completes first task
 */
@Injectable()
export class LeaderboardService implements OnModuleInit {
  private readonly logger = new Logger(LeaderboardService.name);
  private dailyPointCap: number;

  constructor(
    @InjectModel(LeaderboardEntry.name)
    private lbModel: Model<LeaderboardEntryDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
    @InjectRedis() private redis: Redis,
  ) {
    this.dailyPointCap = this.configService.get<number>(
      'features.leaderboard.dailyPointCap',
      35,
    );
  }

  async onModuleInit() {
    const isEnabled = this.configService.get<boolean>(
      'features.leaderboardEnabled',
    );
    if (!isEnabled) {
      this.logger.warn('Leaderboard feature is DISABLED');
      return;
    }
    this.logger.log(
      `LeaderboardService initialized (daily cap: ${this.dailyPointCap})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT LISTENERS — Point Awarding
  // ═══════════════════════════════════════════════════════════════

  /**
   * +10 per daily task completed (max 3 tasks/day = 30 points)
   * +5 bonus if score >= 8 (task quality)
   * +10 bonus if perfect score (10/10), max 1/day
   */
  // FIX P2-M4: All @OnEvent handlers wrapped in try/catch to prevent event pipeline crash

  @OnEvent(APP_EVENTS.DAILY_TASK_COMPLETED)
  async onDailyTaskCompleted(payload: {
    userId: string;
    taskId: string;
    taskIndex: number;
    score: number;
    taskType: string;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>(
        'features.leaderboardEnabled',
      );
      if (!isEnabled) return;

      const userPlan = await this.getUserPlan(payload.userId);
      if (!canParticipateInLeaderboard(userPlan)) return;

      // +10 for task completion
      await this.awardPoints(payload.userId, 10, 'dailyTasks');

      // FIX SLB-6: Always normalize to 0-10 scale. The old heuristic (<= 10 means already 0-10)
      // misclassified low scores on 0-100 scale. E.g., score of 5/100 was treated as 5/10 (perfect).
      // Daily task scores are ALWAYS 0-10, so no normalization needed here.
      // Mock interview scores are 0-100. We normalize consistently:
      const normalizedScore = payload.score > 10 ? payload.score / 10 : payload.score;
      if (normalizedScore >= 8) {
        await this.awardPoints(payload.userId, 5, 'taskQuality');
      }

      // +10 for perfect score (10/10), max once per day
      if (normalizedScore >= 10) {
        const perfectKey = `lb:perfect:${payload.userId}:${this.getTodayKey()}`;
        const alreadyPerfect = await this.redis.get(perfectKey);
        if (!alreadyPerfect) {
          await this.awardPoints(payload.userId, 10, 'bonus');
          await this.redis.setex(perfectKey, 86400, '1');
        }
      }
    } catch (error: any) {
      this.logger.error(`[onDailyTaskCompleted] Error: ${error.message}`, error.stack);
    }
  }

  /**
   * +2 for streak continuation (each day streak continues)
   */
  @OnEvent(APP_EVENTS.STREAK_UPDATED)
  async onStreakUpdated(payload: {
    userId: string;
    currentStreak: number;
    isNewMilestone: boolean;
    activityType: string;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>(
        'features.leaderboardEnabled',
      );
      if (!isEnabled) return;

      const userPlan = await this.getUserPlan(payload.userId);
      if (!canParticipateInLeaderboard(userPlan)) return;

      // +2 for streak continuation
      await this.awardPoints(payload.userId, 2, 'streak');

      // Update streak on leaderboard entry for tiebreaking
      await this.updateStreakOnEntries(
        payload.userId,
        payload.currentStreak,
      );
    } catch (error: any) {
      this.logger.error(`[onStreakUpdated] Error: ${error.message}`, error.stack);
    }
  }

  /**
   * +25 for completing a mock interview
   */
  @OnEvent(APP_EVENTS.MOCK_COMPLETED)
  async onMockCompleted(payload: {
    userId: string;
    sessionId: string;
    score: number;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>(
        'features.leaderboardEnabled',
      );
      if (!isEnabled) return;

      const userPlan = await this.getUserPlan(payload.userId);
      if (!canParticipateInLeaderboard(userPlan)) return;

      await this.awardPoints(payload.userId, 25, 'mockInterview');
    } catch (error: any) {
      this.logger.error(`[onMockCompleted] Error: ${error.message}`, error.stack);
    }
  }

  /**
   * +5 for IRS test completion (max 1/week)
   */
  @OnEvent(APP_EVENTS.IRS_TEST_COMPLETED)
  async onIrsCompleted(payload: {
    userId?: string;
    telegramId: number;
    score: number;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>(
        'features.leaderboardEnabled',
      );
      if (!isEnabled) return;
      if (!payload.userId) return;

      const userPlan = await this.getUserPlan(payload.userId);
      if (!canParticipateInLeaderboard(userPlan)) return;

      // Max 1 IRS per week
      const weekKey = `lb:irs:${payload.userId}:${this.getWeekKey()}`;
      const alreadyThisWeek = await this.redis.get(weekKey);
      if (alreadyThisWeek) return;

      await this.awardPoints(payload.userId, 5, 'irs');
      await this.redis.setex(weekKey, 7 * 86400, '1');
    } catch (error: any) {
      this.logger.error(`[onIrsCompleted] Error: ${error.message}`, error.stack);
    }
  }

  /**
   * +15 for confirmed referral (max 10/month)
   */
  @OnEvent(APP_EVENTS.REFERRAL_CONFIRMED)
  async onReferralConfirmed(payload: {
    referrerId: string;
    referredUserId: string;
  }) {
    try {
      const isEnabled = this.configService.get<boolean>(
        'features.leaderboardEnabled',
      );
      if (!isEnabled) return;

      const userPlan = await this.getUserPlan(payload.referrerId);
      if (!canParticipateInLeaderboard(userPlan)) return;

      // Max 10 referrals per month
      const monthKey = `lb:ref:${payload.referrerId}:${this.getMonthKey()}`;
      const count = await this.redis.get(monthKey);
      if (count && parseInt(count, 10) >= 10) return;

      await this.awardPoints(payload.referrerId, 15, 'referral');

      const pipe = this.redis.pipeline();
      pipe.incr(monthKey);
      pipe.expire(monthKey, 32 * 86400);
      await pipe.exec();
    } catch (error: any) {
      this.logger.error(`[onReferralConfirmed] Error: ${error.message}`, error.stack);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE: Award Points
  // ═══════════════════════════════════════════════════════════════

  /**
   * Award points to a user across all active periods.
   * FIX P2-C1 + P2-C3: Enforces daily cap atomically using a global Redis counter
   * per user per day, instead of per-period-entry read-then-write.
   */
  private async awardPoints(
    userId: string,
    points: number,
    category: keyof InstanceType<typeof import('./schemas/leaderboard-entry.schema').PointBreakdown>,
  ): Promise<void> {
    const todayKey = this.getTodayKey();
    const userPosition = await this.getUserPosition(userId);
    const periods = this.getActivePeriods();

    // FIX P2-C1 + P2-C3: Atomic daily cap check via Redis.
    // Single global key per user per day — shared across all periods.
    const dailyCapKey = `lb:dailycap:${userId}:${todayKey}`;
    const luaScript = `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      local cap = tonumber(ARGV[1])
      local requested = tonumber(ARGV[2])
      if current >= cap then
        return 0
      end
      local allowed = math.min(requested, cap - current)
      redis.call('INCRBY', KEYS[1], allowed)
      local ttl = redis.call('TTL', KEYS[1])
      if ttl == -1 or ttl == -2 then
        redis.call('EXPIRE', KEYS[1], 90000)
      end
      return allowed
    `;

    const actualPoints = (await this.redis.eval(
      luaScript,
      1,
      dailyCapKey,
      this.dailyPointCap,
      points,
    )) as number;

    if (actualPoints <= 0) return;

    for (const { period, periodKey } of periods) {
      try {
        // Ensure entry exists
        await this.getOrCreateEntry(userId, period, periodKey, userPosition);

        // Award points atomically per-entry
        await this.lbModel.updateOne(
          {
            userId: new Types.ObjectId(userId),
            period,
            periodKey,
          },
          {
            $inc: {
              points: actualPoints,
              [`breakdown.${category}`]: actualPoints,
            },
            $set: {
              lastPointsAt: new Date(),
            },
          },
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to award ${actualPoints} points to user ${userId} for ${period}/${periodKey}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Update streak count on all active entries for tiebreaking.
   */
  private async updateStreakOnEntries(
    userId: string,
    currentStreak: number,
  ): Promise<void> {
    const periods = this.getActivePeriods();
    for (const { period, periodKey } of periods) {
      await this.lbModel
        .updateOne(
          {
            userId: new Types.ObjectId(userId),
            period,
            periodKey,
          },
          { $set: { currentStreak } },
        )
        .catch(() => {}); // Non-critical
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CRON: Rank Recalculation (every 15 min)
  // ═══════════════════════════════════════════════════════════════

  @Cron('*/15 * * * *', {
    name: 'leaderboard_recalculate',
    timeZone: 'Asia/Tashkent',
  })
  async recalculateRanks() {
    const isEnabled = this.configService.get<boolean>(
      'features.leaderboardEnabled',
    );
    if (!isEnabled) return;

    const lockKey = 'cron:lb:recalculate';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!acquired) return;

    try {
      const periods = this.getActivePeriods();

      for (const { period, periodKey } of periods) {
        await this.recalculateForPeriod(period, periodKey);
      }
    } catch (error: any) {
      this.logger.error(`Rank recalculation failed: ${error.message}`);
    }
    // FIX SLB-18: Don't delete lock in finally — let it expire via EX 300.
    // Deleting immediately allows duplicate execution on multi-pod deployments.
  }

  /**
   * Recalculate ranks for a specific period.
   * Sort by: points DESC, currentStreak DESC, lastPointsAt ASC (earliest first).
   */
  private async recalculateForPeriod(
    period: LeaderboardPeriod,
    periodKey: string,
  ): Promise<void> {
    // Get all distinct positions in this period
    const positions = await this.lbModel.distinct('position', {
      period,
      periodKey,
    });

    for (const position of positions) {
      const entries = await this.lbModel
        .find({
          period,
          periodKey,
          position,
          points: { $gt: 0 },
        })
        .sort({ points: -1, currentStreak: -1, lastPointsAt: 1 })
        .select('_id')
        .lean();

      // Batch update ranks
      const bulkOps = entries.map((entry, index) => ({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { rank: index + 1 } },
        },
      }));

      if (bulkOps.length > 0) {
        await this.lbModel.bulkWrite(bulkOps);
      }
    }

    // Emit recalculated event
    const topUsers = await this.getTopN(period, periodKey, undefined, 10);
    this.eventEmitter.emit(APP_EVENTS.LEADERBOARD_RECALCULATED, {
      period,
      periodKey,
      topUsers: topUsers.map((u) => ({
        userId: u.userId.toString(),
        rank: u.rank,
        points: u.points,
      })),
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC QUERY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get top N users for a period, optionally filtered by position.
   */
  async getTopN(
    period: LeaderboardPeriod,
    periodKey: string,
    position?: string,
    limit = 10,
  ): Promise<LeaderboardEntryDocument[]> {
    const query: any = { period, periodKey, points: { $gt: 0 } };
    if (position) query.position = position;

    return this.lbModel
      .find(query)
      .sort({ rank: 1 })
      .limit(limit)
      .lean() as any;
  }

  /**
   * Get a user's rank and entry for a period.
   */
  async getUserRank(
    userId: string,
    period: LeaderboardPeriod,
    periodKey: string,
  ): Promise<LeaderboardEntryDocument | null> {
    return this.lbModel
      .findOne({
        userId: new Types.ObjectId(userId),
        period,
        periodKey,
      })
      .lean() as any;
  }

  /**
   * Get current active period keys.
   */
  getActivePeriods(): Array<{
    period: LeaderboardPeriod;
    periodKey: string;
  }> {
    const now = new Date();
    return [
      { period: 'weekly', periodKey: this.getWeekKey(now) },
      { period: 'monthly', periodKey: this.getMonthKey(now) },
      { period: 'alltime', periodKey: 'alltime' },
    ];
  }

  /**
   * Get current week's period key (e.g. "2025-W23")
   *
   * FIX SLB-4: Use proper Thursday-based ISO 8601 week numbering.
   * The ISO week-numbering year can differ from the calendar year at year boundaries.
   * E.g., Dec 31, 2024 (Tuesday) is in ISO week 2025-W01, not 2024-W53.
   * The correct algorithm: the week containing the year's first Thursday is W01.
   */
  getWeekKey(date: Date = new Date()): string {
    // Shift to Tashkent time for week calc
    const tashkentMs = date.getTime() + 5 * 60 * 60 * 1000;
    const d = new Date(tashkentMs);
    d.setUTCHours(0, 0, 0, 0);

    // ISO 8601 week number using Thursday-based algorithm
    // Step 1: Find the nearest Thursday (ISO weeks are defined by their Thursday)
    const dayOfWeek = d.getUTCDay() || 7; // 1=Mon..7=Sun
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + (4 - dayOfWeek)); // Nearest Thursday

    // Step 2: The ISO year is the year of that Thursday
    const isoYear = thursday.getUTCFullYear();

    // Step 3: Week 1 is the week containing Jan 4 (or equivalently, the first Thursday)
    const jan1 = new Date(Date.UTC(isoYear, 0, 1));
    const jan1DayOfWeek = jan1.getUTCDay() || 7;
    const firstThursday = new Date(jan1);
    firstThursday.setUTCDate(jan1.getUTCDate() + (4 - jan1DayOfWeek));

    // Step 4: Calculate week number
    const weekNum = Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000)) + 1;

    return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
  }

  /**
   * Get current month's period key (e.g. "2025-06")
   */
  getMonthKey(date: Date = new Date()): string {
    const tashkentMs = date.getTime() + 5 * 60 * 60 * 1000;
    const d = new Date(tashkentMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get or create a leaderboard entry for user + period.
   * FIX SLB-5: Use findOneAndUpdate with upsert to prevent E11000 race condition.
   * Two concurrent calls to create() would both fail the uniqueness constraint.
   */
  private async getOrCreateEntry(
    userId: string,
    period: LeaderboardPeriod,
    periodKey: string,
    position: string,
  ): Promise<LeaderboardEntryDocument> {
    // Get display name for new entries
    const user = await this.userModel
      .findById(userId)
      .select('telegramId profile.firstName profile.lastName')
      .lean();

    const displayName = user
      ? [
          (user as any).profile?.firstName,
          (user as any).profile?.lastName,
        ]
          .filter(Boolean)
          .join(' ') || `User ${(user as any).telegramId || userId.slice(-4)}`
      : `User ${userId.slice(-4)}`;

    const entry = await this.lbModel.findOneAndUpdate(
      {
        userId: new Types.ObjectId(userId),
        period,
        periodKey,
      },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          telegramId: (user as any)?.telegramId,
          displayName,
          period,
          periodKey,
          position,
          points: 0,
          breakdown: {},
          pointsToday: 0,
          pointsTodayDate: this.getTodayKey(),
        },
      },
      { upsert: true, new: true },
    );

    return entry;
  }

  /**
   * Get user's position (junior, middle, senior, lead).
   * Falls back to 'junior' if not set.
   */
  private async getUserPosition(userId: string): Promise<string> {
    const cacheKey = `user:position:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const user = await this.userModel
      .findById(userId)
      .select('position')
      .lean();

    const position = (user as any)?.position || 'junior';
    await this.redis.setex(cacheKey, 3600, position); // Cache for 1 hour
    return position;
  }

  /**
   * Get user's plan for leaderboard eligibility.
   */
  private async getUserPlan(userId: string): Promise<string> {
    const cacheKey = `user:plan:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    // Fall back to free_trial if not cached
    return 'free_trial';
  }

  private getTodayKey(): string {
    const now = new Date();
    const tashkentMs = now.getTime() + 5 * 60 * 60 * 1000;
    const tashkent = new Date(tashkentMs);
    return `${tashkent.getUTCFullYear()}-${String(tashkent.getUTCMonth() + 1).padStart(2, '0')}-${String(tashkent.getUTCDate()).padStart(2, '0')}`;
  }
}
