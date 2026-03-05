import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import {
  BadgeDefinition,
  BadgeDefinitionDocument,
  DEFAULT_BADGES,
} from './schemas/badge-definition.schema';
import {
  UserStreak,
  UserStreakDocument,
} from '../streak/schemas/user-streak.schema';
import { APP_EVENTS } from '../../common/constants/events.constants';

/**
 * BadgeService — badge awarding logic
 *
 * Responsibilities:
 * - Seed DEFAULT_BADGES on startup (idempotent)
 * - Listen to events and check badge conditions
 * - Award badges to UserStreak.badges[]
 * - Emit BADGE_EARNED events for notifications
 *
 * Listens to:
 *   - streak.updated    → check streak badges (first_flame, week_warrior, etc.)
 *   - streak.milestone  → check milestone-specific badges
 *   - daily.task.completed → check score badges (perfect_score)
 *   - mock.completed    → check mock badges (ai_challenger)
 *   - irs.test.completed → check IRS badges (readiness_tested)
 *   - leaderboard.recalculated → check leaderboard badges (top3_weekly, number1_monthly)
 *   - referral.confirmed → check referral badges (social_butterfly)
 */
@Injectable()
export class BadgeService implements OnModuleInit {
  private readonly logger = new Logger(BadgeService.name);
  private badgeCache: Map<string, BadgeDefinition> = new Map();

  constructor(
    @InjectModel(BadgeDefinition.name)
    private badgeDefModel: Model<BadgeDefinitionDocument>,
    @InjectModel(UserStreak.name)
    private streakModel: Model<UserStreakDocument>,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
    @InjectRedis() private redis: Redis,
  ) {}

  async onModuleInit() {
    const isEnabled = this.configService.get<boolean>(
      'features.badgesEnabled',
    );
    if (!isEnabled) {
      this.logger.warn('Badges feature is DISABLED');
      return;
    }

    await this.seedBadges();
    await this.loadBadgeCache();
    this.logger.log(`BadgeService initialized (${this.badgeCache.size} badges loaded)`);
  }

  // ─── Seed Badges ──────────────────────────────────────────────

  /**
   * Seed DEFAULT_BADGES into badgedefinitions collection.
   * Idempotent: uses upsert by badgeId.
   */
  private async seedBadges(): Promise<void> {
    let created = 0;
    let existing = 0;

    for (const badge of DEFAULT_BADGES) {
      const result = await this.badgeDefModel.updateOne(
        { badgeId: badge.badgeId },
        { $setOnInsert: badge },
        { upsert: true },
      );

      if (result.upsertedCount > 0) {
        created++;
      } else {
        existing++;
      }
    }

    if (created > 0) {
      this.logger.log(
        `Badge seeding: ${created} created, ${existing} already existed`,
      );
    }
  }

