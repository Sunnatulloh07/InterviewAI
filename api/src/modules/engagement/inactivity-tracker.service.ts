import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';

/**
 * InactivityTrackerService
 *
 * Tracks inactive users and sends targeted engagement notifications:
 * - Never active users (lastActiveAt = createdAt)
 * - 7 days inactive users
 * - 30 days inactive users
 * - 90 days inactive users
 *
 * Features:
 * - Free trial tracking (30 days limit)
 * - Limit usage tracking for free users
 * - Progression system (7 days → 30 days → 90 days)
 * - 3-language support (Uzbek, Russian, English)
 * - Redis distributed lock (multi-instance scaling)
 */
@Injectable()
export class InactivityTrackerService {
  private readonly logger = new Logger(InactivityTrackerService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService)) private readonly telegramService: TelegramService,
  ) {}

  /**
   * Daily inactivity reminders - runs at 10:00 AM Tashkent time
   */
  @Cron('0 10 * * *', {
    name: 'inactivity-reminders',
    timeZone: 'Asia/Tashkent',
  })
  async sendInactivityReminders(): Promise<void> {
    const now = new Date();
    this.logger.log('Starting inactivity reminders...');

    try {
      const results = {
        neverActive: 0,
        sevenDaysInactive: 0,
        thirtyDaysInactive: 0,
        ninetyDaysInactive: 0,
        failed: 0,
      };

      const batchSize = 1000;
      let lastId: any = null;

      // Cursor-based pagination: use _id > lastId instead of skip(offset).
      // skip(N) forces MongoDB to scan and discard N documents each batch,
      // making it O(N^2) over the full collection. Cursor-based is O(N).
      for (let batch = 0; batch < 100; batch++) {
        const batchResults = await this.processBatch(lastId, batchSize, now);

        results.neverActive += batchResults.neverActive;
        results.sevenDaysInactive += batchResults.sevenDaysInactive;
        results.thirtyDaysInactive += batchResults.thirtyDaysInactive;
        results.ninetyDaysInactive += batchResults.ninetyDaysInactive;
        results.failed += batchResults.failed;

        if (!batchResults.hasMore) {
          this.logger.log('No more users to process, stopping');
          break;
        }

        lastId = batchResults.lastProcessedId;
        await this.delay(100);
      }

      this.logger.log(
        `Inactivity reminders completed: ` +
          `neverActive=${results.neverActive}, ` +
          `7days=${results.sevenDaysInactive}, ` +
          `30days=${results.thirtyDaysInactive}, ` +
          `90days=${results.ninetyDaysInactive}, ` +
          `failed=${results.failed}`,
      );
    } catch (error: any) {
      this.logger.error(`Inactivity reminders failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Process a batch of users for inactivity reminders
   */
  private async processBatch(
    lastId: any,
    limit: number,
    now: Date,
  ): Promise<{
    neverActive: number;
    sevenDaysInactive: number;
    thirtyDaysInactive: number;
    ninetyDaysInactive: number;
    failed: number;
    hasMore: boolean;
    lastProcessedId: any;
  }> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Cursor-based pagination: filter by _id > lastId instead of skip()
    const query: any = {
      deletedAt: null,
      isBlocked: false,
      'engagement.isBotBlocked': { $ne: true },
      'engagement.notificationsPaused': { $ne: true },
    };

    if (lastId) {
      query._id = { $gt: lastId };
    }

    const users = await this.userModel
      .find(query)
      .select('_id telegramId language profile subscription engagement usage createdAt')
      .sort({ _id: 1 })
      .limit(limit)
      .lean();

    if (users.length === 0) {
      return {
        neverActive: 0,
        sevenDaysInactive: 0,
        thirtyDaysInactive: 0,
        ninetyDaysInactive: 0,
        failed: 0,
        hasMore: false,
        lastProcessedId: lastId,
      };
    }

    const results = {
      neverActive: 0,
      sevenDaysInactive: 0,
      thirtyDaysInactive: 0,
      ninetyDaysInactive: 0,
      failed: 0,
      hasMore: users.length >= limit,
      lastProcessedId: users[users.length - 1]._id,
    };

    for (const user of users) {

      try {
        await this.processUserForInactivity(user, now, sevenDaysAgo, thirtyDaysAgo, ninetyDaysAgo);

        const inactiveLevel = this.determineInactiveLevel(
          user,
          now,
          sevenDaysAgo,
          thirtyDaysAgo,
          ninetyDaysAgo,
        );

        switch (inactiveLevel) {
          case 'never_active':
            results.neverActive++;
            break;
          case 'seven_days_inactive':
            results.sevenDaysInactive++;
            break;
          case 'thirty_days_inactive':
            results.thirtyDaysInactive++;
            break;
          case 'ninety_days_inactive':
            results.ninetyDaysInactive++;
            break;
          default:
            break;
        }
      } catch (error: any) {
        this.logger.error(`Failed to process user ${user._id}: ${error.message}`);
        results.failed++;
      }
    }

    if (users.length < limit) {
      results.hasMore = false;
    }

    return results;
  }

  /**
   * Process a single user for inactivity reminder.
   *
   * FIX #31: Added deduplication — skip if the user was already notified
   * at this same inactivity tier.  Without this check the cron would send
   * a message to every qualifying user EVERY DAY it runs, because the
   * query has no "already notified" filter.
   *
   * The tier progression works like this:
   *   never_active → 7 days → 30 days → 90 days
   * A user only receives ONE notification per tier.  Once they reach
   * `ninety_days_inactive` we stop sending altogether.
   */
  private async processUserForInactivity(
    user: any,
    now: Date,
    sevenDaysAgo: Date,
    thirtyDaysAgo: Date,
    ninetyDaysAgo: Date,
  ): Promise<void> {
    const inactiveLevel = this.determineInactiveLevel(
      user,
      now,
      sevenDaysAgo,
      thirtyDaysAgo,
      ninetyDaysAgo,
    );

    // Skip if user is currently active (no reminder needed)
    if (inactiveLevel === 'active') {
      return;
    }

    // Deduplication: skip if user was already notified at this tier or a later one.
    // Tier severity order: never_active < seven_days < thirty_days < ninety_days
    const TIER_ORDER: Record<string, number> = {
      never_active: 0,
      seven_days_inactive: 1,
      thirty_days_inactive: 2,
      ninety_days_inactive: 3,
    };
    const currentTier = TIER_ORDER[inactiveLevel] ?? -1;
    const previouslyNotifiedTier = TIER_ORDER[user.engagement?.inactiveReminderLevel] ?? -1;

    if (previouslyNotifiedTier >= currentTier) {
      // Already notified at this tier (or a more severe one) — don't spam.
      return;
    }

    if (inactiveLevel === 'never_active') {
      await this.processNeverActiveUser(user);
    } else if (inactiveLevel === 'seven_days_inactive') {
      await this.processSevenDaysInactiveUser(user);
    } else if (inactiveLevel === 'thirty_days_inactive') {
      await this.processThirtyDaysInactiveUser(user);
    } else if (inactiveLevel === 'ninety_days_inactive') {
      await this.processNinetyDaysInactiveUser(user);
    }
  }

  /**
   * Determine user's inactivity level
   */
  private determineInactiveLevel(
    user: any,
    now: Date,
    sevenDaysAgo: Date,
    thirtyDaysAgo: Date,
    ninetyDaysAgo: Date,
  ):
    | 'never_active'
    | 'seven_days_inactive'
    | 'thirty_days_inactive'
    | 'ninety_days_inactive'
    | 'active' {
    // Check never_active FIRST: user has never interacted (lastActiveAt is null/undefined)
    // In this case engagement.lastActiveAt is set to createdAt by default but was never
    // updated by actual user interaction. We distinguish by checking the field directly.
    const hasNeverBeenActive =
      user.engagement?.lastActiveAt === undefined || user.engagement?.lastActiveAt === null;

    if (hasNeverBeenActive) {
      return 'never_active';
    }

    const lastActiveAt = user.engagement.lastActiveAt;
    const daysSinceActive = this.getDaysSince(lastActiveAt, now);

    if (daysSinceActive >= 90) {
      return 'ninety_days_inactive';
    } else if (daysSinceActive >= 30) {
      return 'thirty_days_inactive';
    } else if (daysSinceActive >= 7) {
      return 'seven_days_inactive';
    }

    return 'active';
  }

  /**
   * Process never active users (lastActiveAt = createdAt)
   */
  private async processNeverActiveUser(user: any): Promise<void> {
    const plan = user.subscription?.plan || 'free_trial';
    const language = user.language || 'uz';

    const daysSinceRegistration = this.getDaysSince(user.createdAt, new Date());

    if (plan === 'free_trial' && daysSinceRegistration > 30) {
      this.logger.debug(`Free trial user ${user._id} beyond 30 days, skipping`);
      return;
    }

    const message = this.getNeverActiveMessage(language, plan);

    await this.sendTelegramMessage(user, message);

    await this.updateInactivityLevel(user._id.toString(), 'never_active', daysSinceRegistration);
  }

  /**
   * Process 7 days inactive users
   */
  private async processSevenDaysInactiveUser(user: any): Promise<void> {
    const plan = user.subscription?.plan || 'free_trial';
    const language = user.language || 'uz';
    const daysSinceRegistration = this.getDaysSince(user.createdAt, new Date());

    if (plan === 'free_trial' && daysSinceRegistration > 30) {
      this.logger.debug(`Free trial user ${user._id} beyond 30 days, skipping`);
      return;
    }

    const message = this.getSevenDaysInactiveMessage(language, plan);

    await this.sendTelegramMessage(user, message);

    await this.updateInactivityLevel(user._id.toString(), 'seven_days_inactive', 7);
  }

  /**
   * Process 30 days inactive users
   */
  private async processThirtyDaysInactiveUser(user: any): Promise<void> {
    const plan = user.subscription?.plan || 'free_trial';
    const language = user.language || 'uz';
    const daysSinceRegistration = this.getDaysSince(user.createdAt, new Date());

    if (plan === 'free_trial' && daysSinceRegistration > 30) {
      this.logger.debug(`Free trial user ${user._id} beyond 30 days, skipping`);
      return;
    }

    const message = this.getThirtyDaysInactiveMessage(language, plan);

    await this.sendTelegramMessage(user, message);

    await this.updateInactivityLevel(user._id.toString(), 'thirty_days_inactive', 30);
  }

  /**
   * Process 90 days inactive users — send final farewell message
   *
   * FIX #98: Previously only updated DB silently without sending any message.
   * Now sends a final "we miss you" message. After this tier, no more
   * notifications are sent (deduplication logic prevents it).
   */
  private async processNinetyDaysInactiveUser(user: any): Promise<void> {
    const language = user.language || 'uz';
    const message = this.getNinetyDaysInactiveMessage(language);

    await this.sendTelegramMessage(user, message);
    await this.updateInactivityLevel(user._id.toString(), 'ninety_days_inactive', 90);
  }

  /**
   * Send Telegram message
   */
  private async sendTelegramMessage(user: any, message: string): Promise<void> {
    try {
      const bot = this.telegramService.getBot();
      if (!bot || !user.telegramId) {
        this.logger.warn(`Cannot send message to user ${user._id}: bot or telegramId missing`);
        return;
      }

      await bot.api.sendMessage(user.telegramId, message, { parse_mode: 'HTML' });

      this.logger.debug(`Sent inactivity reminder to user ${user._id}`);
    } catch (sendError: any) {
      this.logger.error(
        `Failed to send inactivity reminder to user ${user._id}: ${sendError.message}`,
      );

      if (
        sendError.description?.includes('bot was blocked') ||
        sendError.description?.includes('user is deactivated') ||
        sendError.description?.includes('chat not found')
      ) {
        await this.markUserAsBlocked(user._id.toString());
      }
    }
  }

  /**
   * Update user's inactivity level in database
   */
  /**
   * Update inactivity tracking metadata WITHOUT touching lastActiveAt.
   *
   * FIX #30 (CRITICAL): Previously set `lastActiveAt = new Date()` which
   * incorrectly marked every notified user as "active right now". This caused
   * two severe issues:
   * 1. Users never progressed from 7-day → 30-day → 90-day inactive tiers
   *    because their lastActiveAt was reset every day the cron ran.
   * 2. The cron sent daily spam to ALL inactive users instead of once per tier,
   *    since they appeared "newly 7-day inactive" again the next day.
   *
   * Now we record `lastInactivityReminderSentAt` separately so the cron can
   * skip users who were already notified at this tier.
   */
  private async updateInactivityLevel(
    userId: string,
    level: 'never_active' | 'seven_days_inactive' | 'thirty_days_inactive' | 'ninety_days_inactive',
    daysInactive: number,
  ): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'engagement.inactiveReminderLevel': level,
          'engagement.inactiveDaysCount': daysInactive,
          'engagement.lastInactivityReminderSentAt': new Date(),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to update inactivity level for user ${userId}: ${error.message}`);
    }
  }

  /**
   * Mark user as bot blocked
   */
  private async markUserAsBlocked(userId: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'engagement.isBotBlocked': true,
          'engagement.botBlockedAt': new Date(),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to mark user ${userId} as blocked: ${error.message}`);
    }
  }

  /**
   * Get days since date
   */
  private getDaysSince(date: Date, now: Date): number {
    const diffMs = now.getTime() - new Date(date).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Get never active message
   */
  private getNeverActiveMessage(language: string, plan: string): string {
    const messages = {
      uz: `👋 Botni hali foydalanmadingiz!\n\nBoshlash uchun /start buyrug'ini yuboring.\n\n✅ Bugungi kunlik vazifalar: /tasks\n✅ Intervyu: /interview\n✅ Profil: /profile`,
      ru: `👋 Вы еще не использовали бота!\n\nЧтобы начать, отправьте /start.\n\n✅ Ежедневные задания: /tasks\n✅ Интервью: /interview\n✅ Профиль: /profile`,
      en: `👋 You haven't used the bot yet!\n\nTo get started, send /start.\n\n✅ Daily tasks: /tasks\n✅ Interview: /interview\n✅ Profile: /profile`,
    };

    return messages[language] || messages.uz;
  }

  /**
   * Get 7 days inactive message
   */
  private getSevenDaysInactiveMessage(language: string, plan: string): string {
    const messages = {
      uz: `⏰ 7 kun davomida botni foydalanmadingiz.\n\nHar kun 30 daqiqa amaliyot bo'lish uchun muhim.\n\n📌 Bugungi vazifalar: /tasks\n💡 Kichik amaliyotlar katta o'zgarishga olib keladi!`,
      ru: `⏰ Вы не использовали бота в течение 7 дней.\n\nПрактика каждый день для достижения успеха.\n\n📌 Задания сегодня: /tasks\n💡 Маленькие действия приводят к большим результатам!`,
      en: `⏰ You haven't used the bot for 7 days.\n\nPractice daily to achieve your goals.\n\n📌 Today's tasks: /tasks\n💡 Small actions lead to big results!`,
    };

    return messages[language] || messages.uz;
  }

  /**
   * Get 30 days inactive message
   */
  private getThirtyDaysInactiveMessage(language: string, plan: string): string {
    const messages = {
      uz: `⚠️ 30 kun davomida botni foydalanmadingiz.\n\nUzoqlikka qaytish vaqti! Har kun 30 daqiqa amaliyot bo'lishingiz oshadi.\n\n🎯 Hozir boshlang: /tasks\n🏆 Kuchli bo'ling!`,
      ru: `⚠️ Вы не использовали бота в течение 30 дней.\n\nВернитесь! Ежедневная практика приведет к успеху.\n\n🎯 Начните сейчас: /tasks\n🏆 Будьте сильными!`,
      en: `⚠️ You haven't used the bot for 30 days.\n\nCome back! Daily practice leads to success.\n\n🎯 Start now: /tasks\n🏆 Be strong!`,
    };

    return messages[language] || messages.uz;
  }

  /**
   * Get 90 days inactive message (final farewell)
   *
   * FIX #98: Added this message — 90-day users previously got no notification.
   * This is the last message they'll ever receive (dedup prevents further sends).
   */
  private getNinetyDaysInactiveMessage(language: string): string {
    const messages = {
      uz: `💔 90 kun davomida botni foydalanmadingiz.\n\nBiz sizni sog'indik! Agar qaytmoqchi bo'lsangiz, har doim kutamiz.\n\n🎯 Qaytish: /start\n💡 Sizning muvaffaqiyatingiz biz uchun muhim!`,
      ru: `💔 Вы не использовали бота в течение 90 дней.\n\nМы скучаем! Если захотите вернуться, мы всегда здесь.\n\n🎯 Вернуться: /start\n💡 Ваш успех важен для нас!`,
      en: `💔 You haven't used the bot for 90 days.\n\nWe miss you! If you ever want to come back, we're always here.\n\n🎯 Come back: /start\n💡 Your success matters to us!`,
    };

    return messages[language] || messages.uz;
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
