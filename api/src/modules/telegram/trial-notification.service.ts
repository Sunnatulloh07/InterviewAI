import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';

/**
 * Service for sending automatic trial expiry notifications
 * Runs daily at 10:00 AM Tashkent time to notify users about expiring trials
 */
@Injectable()
export class TrialNotificationService {
  private readonly logger = new Logger(TrialNotificationService.name);
  private bot: Bot | null = null;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {
    this.initBot();
  }

  /**
   * Initialize Telegram bot for sending notifications
   */
  private initBot(): void {
    const token = this.configService.get<string>('telegram.botToken');
    if (token) {
      this.bot = new Bot(token);
      this.logger.log('Trial notification bot initialized');
    } else {
      this.logger.warn('Telegram bot token not found, trial notifications disabled');
    }
  }

  /**
   * Daily cron job to check and notify users about expiring trials
   * Runs every day at 10:00 AM (Tashkent timezone UTC+5)
   */
  @Cron('0 10 * * *', {
    name: 'trial-expiry-notifications',
    timeZone: 'Asia/Tashkent',
  })
  async handleTrialExpiryNotifications(): Promise<void> {
    this.logger.log('Starting trial expiry notification job...');

    if (!this.bot) {
      this.logger.warn('Bot not initialized, skipping notifications');
      return;
    }

    try {
      // Get users with free_trial plan whose trial expires in 1, 2, or 3 days
      const now = new Date();
      const usersToNotify = await this.findUsersWithExpiringTrials(now);

      this.logger.log(`Found ${usersToNotify.length} users with expiring trials`);

      for (const user of usersToNotify) {
        await this.sendTrialExpiryNotification(user);
        // Small delay to avoid rate limiting
        await this.delay(100);
      }

      this.logger.log('Trial expiry notification job completed');
    } catch (error: any) {
      this.logger.error(`Trial notification job failed: ${error?.message}`, error?.stack);
    }
  }

  /**
   * Find users whose trial expires in 1, 2, or 3 days
   */
  private async findUsersWithExpiringTrials(now: Date): Promise<UserDocument[]> {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Calculate date ranges for 1, 2, 3 days from now
    const oneDayLater = new Date(today);
    oneDayLater.setDate(oneDayLater.getDate() + 1);
    
    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);
    
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    
    const fourDaysLater = new Date(today);
    fourDaysLater.setDate(fourDaysLater.getDate() + 4);

