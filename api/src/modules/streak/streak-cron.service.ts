import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { StreakService } from './streak.service';
import {
  UserStreak,
  UserStreakDocument,
} from './schemas/user-streak.schema';
import { getTashkentMidnight, getTashkentHour } from '../../common/utils/tashkent-time';

/**
 * StreakCronService — scheduled jobs for streak management
 *
 * Cron Schedule (all times Tashkent UTC+5):
 *   00:05  — Midnight check: freeze or break missed streaks
 *   09:00  — Morning reminder: "Your streak is N! Today's tasks are ready"
 *   18:00  — Evening warning: mark at_risk + "You haven't completed today!"
 *   21:00  — Last chance: "3 hours left! Save your N-day streak!"
 *   1st of month — Reset monthly freeze counters
 *   Monday 10:00 — Weekly leaderboard digest (handled by leaderboard module)
 *
 * Anti-spam:
 *   - Max 4 notifications per user per day (tracked in Redis)
 *   - Streak 0 users get max 1 weekly reminder after 3 days
 *   - /mute_notifications respects user preference
 */
@Injectable()
export class StreakCronService {
  private readonly logger = new Logger(StreakCronService.name);

  constructor(
    private streakService: StreakService,
    private configService: ConfigService,
    @InjectModel(UserStreak.name)
    private streakModel: Model<UserStreakDocument>,
    @InjectRedis() private redis: Redis,
  ) {}

  // ─── 00:05 Tashkent — Midnight Streak Check ──────────────────

