import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';

@Injectable()
export class TrialExpiredUserService {
  private readonly logger = new Logger(TrialExpiredUserService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
  ) {}

  @Cron('0 11 * * *', {
    name: 'trial-expired-user-engagement',
    timeZone: 'Asia/Tashkent',
  })
  async engageTrialExpiredUsers(): Promise<void> {
    try {
      const now = new Date();

      const expiredUsers = await this.userModel
        .find({
          'subscription.plan': 'free_trial',
          'subscription.status': { $in: ['expired', 'trialing'] },
          'subscription.trialEndsAt': { $lt: now },
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
        })
        .select('_id telegramId language subscription trialExpiredNotifiedAt')
        .lean();

      this.logger.log(`Found ${expiredUsers.length} trial expired users for engagement`);

      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const user of expiredUsers) {
        try {
          const daysSinceExpiry = user.trialExpiredNotifiedAt
            ? Math.floor((now.getTime() - new Date(user.trialExpiredNotifiedAt).getTime()) / (1000 * 60 * 60 * 24))
            : -1;

          if (daysSinceExpiry >= 0 && daysSinceExpiry < 7) {
            skipped++;
            continue;
          }

          const daysExpired = user.subscription.trialEndsAt
            ? Math.floor((now.getTime() - new Date(user.subscription.trialEndsAt).getTime()) / (1000 * 60 * 60 * 24))
            : 0;

          let message: string;
          const lang = user.language || 'uz';

          if (daysExpired <= 7) {
            message = this.getJustExpiredMessage(lang);
          } else if (daysExpired <= 14) {
            message = this.getWeekExpiredMessage(lang);
          } else if (daysExpired <= 30) {
            message = this.getTwoWeeksExpiredMessage(lang);
          } else {
            message = this.getMonthExpiredMessage(lang);
          }

          const bot = this.telegramService.getBot();
          if (bot && user.telegramId) {
            try {
              await bot.api.sendMessage(user.telegramId, message, {
                parse_mode: 'HTML',
              });

              await this.userModel.findByIdAndUpdate(user._id, {
                $set: { trialExpiredNotifiedAt: now },
              });

              sent++;
              this.logger.debug(`Sent trial expired message to user ${user._id} (${daysExpired} days expired)`);
            } catch (sendError: any) {
              const errorCode = sendError.error_code;
              const errorDescription = sendError.description || '';

              if (
                errorCode === 403 ||
                errorDescription.includes('bot was blocked') ||
                errorDescription.includes('user is deactivated') ||
                errorDescription.includes('chat not found')
              ) {
                await this.userModel.findByIdAndUpdate(user._id, {
                  $set: {
                    'engagement.isBotBlocked': true,
                    'engagement.botBlockedAt': now,
                  },
                });
                this.logger.warn(`User ${user._id} blocked bot`);
              } else {
                await this.retryService.trackFailedNotification(
                  user._id.toString(),
                  user.telegramId,
                  'trial_expiry',
                  errorDescription,
                  errorCode,
                  { daysExpired, userLanguage: lang, messageContent: message },
                );
                failed++;
              }
            }
          }

          await this.delay(200);
        } catch (userError: any) {
          this.logger.error(`Failed to process trial expired user ${user._id}: ${userError.message}`);
          failed++;
        }
      }

      this.logger.log(`Trial expired engagement: sent=${sent}, failed=${failed}, skipped=${skipped}`);
    } catch (error: any) {
      this.logger.error(`Trial expired engagement failed: ${error.message}`);
    }
  }

  private getJustExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `⏰ Sizning bepul sinov muddatingiz tugadi!

Afsuski, 7 kunlik bepul sinov muddatingiz tugagan.

🎯 Endi haqiqiy o'zgarishlar boshlanadi!

💼 STARTER - $4.99/oy
🚀 PRO - $14.99/oy
👑 ELITE - $29.99/oy

📞 Tez yangilash uchun: @interviewai_support_bot

💡 85% foydalanuvchilar Premiumga o'tganidan keyin 3 oy ichida ish topdi!`,

      ru: `⏰ Ваш пробный период закончился!

К сожалению, ваш 7-дневный бесплатный период истек.

🎯 Теперь начинаются реальные изменения!

💼 STARTER - $4.99/мес
🚀 PRO - $14.99/мес
👑 ELITE - $29.99/мес

📞 Быстрое обновление: @interviewai_support_bot

💡 85% пользователей нашли работу за 3 месяца после перехода на Premium!`,

      en: `⏰ Your free trial has expired!

Unfortunately, your 7-day free trial period has ended.

🎯 Now the real changes begin!

💼 STARTER - $4.99/mo
🚀 PRO - $14.99/mo
👑 ELITE - $29.99/mo

📞 Quick upgrade: @interviewai_support_bot

💡 85% of users found jobs within 3 months after upgrading to Premium!`,
    };

    return messages[lang] || messages.uz;
  }

  private getWeekExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `📉 Sinov muddatingiz tugaganiga 1 hafta bo'ldi

Intervyu tayyorgarligini to'xtatmang!

🔥 Maxsus taklif: 30% chegirma
⏰ Chegirma faqat 3 kun davom etadi

📞 @interviewai_support_bot - Batafsil

💪 Karyerangizni qo'llab-quvvatlang!`,

      ru: `📉 Пробный период закончился неделю назад

Не останавливайте подготовку к собеседованию!

🔥 Специальное предложение: скидка 30%
⏰ Скидка действует только 3 дня

📞 @interviewai_support_bot - Подробнее

💪 Поддержите свою карьеру!`,

      en: `📉 Your trial expired a week ago

Don't stop your interview preparation!

🔥 Special offer: 30% discount
⏰ Discount valid for only 3 days

📞 @interviewai_support_bot - Details

💪 Support your career!`,
    };

    return messages[lang] || messages.uz;
  }

  private getTwoWeeksExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `🎯 Interview tayyorgarligini davom ettiring!

Sinov muddatingiz tugaganiga 2 hafta bo'ldi.

💡 Yangi takliflar:
✅ Haftalik 1 ta BEPUL mock interview
✅ Telegram kanalimizda bepul maslahatlar
✅ Tez-tez so'raladigan savollar

📢 Kanalimizga qo'shiling: @interviewai_uz

🚀 Karyerangiz uchun bir qadam!`,

      ru: `🎯 Продолжайте подготовку к собеседованию!

Пробный период закончился 2 недели назад.

💡 Новые предложения:
✅ 1 БЕСПЛАТНОЕ mock интервью в неделю
✅ Бесплатные советы в нашем Telegram канале
✅ Часто задаваемые вопросы

📢 Присоединяйтесь к каналу: @interviewai_uz

🚀 Шаг для вашей карьеры!`,

      en: `🎯 Continue your interview preparation!

Your trial expired 2 weeks ago.

💡 New offers:
✅ 1 FREE mock interview per week
✅ Free tips in our Telegram channel
✅ Frequently asked questions

📢 Join our channel: @interviewai_uz

🚀 A step for your career!`,
    };

    return messages[lang] || messages.uz;
  }

  private getMonthExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `👋 InterviewAI Pro bilan xayrlashishmi?

Sinov muddatingiz tugaganiga 1 oy bo'ldi.

🎯 Agar siz biz bilan qolishni xohlasangiz:
• Maxsus chegirma - 50%
• Cheksiz mock interviews
• 24/7 AI yordamchisi

📞 @interviewai_support_bot

💪 Siz muvaffaqiyatga erishishingiz mumkin!`,

      ru: `👋 Прощаться с InterviewAI Pro?

Пробный период закончился месяц назад.

🎯 Если хотите остаться с нами:
• Специальная скидка - 50%
• Неограниченные mock интервью
• AI помощник 24/7

📞 @interviewai_support_bot

💪 Вы можете достичь успеха!`,

      en: `👋 Say goodbye to InterviewAI Pro?

Your trial expired a month ago.

🎯 If you want to stay with us:
• Special discount - 50%
• Unlimited mock interviews
• 24/7 AI assistant

📞 @interviewai_support_bot

💪 You can achieve success!`,
    };

    return messages[lang] || messages.uz;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStats(): Promise<{
    totalExpired: number;
    notified7Days: number;
    notified14Days: number;
    notified30Days: number;
  }> {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [totalExpired, notified7Days, notified14Days, notified30Days] = await Promise.all([
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $lt: now },
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $lt: now },
          trialExpiredNotifiedAt: { $gte: sevenDaysAgo },
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $lt: now },
          trialExpiredNotifiedAt: { $gte: fourteenDaysAgo },
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'subscription.trialEndsAt': { $lt: now },
          trialExpiredNotifiedAt: { $gte: thirtyDaysAgo },
        }),
      ]);

      return { totalExpired, notified7Days, notified14Days, notified30Days };
    } catch (error: any) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      return { totalExpired: 0, notified7Days: 0, notified14Days: 0, notified30Days: 0 };
    }
  }
}
