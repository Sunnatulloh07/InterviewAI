import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

import {
  UserStreak,
  UserStreakDocument,
} from './schemas/user-streak.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * StreakMigrationService — one-time migration from User.dailyTasks to UserStreak collection
 *
 * Runs on application bootstrap (OnApplicationBootstrap).
 * Guarded by Redis flag to ensure it only runs ONCE.
 *
 * Migration steps:
 * 1. Find all users with dailyTasks.currentStreak > 0 or dailyTasks.longestStreak > 0
 * 2. For each, create UserStreak document (upsert)
 * 3. Set Redis flag to prevent re-running
 */
@Injectable()
export class StreakMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StreakMigrationService.name);

  constructor(
    @InjectModel(UserStreak.name)
    private streakModel: Model<UserStreakDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectRedis() private redis: Redis,
    private configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    const MIGRATION_KEY = 'migration:streak:v1:done';

    try {
      const alreadyDone = await this.redis.get(MIGRATION_KEY);
      if (alreadyDone) {
        this.logger.debug('Streak migration already completed (v1)');
        return;
      }

      this.logger.log('Starting streak migration from User.dailyTasks to UserStreak...');
      await this.migrateStreaks();

      await this.redis.set(MIGRATION_KEY, new Date().toISOString());
      this.logger.log('Streak migration completed and flagged');
    } catch (error: any) {
      this.logger.error(`Streak migration failed: ${error.message}`, error.stack);
      // Don't throw — migration failure shouldn't prevent app startup
    }
  }

  private async migrateStreaks(): Promise<void> {
    // Find all users who have any streak data
    // FIX P2-H5: Also select updatedAt and dailyTasks.lastCompletedAt
    // to set a more accurate lastActivityDate instead of new Date().
    const users = await this.userModel
      .find({
        $or: [
          { 'dailyTasks.currentStreak': { $gt: 0 } },
          { 'dailyTasks.longestStreak': { $gt: 0 } },
          { 'dailyTasks.totalCompleted': { $gt: 0 } },
        ],
      })
      .select('_id telegramId dailyTasks updatedAt')
      .lean();

    this.logger.log(`Found ${users.length} users with streak data to migrate`);

    if (users.length === 0) return;

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const dailyTasks = (user as any).dailyTasks || {};
        const currentStreak = dailyTasks.currentStreak || 0;
        const longestStreak = dailyTasks.longestStreak || 0;
        const totalCompleted = dailyTasks.totalCompleted || 0;

        // Upsert: only create if not already exists
        const result = await this.streakModel.updateOne(
          { userId: user._id },
          {
            $setOnInsert: {
              userId: user._id,
              telegramId: (user as any).telegramId,
              currentStreak,
              longestStreak,
              state: currentStreak > 0 ? 'active' : 'inactive',
              // FIX P2-H5: Use actual last activity date from user data instead of new Date().
              // Try dailyTasks.lastCompletedAt, then user.updatedAt, then fallback to undefined.
              lastActivityDate: currentStreak > 0
                ? (dailyTasks.lastCompletedAt || (user as any).updatedAt || undefined)
                : undefined,
              lastActivityType: 'daily_task',
              totalActiveDays: totalCompleted,
              totalStreaksStarted: currentStreak > 0 ? 1 : 0,
              totalStreaksBroken: 0,
              freezesRemaining: 0,
              freezesUsedThisMonth: 0,
              milestones: [],
              badges: [],
            },
          },
          { upsert: true },
        );

        if (result.upsertedCount > 0) {
          created++;
        } else {
          skipped++;
        }
      } catch (error: any) {
        failed++;
        this.logger.warn(
          `Failed to migrate streak for user ${user._id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Streak migration results: created=${created}, skipped=${skipped}, failed=${failed}`,
    );
  }
}