  /**
   * At midnight (+5min buffer): check all active streaks.
   * Users who missed yesterday → freeze (if available) or break.
   *
   * Uses distributed lock to prevent duplicate execution in multi-instance deployments.
   */
  @Cron('5 0 * * *', {
    name: 'streak_midnight_check',
    timeZone: 'Asia/Tashkent',
  })
  async midnightStreakCheck() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    const lockKey = 'cron:streak:midnight_check';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!acquired) {
      this.logger.debug('Midnight streak check already running (lock held)');
      return;
    }

    try {
      this.logger.log('Starting midnight streak check...');
      const result = await this.streakService.performMidnightCheck();
      this.logger.log(
        `Midnight check complete: checked=${result.checked}, frozen=${result.frozen}, broken=${result.broken}, safe=${result.safe}`,
      );

      // Send "streak lost" notifications to broken users
      await this.sendStreakLostNotifications();
    } catch (error: any) {
      this.logger.error(
        `Midnight streak check failed: ${error.message}`,
        error.stack,
      );
    }
    // FIX SLB-15: Don't delete lock in finally — let it expire via EX 300.
    // Deleting in finally defeats the lock purpose: if job finishes in 10s,
    // another pod could start the same job within the 5-minute window.
  }

  // ─── 09:00 Tashkent — Morning Reminder ───────────────────────

  /**
   * Morning motivation: remind users with active streaks about today's tasks.
   * Target: all users with state=active or frozen and streak > 0
   */
  @Cron('0 9 * * *', {
    name: 'streak_morning_reminder',
    timeZone: 'Asia/Tashkent',
  })
  async morningReminder() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    const lockKey = 'cron:streak:morning_reminder';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 600, 'NX');
    if (!acquired) return;

    try {
      const users = await this.streakService.getActiveStreakUsers();
      let sent = 0;

      for (const user of users) {
        if (!user.telegramId) continue;
        if (await this.isNotificationLimitReached(user.userId.toString())) continue;

        const message = this.buildMorningMessage(user.currentStreak);
        await this.sendTelegramNotification(user.telegramId, message);
        await this.incrementNotificationCount(user.userId.toString());
        sent++;

        // Small delay to avoid Telegram rate limits
        if (sent % 25 === 0) await this.delay(1000);
      }

      this.logger.log(`Morning reminders sent: ${sent}/${users.length}`);
    } catch (error: any) {
      this.logger.error(`Morning reminder failed: ${error.message}`);
    }
    // FIX SLB-15: Let lock expire naturally via EX 600
  }

  // ─── 18:00 Tashkent — Evening Warning ────────────────────────

  /**
   * Evening warning: mark users as at_risk if they haven't completed today.
   * Send notification to at_risk users.
   */
  @Cron('0 18 * * *', {
    name: 'streak_evening_warning',
    timeZone: 'Asia/Tashkent',
  })
  async eveningWarning() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    const lockKey = 'cron:streak:evening_warning';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 600, 'NX');
    if (!acquired) return;

    try {
      // Mark active users as at_risk
      const markedCount = await this.streakService.markAtRiskUsers();
      this.logger.log(`Marked ${markedCount} users as at_risk at 18:00`);

      // Send warning notifications
      const atRiskUsers = await this.streakService.getUsersAtRisk();
      let sent = 0;

      for (const user of atRiskUsers) {
        if (!user.telegramId) continue;
        if (await this.isNotificationLimitReached(user.userId.toString())) continue;

        const message = this.buildEveningWarningMessage(user.currentStreak);
        await this.sendTelegramNotification(user.telegramId, message);
        await this.incrementNotificationCount(user.userId.toString());
        sent++;

        if (sent % 25 === 0) await this.delay(1000);
      }

      this.logger.log(`Evening warnings sent: ${sent}/${atRiskUsers.length}`);
    } catch (error: any) {
      this.logger.error(`Evening warning failed: ${error.message}`);
    }
    // FIX SLB-15: Let lock expire naturally via EX 600
  }

  // ─── 21:00 Tashkent — Last Chance ────────────────────────────

  /**
   * Last chance warning: urgent notification for users with streak >= 3
   * who still haven't completed today.
   */
  @Cron('0 21 * * *', {
    name: 'streak_last_chance',
    timeZone: 'Asia/Tashkent',
  })
  async lastChanceWarning() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    const lockKey = 'cron:streak:last_chance';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 600, 'NX');
    if (!acquired) return;

    try {
      // Only warn users with streak >= 3 who are still at risk
      const atRiskUsers = await this.streakService.getUsersAtRisk();
      const highStreakUsers = atRiskUsers.filter((u) => u.currentStreak >= 3);
      let sent = 0;

      for (const user of highStreakUsers) {
        if (!user.telegramId) continue;
        if (await this.isNotificationLimitReached(user.userId.toString())) continue;

        const message = this.buildLastChanceMessage(user.currentStreak);
        await this.sendTelegramNotification(user.telegramId, message);
        await this.incrementNotificationCount(user.userId.toString());
        sent++;

        if (sent % 25 === 0) await this.delay(1000);
      }

      this.logger.log(
        `Last chance warnings sent: ${sent}/${highStreakUsers.length}`,
      );
    } catch (error: any) {
      this.logger.error(`Last chance warning failed: ${error.message}`);
    }
    // FIX SLB-15: Let lock expire naturally via EX 600
  }

  // ─── 1st of Month — Reset Monthly Freezes ────────────────────

  /**
   * Reset freeze counters on the 1st of each month.
   */
  @Cron('0 0 1 * *', {
    name: 'streak_monthly_freeze_reset',
    timeZone: 'Asia/Tashkent',
  })
  async monthlyFreezeReset() {
    const isEnabled = this.configService.get<boolean>('features.streakEnabled');
    if (!isEnabled) return;

    // FIX SLB-16: Add distributed lock — without it, every pod runs this cron
    const lockKey = 'cron:streak:monthly_freeze_reset';
    const acquired = await this.redis.set(lockKey, '1', 'EX', 600, 'NX');
    if (!acquired) {
      this.logger.debug('Monthly freeze reset already running (lock held)');
      return;
    }

    try {
      const count = await this.streakService.resetMonthlyFreezes();
      this.logger.log(`Monthly freeze reset: ${count} users updated`);
    } catch (error: any) {
      this.logger.error(`Monthly freeze reset failed: ${error.message}`);
    }
    // Let lock expire naturally via EX 600
  }

  // ─── Notification: Streak Lost ────────────────────────────────

  /**
   * Send "streak lost" notifications to users whose streak was broken
   * at midnight. Called after performMidnightCheck().
   */
  private async sendStreakLostNotifications(): Promise<void> {
    // Find users who were broken in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const brokenUsers = await this.streakModel
      .find({
        state: 'broken',
        currentStreak: 0,
        updatedAt: { $gte: tenMinutesAgo },
      })
      .lean();

    let sent = 0;
    for (const user of brokenUsers) {
      if (!user.telegramId) continue;
      if (await this.isNotificationLimitReached(user.userId.toString())) continue;

      const message = this.buildStreakLostMessage(user.longestStreak);
      await this.sendTelegramNotification(user.telegramId, message);
      await this.incrementNotificationCount(user.userId.toString());
      sent++;

      if (sent % 25 === 0) await this.delay(1000);
    }

    if (sent > 0) {
      this.logger.log(`Streak lost notifications sent: ${sent}`);
    }
  }

  // ─── Message Templates (Multilingual: Uzbek primary) ──────────

  private buildMorningMessage(streak: number): string {
    return (
      `<b>🔥 Streak: ${streak} kun!</b>\n\n` +
      `Bugungi vazifalar tayyor. Streakni davom ettiring!\n\n` +
      `/tasks — Bugungi vazifalarni boshlash`
    );
  }

  private buildEveningWarningMessage(streak: number): string {
    return (
      `<b>⚠️ Bugun hali bajarmadingiz!</b>\n\n` +
      `Streak: <b>${streak} kun</b>\n` +
      `Streakni yo'qotmaslik uchun bugun vazifalarni bajaring!\n\n` +
      `/tasks — Hozir boshlash`
    );
  }

  private buildLastChanceMessage(streak: number): string {
    return (
      `<b>🚨 3 soat qoldi!</b>\n\n` +
      `Streak: <b>${streak} kun</b> ni saqlang!\n` +
      `Bugun yakunlamasangiz, streak yo'qoladi.\n\n` +
      `/tasks — Hoziroq boshlash`
    );
  }

  private buildStreakLostMessage(longestStreak: number): string {
    return (
      `<b>😢 Streak yo'qoldi</b>\n\n` +
      `${longestStreak > 0 ? `Eng uzun streakingiz: ${longestStreak} kun edi.\n` : ''}` +
      `Xafa bo'lmang — qayta boshlash mumkin!\n\n` +
      `/tasks — Yangi streak boshlash`
    );
  }

  // ─── Notification Throttling ──────────────────────────────────

  /**
   * Check if user has reached daily notification limit (max 4/day).
   */
  private async isNotificationLimitReached(userId: string): Promise<boolean> {
    const maxPerDay = this.configService.get<number>(
      'features.streak.maxNotificationsPerDay',
      4,
    );
    const key = `streak:notif:${userId}:${this.getTodayKey()}`;
    const count = await this.redis.get(key);
    return count !== null && parseInt(count, 10) >= maxPerDay;
  }

  /**
   * Increment the daily notification counter for a user.
   */
  private async incrementNotificationCount(userId: string): Promise<void> {
    const key = `streak:notif:${userId}:${this.getTodayKey()}`;
    const pipe = this.redis.pipeline();
    pipe.incr(key);
    pipe.expire(key, 86400); // Expire in 24h
    await pipe.exec();
  }

  private getTodayKey(): string {
    const now = new Date();
    const tashkentMs = now.getTime() + 5 * 60 * 60 * 1000;
    const tashkent = new Date(tashkentMs);
    return `${tashkent.getUTCFullYear()}-${String(tashkent.getUTCMonth() + 1).padStart(2, '0')}-${String(tashkent.getUTCDate()).padStart(2, '0')}`;
  }

  // ─── Telegram Notification Helper ─────────────────────────────

  /**
   * Send a Telegram notification.
   * Uses direct bot API call via Redis-stored bot token.
   * In production, this delegates to TelegramService (injected via StreakModule).
   *
   * We store notification sending as a simple HTTPS call to avoid
   * circular dependency with TelegramModule.
   */
  private async sendTelegramNotification(
    telegramId: number,
    message: string,
  ): Promise<void> {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      if (!botToken) {
        this.logger.warn('No TELEGRAM_BOT_TOKEN configured, skipping notification');
        return;
      }

      // Use native fetch to send directly via Telegram Bot API
      // This avoids circular dependency with TelegramModule
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        // Don't log for blocked/deactivated users
        if (
          !errorBody.includes('bot was blocked') &&
          !errorBody.includes('user is deactivated') &&
          !errorBody.includes('chat not found')
        ) {
          this.logger.warn(
            `Failed to send streak notification to ${telegramId}: ${response.status}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to send streak notification to ${telegramId}: ${error.message}`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