    // Find users with trial ending in 1, 2, or 3 days
    return this.userModel.find({
      'subscription.plan': 'free_trial',
      'subscription.trialEndsAt': {
        $gte: oneDayLater,
        $lt: fourDaysLater,
      },
      telegramId: { $exists: true, $ne: null },
      isDeleted: { $ne: true },
    }).exec();
  }

  /**
   * Send trial expiry notification to a user
   */
  private async sendTrialExpiryNotification(user: UserDocument): Promise<void> {
    if (!user.telegramId || !this.bot || !user.subscription?.trialEndsAt) return;

    try {
      const now = new Date();
      const trialEnd = new Date(user.subscription.trialEndsAt);
      const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Skip if not 1, 2, or 3 days remaining
      if (daysRemaining < 1 || daysRemaining > 3) return;

      // Check if we already sent notification today (using lastNotificationDate field)
      const lastNotif = (user as any).lastTrialNotificationDate;
      if (lastNotif) {
        const lastNotifDate = new Date(lastNotif);
        if (this.isSameDay(lastNotifDate, now)) {
          return; // Already notified today
        }
      }

      const lang = user.language || user.preferences?.language || 'uz';
      const message = this.getNotificationMessage(lang, daysRemaining);
      const keyboard = this.getUpgradeKeyboard(lang);

      await this.bot.api.sendMessage(user.telegramId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      // Update last notification date
      await this.userModel.updateOne(
        { _id: user._id },
        { $set: { lastTrialNotificationDate: now } }
      );

      this.logger.log(`Sent trial notification to user ${user.telegramId} (${daysRemaining} days left)`);
    } catch (error: any) {
      // User may have blocked the bot or deleted account
      if (error?.error_code === 403 || error?.error_code === 400) {
        this.logger.warn(`Cannot send to user ${user.telegramId}: ${error?.description}`);
      } else {
        this.logger.error(`Failed to notify user ${user.telegramId}: ${error?.message}`);
      }
    }
  }

  /**
   * Get notification message based on days remaining
   */
  private getNotificationMessage(lang: string, daysRemaining: number): string {
    const messages: Record<string, Record<number, string>> = {
      uz: {
        3: `⏰ <b>Sinov muddati tugashiga 3 kun qoldi!</b>

Sizning 7 kunlik bepul sinov muddatingiz 3 kun ichida tugaydi.

🔥 <b>Hoziroq yangilang va chegirmalardan foydalaning!</b>

💼 STARTER - $4.99/oy
🚀 PRO - $14.99/oy  
👑 ELITE - $29.99/oy

📞 Yangilash uchun @interviewai_support_bot ga murojaat qiling.`,
        2: `⚠️ <b>Sinov muddati tugashiga 2 kun qoldi!</b>

Sizning bepul sinov muddatingiz ertaga tugaydi!

⚡ <b>Hoziroq yangilang va intervyu tayyorgarligingizni davom ettiring!</b>

💡 /upgrade - Tariflarni ko'rish`,
        1: `🚨 <b>Sinov muddati bugun tugaydi!</b>

Sizning bepul sinov muddatingiz bugun tugaydi!

❗ <b>Intervyu tayyorgarligini to'xtatmaslik uchun hoziroq yangilang!</b>

📞 @interviewai_support_bot - Tez yangilash uchun`,
      },
      ru: {
        3: `⏰ <b>До конца пробного периода 3 дня!</b>

Ваш 7-дневный бесплатный период заканчивается через 3 дня.

🔥 <b>Обновитесь сейчас и получите скидку!</b>

💼 STARTER - $4.99/мес
🚀 PRO - $14.99/мес
👑 ELITE - $29.99/мес

📞 Для обновления: @interviewai_support_bot`,
        2: `⚠️ <b>До конца пробного периода 2 дня!</b>

Ваш бесплатный период заканчивается завтра!

⚡ <b>Обновитесь сейчас и продолжайте подготовку к интервью!</b>

💡 /upgrade - Посмотреть тарифы`,
        1: `🚨 <b>Пробный период заканчивается сегодня!</b>

Ваш бесплатный период заканчивается сегодня!

❗ <b>Обновитесь сейчас, чтобы продолжить подготовку!</b>

📞 @interviewai_support_bot - Быстрое обновление`,
      },
      en: {
        3: `⏰ <b>3 days left in your trial!</b>

Your 7-day free trial ends in 3 days.

🔥 <b>Upgrade now and get special discounts!</b>

💼 STARTER - $4.99/mo
🚀 PRO - $14.99/mo
👑 ELITE - $29.99/mo

📞 To upgrade: @interviewai_support_bot`,
        2: `⚠️ <b>2 days left in your trial!</b>

Your free trial ends tomorrow!

⚡ <b>Upgrade now and continue your interview preparation!</b>

💡 /upgrade - View plans`,
        1: `🚨 <b>Your trial ends today!</b>

Your free trial period ends today!

❗ <b>Upgrade now to keep preparing for interviews!</b>

📞 @interviewai_support_bot - Quick upgrade`,
      },
    };

    return messages[lang]?.[daysRemaining] || messages['en'][daysRemaining];
  }

  /**
   * Get upgrade keyboard
   */
  private getUpgradeKeyboard(lang: string): InlineKeyboard {
    const buttonTexts: Record<string, string> = {
      uz: '⬆️ Tariflarni ko\'rish',
      ru: '⬆️ Посмотреть тарифы',
      en: '⬆️ View Plans',
    };

    return new InlineKeyboard()
      .text(buttonTexts[lang] || buttonTexts['en'], 'show_plans')
      .row()
      .url('📞 Support', 'https://t.me/interviewai_support');
  }

  /**
   * Check if two dates are the same day
   */
  private isSameDay(date1: Date, date2: Date): boolean {
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing (can be called via API)
   */
  async triggerManualNotifications(): Promise<{ sent: number; failed: number }> {
    this.logger.log('Manually triggering trial notifications...');

    if (!this.bot) {
      throw new Error('Bot not initialized');
    }

    const now = new Date();
    const usersToNotify = await this.findUsersWithExpiringTrials(now);
    let sent = 0;
    let failed = 0;

    for (const user of usersToNotify) {
      try {
        await this.sendTrialExpiryNotification(user);
        sent++;
      } catch {
        failed++;
      }
      await this.delay(100);
    }

    return { sent, failed };
  }
}