  /**
   * Load all active badge definitions into memory cache.
   */
  private async loadBadgeCache(): Promise<void> {
    const badges = await this.badgeDefModel.find({ isActive: true }).lean();
    this.badgeCache.clear();
    for (const badge of badges) {
      this.badgeCache.set(badge.badgeId, badge as any);
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────

  // FIX P2-M3: All @OnEvent handlers wrapped in try/catch to prevent event pipeline crash
  @OnEvent(APP_EVENTS.STREAK_UPDATED)
  async onStreakUpdated(payload: {
    userId: string;
    currentStreak: number;
    isNewMilestone: boolean;
    activityType: string;
  }) {
    try {
      if (!this.isEnabled()) return;

      // Check streak badges
      await this.checkAndAwardStreakBadges(
        payload.userId,
        payload.currentStreak,
      );
    } catch (error: any) {
      this.logger.error(`[onStreakUpdated] Error: ${error.message}`, error.stack);
    }
  }

  // FIX SLB-14: Add missing outer try/catch — comment claimed all handlers are wrapped but this one wasn't
  @OnEvent(APP_EVENTS.DAILY_TASK_COMPLETED)
  async onDailyTaskCompleted(payload: {
    userId: string;
    score: number;
  }) {
    try {
    if (!this.isEnabled()) return;

    // FIX SLB-6: Daily task scores are always 0-10, normalize consistently
    const normalizedScore = payload.score > 10 ? payload.score / 10 : payload.score;
    if (normalizedScore >= 10) {
      await this.awardBadgeIfNew(payload.userId, 'perfect_score');
    }

    // FIX P2-H4: Track daily high scores for perfect_week badge check.
    // Store the highest score per day in a Redis sorted set.
    try {
      // FIX SLB-7: Use Tashkent timezone (UTC+5) for date tracking, not UTC
      const nowMs = Date.now() + 5 * 60 * 60 * 1000;
      const tashkentDate = new Date(nowMs);
      const todayKey = `${tashkentDate.getUTCFullYear()}-${String(tashkentDate.getUTCMonth() + 1).padStart(2, '0')}-${String(tashkentDate.getUTCDate()).padStart(2, '0')}`;
      const scoreKey = `badge:daily_scores:${payload.userId}`;
      const timestamp = Date.now();

      // Use ZADD with GT flag to only update if new score is higher
      // Member is the day key, score is the normalized score, but we use timestamp as score
      // Actually, we want to track "did user score 8+ each day" — so store the daily score
      const existingScore = await this.redis.zscore(scoreKey, todayKey);
      if (!existingScore || normalizedScore > parseFloat(existingScore)) {
        await this.redis.zadd(scoreKey, timestamp, todayKey);
        // Overwrite: use a separate hash for actual scores
        await this.redis.hset(`${scoreKey}:vals`, todayKey, normalizedScore.toString());
      }
      // Trim old entries (keep last 14 days)
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      await this.redis.zremrangebyscore(scoreKey, 0, fourteenDaysAgo);
      await this.redis.expire(scoreKey, 30 * 86400); // 30 days TTL
      await this.redis.expire(`${scoreKey}:vals`, 30 * 86400);
    } catch {
      // Non-critical — badge tracking failure shouldn't affect core flow
    }
    } catch (error: any) {
      this.logger.error(`[onDailyTaskCompleted] Error: ${error.message}`, error.stack);
    }
  }

  @OnEvent(APP_EVENTS.MOCK_COMPLETED)
  async onMockCompleted(payload: { userId: string }) {
    try {
      if (!this.isEnabled()) return;
      await this.awardBadgeIfNew(payload.userId, 'ai_challenger');
    } catch (error: any) {
      this.logger.error(`[onMockCompleted] Error: ${error.message}`, error.stack);
    }
  }

  @OnEvent(APP_EVENTS.IRS_TEST_COMPLETED)
  async onIrsCompleted(payload: { userId?: string }) {
    try {
      if (!this.isEnabled()) return;
      if (!payload.userId) return;
      await this.awardBadgeIfNew(payload.userId, 'readiness_tested');
    } catch (error: any) {
      this.logger.error(`[onIrsCompleted] Error: ${error.message}`, error.stack);
    }
  }

  @OnEvent(APP_EVENTS.LEADERBOARD_RECALCULATED)
  async onLeaderboardRecalculated(payload: {
    period: string;
    periodKey: string;
    topUsers: Array<{ userId: string; rank: number; points: number }>;
  }) {
    try {
      if (!this.isEnabled()) return;

      for (const topUser of payload.topUsers) {
        // top3_weekly: rank <= 3 in weekly
        if (payload.period === 'weekly' && topUser.rank <= 3) {
          await this.awardBadgeIfNew(topUser.userId, 'top3_weekly');
        }

        // number1_monthly: rank == 1 in monthly
        if (payload.period === 'monthly' && topUser.rank === 1) {
          await this.awardBadgeIfNew(topUser.userId, 'number1_monthly');
        }
      }
    } catch (error: any) {
      this.logger.error(`[onLeaderboardRecalculated] Error: ${error.message}`, error.stack);
    }
  }

  @OnEvent(APP_EVENTS.REFERRAL_CONFIRMED)
  async onReferralConfirmed(payload: {
    referrerId: string;
    referredUserId: string;
  }) {
    try {
      if (!this.isEnabled()) return;

      // Count total referrals for the referrer
      // We check the UserStreak badges to see if they need social_butterfly
      // The badge requires 5 referrals — we track via a simple Redis counter
      const countKey = `badge:referral_count:${payload.referrerId}`;
      const newCount = await this.getRedisIncr(countKey);

      const badge = this.badgeCache.get('social_butterfly');
      if (badge && newCount >= badge.condition.threshold) {
        await this.awardBadgeIfNew(payload.referrerId, 'social_butterfly');
      }
    } catch (error: any) {
      this.logger.error(`[onReferralConfirmed] Error: ${error.message}`, error.stack);
    }
  }

  // ─── Badge Awarding Logic ─────────────────────────────────────

  /**
   * Check and award streak-based badges.
   */
  private async checkAndAwardStreakBadges(
    userId: string,
    currentStreak: number,
  ): Promise<void> {
    const streakBadges = Array.from(this.badgeCache.values()).filter(
      (b) => b.condition.type === 'streak',
    );

    for (const badge of streakBadges) {
      if (currentStreak >= badge.condition.threshold) {
        await this.awardBadgeIfNew(userId, badge.badgeId);
      }
    }

    // FIX P2-H4: Check perfect_week badge — 7 consecutive days with 8+ scores.
    // This badge has condition type 'score' with extra.consecutiveDays: 7,
    // but it was never checked. We check it here when streak >= 7.
    if (currentStreak >= 7) {
      const perfectWeekBadge = this.badgeCache.get('perfect_week');
      if (perfectWeekBadge) {
        // Check if user already has it
        const streak = await this.streakModel
          .findOne({ userId: new Types.ObjectId(userId) })
          .select('badges')
          .lean();
        if (streak && !streak.badges?.includes('perfect_week')) {
          // Check recent daily task scores via Redis hash (lightweight check).
          // The badge requires 7 consecutive days of 8+ scores.
          const scoreKey = `badge:daily_scores:${userId}:vals`;
          const allScores = await this.redis.hgetall(scoreKey);

          if (Object.keys(allScores).length >= 7) {
            // FIX SLB-7: Use Tashkent timezone for date generation (consistent with daily tracking)
            const tashkentNowMs = Date.now() + 5 * 60 * 60 * 1000;
            const last7Days: string[] = [];
            for (let i = 0; i < 7; i++) {
              const d = new Date(tashkentNowMs - i * 24 * 60 * 60 * 1000);
              last7Days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
            }

            const allHighScores = last7Days.every((day) => {
              const score = allScores[day];
              return score !== undefined && parseFloat(score) >= 8;
            });

            if (allHighScores) {
              await this.awardBadgeIfNew(userId, 'perfect_week');
            }
          }
        }
      }
    }
  }

  /**
   * Award a badge to a user if they don't already have it.
   */
  private async awardBadgeIfNew(
    userId: string,
    badgeId: string,
  ): Promise<boolean> {
    const badge = this.badgeCache.get(badgeId);
    if (!badge) {
      this.logger.warn(`Badge definition not found: ${badgeId}`);
      return false;
    }

    // Atomic: add badge only if not already present
    const result = await this.streakModel.updateOne(
      {
        userId: new Types.ObjectId(userId),
        badges: { $ne: badgeId }, // Not already earned
      },
      {
        $addToSet: { badges: badgeId },
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Badge awarded: ${badgeId} (${badge.name}) to user ${userId}`,
      );

      // Emit badge earned event
      this.eventEmitter.emit(APP_EVENTS.BADGE_EARNED, {
        userId,
        badgeId: badge.badgeId,
        badgeName: badge.name,
        rarity: badge.rarity,
      });

      return true;
    }

    return false;
  }

  // ─── Public Query Methods ─────────────────────────────────────

  /**
   * Get all badge definitions.
   */
  async getAllBadges(): Promise<BadgeDefinition[]> {
    return Array.from(this.badgeCache.values());
  }

  /**
   * Get badges earned by a user.
   */
  async getUserBadges(
    userId: string,
  ): Promise<Array<BadgeDefinition & { earnedAt?: Date }>> {
    const streak = await this.streakModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('badges')
      .lean();

    if (!streak || !streak.badges || streak.badges.length === 0) {
      return [];
    }

    return streak.badges
      .map((badgeId) => this.badgeCache.get(badgeId))
      .filter((b): b is BadgeDefinition => !!b);
  }

  /**
   * Get badge progress for a user (which badges they have vs. total).
   */
  async getBadgeProgress(userId: string): Promise<{
    earned: number;
    total: number;
    badges: Array<{
      badgeId: string;
      name: string;
      emoji: string;
      rarity: string;
      earned: boolean;
    }>;
  }> {
    const allBadges = Array.from(this.badgeCache.values());
    const streak = await this.streakModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('badges')
      .lean();

    const earnedSet = new Set(streak?.badges || []);

    return {
      earned: earnedSet.size,
      total: allBadges.length,
      badges: allBadges
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((badge) => ({
          badgeId: badge.badgeId,
          name: badge.name,
          emoji: badge.emoji,
          rarity: badge.rarity,
          earned: earnedSet.has(badge.badgeId),
        })),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private isEnabled(): boolean {
    return (
      this.configService.get<boolean>('features.badgesEnabled') ?? false
    );
  }

  /**
   * Increment a Redis counter and return the new value.
   * Used for tracking referral counts for badge thresholds.
   */
  private async getRedisIncr(key: string): Promise<number> {
    const result = await this.redis.incr(key);
    // Set expiry only on first increment (lifetime counter but with safety TTL)
    if (result === 1) {
      await this.redis.expire(key, 365 * 86400); // 1 year TTL
    }
    return result;
  }
}
