import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { InlineKeyboard } from 'grammy';
import { TelegramService } from './telegram.service';
import { getTashkentMidnight } from '../../common/utils/tashkent-time';

/**
 * Service for sending automatic trial expiry notifications
 * Runs daily at 10:00 AM Tashkent time to notify users about expiring trials
 *
 * FIX #94 + #97: Uses shared TelegramService.getBot() instead of creating
 * a separate Bot instance. Creating a second Bot(token) caused:
 * 1. Two bot instances hitting Telegram API = faster rate limiting
 * 2. Potential webhook/polling conflicts
 * 3. Inconsistent Bot type (Bot vs Bot<BotContext>)
 */
@Injectable()
export class TrialNotificationService {
  private readonly logger = new Logger(TrialNotificationService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Daily cron job to check and notify users about expiring trials.
   * Runs at 10:20 Tashkent (staggered to avoid DB collision at 10:00).
   */
  @Cron('20 10 * * *', {
    name: 'trial-expiry-notifications',
    timeZone: 'Asia/Tashkent',
  })
  async handleTrialExpiryNotifications(): Promise<void> {
    this.logger.log('Starting trial expiry notification job...');

    try {
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
   * CRITICAL: Only properly registered users with active trials
   */
  private async findUsersWithExpiringTrials(now: Date): Promise<UserDocument[]> {
    // FIX #101: Use Tashkent midnight instead of server local midnight
    // All other services use getTashkentMidnight() — this must be consistent
    const today = getTashkentMidnight();

    // Calculate date ranges for 1, 2, 3 days from now
    const oneDayLater = new Date(today);
    oneDayLater.setDate(oneDayLater.getDate() + 1);

    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);

    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const fourDaysLater = new Date(today);
    fourDaysLater.setDate(fourDaysLater.getDate() + 4);

    // CRITICAL: Find only properly registered users with ACTIVE trials
    return this.userModel
      .find({
        // Must have active trial (not expired, not cancelled)
        'subscription.plan': 'free_trial',
        'subscription.status': 'trialing', // ⭐ CRITICAL: Only active trials!
        'subscription.trialEndsAt': {
          $gte: oneDayLater,
          $lt: fourDaysLater,
        },
        // Must be properly registered user
        telegramId: { $exists: true, $ne: null },
        firstName: { $exists: true, $ne: null }, // Has completed registration
        phoneNumber: { $exists: true, $ne: null }, // Has phone number
        phoneVerified: true, // Phone is verified
        // Must not be deleted or blocked
        isDeleted: { $ne: true },
        'engagement.isBotBlocked': { $ne: true },
      })
      .exec();
  }

  /**
   * Send trial expiry notification to a user
   * PERSONALIZED: Based on user activity during trial
   */
  private async sendTrialExpiryNotification(user: UserDocument): Promise<void> {
    const bot = this.telegramService.getBot();
    if (!user.telegramId || !bot || !user.subscription?.trialEndsAt) return;

    try {
      const now = new Date();
      const trialEnd = new Date(user.subscription.trialEndsAt);
      const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Skip if not 1, 2, or 3 days remaining
      if (daysRemaining < 1 || daysRemaining > 3) return;

      // FIX #100: Use Tashkent timezone for same-day check instead of server local timezone
      const lastNotif = (user as any).lastTrialNotificationDate;
      if (lastNotif) {
        const lastNotifDate = new Date(lastNotif);
        if (this.isSameDayTashkent(lastNotifDate, now)) {
          return; // Already notified today (Tashkent time)
        }
      }

      const lang = user.language || user.preferences?.language || 'uz';

      // Get user activity metrics for personalization
      const mockInterviews = user.usage?.mockInterviewsThisMonth || 0;
      const cvAnalyses = user.usage?.cvAnalysesThisMonth || 0;
      const hasActivity = mockInterviews > 0 || cvAnalyses > 0;

      // Generate personalized message based on activity
      const message = this.getPersonalizedNotificationMessage(
        lang,
        daysRemaining,
        user.firstName || 'Foydalanuvchi',
        mockInterviews,
        cvAnalyses,
        hasActivity,
      );

      const keyboard = this.getUpgradeKeyboard(lang);

      await bot.api.sendMessage(user.telegramId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      // Update last notification date + shared daily cap
      await this.userModel.updateOne(
        { _id: user._id },
        {
          $set: {
            lastTrialNotificationDate: now,
            // Shared daily cap: prevents AI engagement cron sending another msg same day
            'engagement.lastNotificationSentAt': now,
          },
        },
      );

      this.logger.log(
        `Sent trial notification to user ${user.telegramId} (${daysRemaining} days left, activity: ${hasActivity ? 'active' : 'inactive'})`,
      );
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
        3: `⏰ <b>3 kun qoldi!</b>

Sizning bepul sinov muddatingiz tugaydi. Yetarlicha mashq qildingizmi?

💡 <b>Hoziroq yangilang va o'z yo'lingizni davom ettiring:</b>

💎 STARTER — $5/oy
🚀 PRO — $15/oy  
👑 ELITE — $30/oy

📞 @interviewai_support_bot`,
        2: `⏰ <b>2 kun qoldi!</b>

Ertaga sinov muddatingiz tugaydi. Tayyorgarligingizni uzatmang.

💡 <b>Hoziroq yangilang:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
        1: `🚨 <b>Bugun so'ngi kun!</b>

Sinov muddatingiz bugun tugaydi. Yangilashni unutmang!

⚡ <b>Hoziroq yangilang va davom eting:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
      },
      ru: {
        3: `⏰ <b>Осталось 3 дня!</b>

Ваш пробный период заканчивается. Достаточно ли вы потренировались?

💡 <b>Обновитесь сейчас и продолжайте свой путь:</b>

💎 STARTER — $5/мес
🚀 PRO — $15/мес
👑 ELITE — $30/мес

📞 @interviewai_support_bot`,
        2: `⏰ <b>Осталось 2 дня!</b>

Завтра заканчивается пробный период. Не прерывайте подготовку.

💡 <b>Обновитесь сейчас:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
        1: `🚨 <b>Последний день!</b>

Пробный период заканчивается сегодня. Не забудьте обновиться!

⚡ <b>Обновитесь сейчас и продолжайте:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
      },
      en: {
        3: `⏰ <b>3 days left!</b>

Your trial is ending. Have you practiced enough?

💡 <b>Upgrade now and continue your journey:</b>

💎 STARTER — $5/mo
🚀 PRO — $15/mo
👑 ELITE — $30/mo

📞 @interviewai_support_bot`,
        2: `⏰ <b>2 days left!</b>

Trial ends tomorrow. Don't stop your preparation.

💡 <b>Upgrade now:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
        1: `🚨 <b>Last day!</b>

Trial ends today. Don't forget to upgrade!

⚡ <b>Upgrade now and continue:</b>
💎 STARTER — $5 | 🚀 PRO — $15 | 👑 ELITE — $30

📞 @interviewai_support_bot`,
      },
    };

    return messages[lang]?.[daysRemaining] || messages['en'][daysRemaining];
  }

  /**
   * Get PERSONALIZED notification message based on user activity
   * Professional marketing copy for different user segments
   */
  private getPersonalizedNotificationMessage(
    lang: string,
    daysRemaining: number,
    firstName: string,
    mockInterviews: number,
    cvAnalyses: number,
    hasActivity: boolean,
  ): string {
    // ACTIVE USERS - Have used the platform
    if (hasActivity) {
      return this.getActiveUserMessage(lang, daysRemaining, firstName, mockInterviews, cvAnalyses);
    }

    // INACTIVE USERS - Haven't used the platform
    return this.getInactiveUserMessage(lang, daysRemaining, firstName);
  }

  /**
   * Message for ACTIVE users (used mock interviews or CV analysis)
   */
  private getActiveUserMessage(
    lang: string,
    daysRemaining: number,
    firstName: string,
    mockInterviews: number,
    cvAnalyses: number,
  ): string {
    const activityText =
      mockInterviews > 0 ? `${mockInterviews} ta mock intervyu` : `${cvAnalyses} ta CV tahlili`;

    const messages: Record<string, Record<number, string>> = {
      uz: {
        3: `👋 Salom ${firstName}!

Siz sinov davrida ${activityText} ishlatdingiz — juda yaxshi natija! ⭐

⏰ <b>Sinov muddatingiz 3 kun ichida tugaydi.</b>

Agar bu imkoniyatdan to'liq foydalangan bo'lsangiz, tayyorgarligingizni uzatishni xohlamaysiz, to'g'rimi?

💡 <b>STARTER tarifi bilan davom eting:</b>
• 2 ta mock intervyu/oy
• 10 daqiqa ovozli yordam
• CV tahlili va kunlik vazifalar

💎 Faqat <b>$5/oy</b> — bir kofe narxi!

👇 Tariflarni ko'rish uchun tugmani bosing:`,
        2: `⚡ ${firstName}, sinov muddatingiz ertaga tugaydi!

Siz allaqachon platformadan foydalanyapsiz — ${activityText} ishlatdingiz.

🔥 <b>O'z natijangizni uzatmang!</b>

Yangilash orqali:
✅ Cheksiz intervyu imkoniyatlari
✅ Professional AI yordamchisi
✅ Karyerangizda yangi bosqich

💎 STARTER — $5/oy
🚀 PRO — $15/oy  

👇 Hoziroq yangilang:`,
        1: `🚨 ${firstName}, BUGUN so'ngi kun!

Sinov muddatingiz bugun soat 23:59 da tugaydi.

⏰ <b>Oxirgi imkoniyat!</b>

Siz allaqachon ${activityText} ishlatdingiz — endi bu imkoniyatlarni yo'qotishni xohlamaysiz.

⚡ <b>Hoziroq yangilang:</b>
• STARTER — $5
• PRO — $15
• ELITE — $30

📞 Savollar bormi? @interviewai_support_bot

👇 Hoziroq tugmani bosing:`,
      },
      ru: {
        3: `👋 Привет ${firstName}!

За пробный период вы использовали ${activityText} — отличный результат! ⭐

⏰ <b>Пробный период заканчивается через 3 дня.</b>

Если вы уже ощутили пользу платформы, не хотите же прерывать подготовку?

💡 <b>Продолжите с тарифом STARTER:</b>
• 2 mock-интервью/мес
• 10 минут голосовой помощи
• Анализ резюме и ежедневные задания

💎 Всего <b>$5/мес</b> — цена одного кофе!

👇 Нажмите кнопку для просмотра тарифов:`,
        2: `⚡ ${firstName}, пробный период заканчивается завтра!

Вы уже активно используете платформу — ${activityText}.

🔥 <b>Не останавливайтесь на пути к цели!</b>

С обновлением:
✅ Безлимитные возможности
✅ Профессиональный AI-помощник
✅ Новый уровень карьеры

💎 STARTER — $5/мес
🚀 PRO — $15/мес

👇 Обновитесь сейчас:`,
        1: `🚨 ${firstName}, СЕГОДНЯ последний день!

Пробный период заканчивается сегодня в 23:59.

⏰ <b>Последний шанс!</b>

Вы уже использовали ${activityText} — не теряйте эти возможности.

⚡ <b>Обновитесь сейчас:</b>
• STARTER — $5
• PRO — $15
• ELITE — $30

📞 Вопросы? @interviewai_support_bot

👇 Нажмите кнопку:`,
      },
      en: {
        3: `👋 Hi ${firstName}!

During your trial, you used ${activityText} — great progress! ⭐

⏰ <b>Your trial ends in 3 days.</b>

If you've already experienced the value, you don't want to stop your preparation, right?

💡 <b>Continue with STARTER:</b>
• 2 mock interviews/month
• 10 minutes voice assistance
• CV analysis & daily tasks

💎 Only <b>$5/mo</b> — price of a coffee!

👇 Click to view plans:`,
        2: `⚡ ${firstName}, your trial ends tomorrow!

You're already actively using the platform — ${activityText} completed.

🔥 <b>Don't stop on your way to success!</b>

With upgrade:
✅ Unlimited opportunities
✅ Professional AI assistant
✅ New career level

💎 STARTER — $5/mo
🚀 PRO — $15/mo

👇 Upgrade now:`,
        1: `🚨 ${firstName}, TODAY is the last day!

Your trial ends today at 23:59.

⏰ <b>Final chance!</b>

You've already used ${activityText} — don't lose these opportunities.

⚡ <b>Upgrade now:</b>
• STARTER — $5
• PRO — $15
• ELITE — $30

📞 Questions? @interviewai_support_bot

👇 Click the button:`,
      },
    };

    return messages[lang]?.[daysRemaining] || messages['en'][daysRemaining];
  }

  /**
   * Message for INACTIVE users (haven't used the platform)
   */
  private getInactiveUserMessage(lang: string, daysRemaining: number, firstName: string): string {
    const messages: Record<string, Record<number, string>> = {
      uz: {
        3: `👋 Salom ${firstName}!

Sinov muddatingiz 3 kun ichida tugaydi, lekin siz hali platformadan to'liq foydalanmadingiz.

🎯 <b>Imkoniyatni qo'ldan boy bermang!</b>

Bepul sinov davrida siz:
✅ 1 ta mock intervyu
✅ 1 ta CV tahlili
✅ AI yordamchisi (matn javoblari)

💡 Hoziroq boshlang va karyerangizni o'zgartiring!

👇 Intervyu boshlash: /interview`,
        2: `⏰ ${firstName}, sinov muddatingiz ertaga tugaydi!

Siz hali platformadan foydalanmadingiz — imkoniyatni boy bermang.

🔥 <b>Oxirgi imkoniyat!</b>

Bepul sinov imkoniyatlaridan foydalanib qoling:
• Mock intervyular
• AI yordamchisi
• CV tahlili

👇 Hoziroq sinab ko'ring: /interview`,
        1: `🚨 ${firstName}, BUGUN so'ngi kun!

Sinov muddatingiz bugun tugaydi va siz hali platformadan foydalanmadingiz.

⏰ <b>Oxirgi 24 soat!</b>

Hoziroq sinab ko'ring — bu sizning karyerangizni o'zgartirishi mumkin!

👇 Boshlash: /interview

💡 Yoki yangilang va cheksiz imkoniyatlarga ega bo'ling!`,
      },
      ru: {
        3: `👋 Привет ${firstName}!

Пробный период заканчивается через 3 дня, но вы ещё не использовали платформу.

🎯 <b>Не упустите возможность!</b>

В пробный период доступно:
✅ 1 mock-интервью
✅ 1 анализ резюме
✅ AI помощник (текстовые ответы)

💡 Начните сейчас и измените свою карьеру!

👇 Начать интервью: /interview`,
        2: `⏰ ${firstName}, пробный период заканчивается завтра!

Вы ещё не пробовали платформу — не упустите шанс.

🔥 <b>Последний шанс!</b>

Воспользуйтесь бесплатным пробным периодом:
• Mock-интервью
• AI-помощник
• Анализ резюме

👇 Попробуйте сейчас: /interview`,
        1: `🚨 ${firstName}, СЕГОДНЯ последний день!

Пробный период заканчивается сегодня, а вы ещё не попробовали платформу.

⏰ <b>Последние 24 часа!</b>

Попробуйте сейчас — это может изменить вашу карьеру!

👇 Начать: /interview

💡 Или обновитесь и получите безлимитные возможности!`,
      },
      en: {
        3: `👋 Hi ${firstName}!

Your trial ends in 3 days, but you haven't fully used the platform yet.

🎯 <b>Don't miss this opportunity!</b>

During free trial you get:
✅ 1 mock interview
✅ 1 CV analysis
✅ AI assistant (text answers only)

💡 Start now and transform your career!

👇 Start interview: /interview`,
        2: `⏰ ${firstName}, your trial ends tomorrow!

You haven't tried the platform yet — don't miss this chance.

🔥 <b>Last chance!</b>

Use your free trial opportunities:
• Mock interviews
• AI assistant
• CV analysis

👇 Try now: /interview`,
        1: `🚨 ${firstName}, TODAY is the last day!

Your trial ends today and you haven't tried the platform yet.

⏰ <b>Final 24 hours!</b>

Try now — it could transform your career!

👇 Start: /interview

💡 Or upgrade for unlimited features!`,
      },
    };

    return messages[lang]?.[daysRemaining] || messages['en'][daysRemaining];
  }

  /**
   * Get upgrade keyboard
   */
  private getUpgradeKeyboard(lang: string): InlineKeyboard {
    const buttonTexts: Record<string, string> = {
      uz: "⬆️ Tariflarni ko'rish",
      ru: '⬆️ Посмотреть тарифы',
      en: '⬆️ View Plans',
    };

    return new InlineKeyboard()
      .text(buttonTexts[lang] || buttonTexts['en'], 'show_plans')
      .row()
      .url('📞 Support', 'https://t.me/interviewai_support');
  }

  /**
   * Check if two dates are the same day in Tashkent timezone (UTC+5)
   *
   * FIX #100: Previously used server local timezone (getFullYear/getMonth/getDate)
   * which could cause duplicate sends or missed sends when server is in UTC.
   * Now converts both dates to Tashkent date strings for accurate comparison.
   */
  private isSameDayTashkent(date1: Date, date2: Date): boolean {
    const tashkentOptions: Intl.DateTimeFormatOptions = {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    const d1 = date1.toLocaleDateString('en-CA', tashkentOptions); // YYYY-MM-DD format
    const d2 = date2.toLocaleDateString('en-CA', tashkentOptions);
    return d1 === d2;
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
