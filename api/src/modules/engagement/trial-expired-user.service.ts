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

  /**
   * POST-TRIAL ENGAGEMENT SYSTEM
   *
   * Schedule:
   * - Days 1-30 after trial expiry: Daily at 10:00 Tashkent (different message each day)
   * - Days 31+: Every 3 days
   * - NEVER send to bot-blocked or notification-paused users
   *
   * Message rotation: daysExpired % 4 ensures varied content each day
   */
  // 10:25 — staggered after trial-expiry-notifications (10:20) to avoid DB collision.
  @Cron('25 10 * * *', {
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

      this.logger.log(`Found ${expiredUsers.length} trial expired users for post-trial engagement`);

      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const user of expiredUsers) {
        try {
          const daysExpired = user.subscription.trialEndsAt
            ? Math.floor(
                (now.getTime() - new Date(user.subscription.trialEndsAt).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0;

          // FIX #35: The original logic sent a notification EVERY DAY for 30
          // consecutive days after trial expiry — this is spam and causes a high
          // bot-block rate.  Replaced with a milestone-based schedule:
          //   Day 1, 3, 7, 14, 30 — only 5 messages total in the first month.
          //   After day 30: one message every 14 days (twice a month max).
          //
          // This dramatically reduces notification fatigue while still keeping
          // the user engaged at key decision points.
          const MILESTONE_DAYS = [1, 3, 7, 14, 30];
          const isOnMilestone = MILESTONE_DAYS.includes(daysExpired);

          if (daysExpired <= 30 && !isOnMilestone) {
            skipped++;
            continue;
          }

          if (user.trialExpiredNotifiedAt) {
            const daysSinceLastNotify = Math.floor(
              (now.getTime() - new Date(user.trialExpiredNotifiedAt).getTime()) /
                (1000 * 60 * 60 * 24),
            );

            // Days 1-30: skip if notified less than 1 day ago (safety check)
            if (daysExpired <= 30 && daysSinceLastNotify < 1) {
              skipped++;
              continue;
            }

            // Days 31+: send every 14 days (twice a month)
            if (daysExpired > 30 && daysSinceLastNotify < 14) {
              skipped++;
              continue;
            }
          }

          const lang = user.language || 'uz';

          // Rotate through 4 message themes based on day number
          const messageIndex = daysExpired % 4;
          let message: string;
          switch (messageIndex) {
            case 0:
              message = this.getJustExpiredMessage(lang);
              break;
            case 1:
              message = this.getWeekExpiredMessage(lang);
              break;
            case 2:
              message = this.getTwoWeeksExpiredMessage(lang);
              break;
            case 3:
              message = this.getMonthExpiredMessage(lang);
              break;
            default:
              message = this.getJustExpiredMessage(lang);
          }

          const bot = this.telegramService.getBot();
          if (bot && user.telegramId) {
            try {
              await bot.api.sendMessage(user.telegramId, message, {
                parse_mode: 'HTML',
              });

              await this.userModel.findByIdAndUpdate(user._id, {
                $set: {
                  trialExpiredNotifiedAt: now,
                  // Shared daily cap field: prevents other crons sending another msg today
                  'engagement.lastNotificationSentAt': now,
                },
              });

              sent++;
              this.logger.debug(
                `Sent post-trial message to user ${user._id} (day ${daysExpired}, theme ${messageIndex})`,
              );
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
                this.logger.warn(`User ${user._id} blocked bot - stopping all messages`);
              } else {
                await this.retryService.trackFailedNotification(
                  user._id.toString(),
                  user.telegramId,
                  'trial_expiry',
                  errorDescription,
                  errorCode,
                  { daysExpired, userLanguage: lang },
                );
                failed++;
              }
            }
          }

          await this.delay(200);
        } catch (userError: any) {
          this.logger.error(
            `Failed to process trial expired user ${user._id}: ${userError.message}`,
          );
          failed++;
        }
      }

      this.logger.log(
        `Post-trial engagement: sent=${sent}, failed=${failed}, skipped=${skipped}`,
      );
    } catch (error: any) {
      this.logger.error(`Post-trial engagement failed: ${error.message}`);
    }
  }

  private getJustExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `⏰ Sizning 7 kunlik bepul sinov muddatingiz tugadi!

🎯 Premium bilan nimalar olasiz:

💼 <b>STARTER</b> - $10/oy
• Kunlik savol va topshiriqlar
• 10 ta mock interview/oy
• 10 daqiqa ovozli javoblar
• 5 ta CV tahlili

🚀 <b>PRO</b> - $20/oy
• 30 ta mock interview/oy
• 30 daqiqa ovozli javoblar
• Haftalik AI tavsiyalar

👑 <b>ELITE</b> - $30/oy
• Cheksiz mock interview
• 2 ta kunlik topshiriq
• Shaxsiy karyera rejasi

Rejalarni ko'rish: /upgrade`,

      ru: `⏰ Ваш 7-дневный пробный период закончился!

🎯 Что вы получите с Premium:

💼 <b>STARTER</b> - $10/мес
• Ежедневные вопросы и задания
• 10 mock интервью/мес
• 10 минут голосовых ответов
• 5 анализов CV

🚀 <b>PRO</b> - $20/мес
• 30 mock интервью/мес
• 30 минут голосовых ответов
• Еженедельные AI рекомендации

👑 <b>ELITE</b> - $30/мес
• Безлимит mock интервью
• 2 ежедневных задания
• Персональный план карьеры

Смотреть планы: /upgrade`,

      en: `⏰ Your 7-day free trial has expired!

🎯 What you get with Premium:

💼 <b>STARTER</b> - $10/mo
• Daily questions and tasks
• 10 mock interviews/mo
• 10 minutes voice responses
• 5 CV analyses

🚀 <b>PRO</b> - $20/mo
• 30 mock interviews/mo
• 30 minutes voice responses
• Weekly AI recommendations

👑 <b>ELITE</b> - $30/mo
• Unlimited mock interviews
• 2 daily tasks
• Personal career roadmap

View plans: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getWeekExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `📉 Sinov muddatingiz tugaganiga 1 hafta bo'ldi

Intervyu tayyorgarligini to'xtatmang!

🎯 Starter plan bilan nimalar qilasiz:
• Har kuni AI tomonidan savollar olasiz
• 10 ta mock interview o'tkazasiz
• Ovozli javoblaringizni AI tahlil qiladi
• CV ingizni 5 marta professional tahlil

💼 Faqat $10/oy dan boshlanadi

Rejalarni ko'rish: /upgrade`,

      ru: `📉 Пробный период закончился неделю назад

Не останавливайте подготовку!

🎯 Что вы получите со Starter планом:
• Ежедневные AI вопросы
• 10 mock интервью в месяц
• AI анализ голосовых ответов
• 5 профессиональных анализов CV

💼 Всего от $10/мес

Смотреть планы: /upgrade`,

      en: `📉 Your trial expired a week ago

Don't stop your preparation!

🎯 What you get with Starter plan:
• Daily AI questions
• 10 mock interviews per month
• AI voice answer analysis
• 5 professional CV analyses

💼 Starting from just $10/mo

View plans: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getTwoWeeksExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `🎯 Intervyu tayyorgarligini davom ettiring!

💡 Pro plan imkoniyatlari:
• 30 ta mock interview/oy
• 30 daqiqa ovozli mashq
• Haftalik AI tavsiyalar
• Kunlik progress tracking
• 15 ta CV tahlili

🚀 Faqat $20/oy - kuniga 700 so'mdan kam!

Rejalarni ko'rish: /upgrade`,

      ru: `🎯 Продолжайте подготовку к собеседованию!

💡 Возможности Pro плана:
• 30 mock интервью/мес
• 30 минут голосовой практики
• Еженедельные AI рекомендации
• Ежедневный прогресс
• 15 анализов CV

🚀 Всего $20/мес - меньше 700 сум в день!

Смотреть планы: /upgrade`,

      en: `🎯 Continue your interview preparation!

💡 Pro plan features:
• 30 mock interviews/mo
• 30 min voice practice
• Weekly AI recommendations
• Daily progress tracking
• 15 CV analyses

🚀 Just $20/mo - less than $0.67/day!

View plans: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getMonthExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `👋 Biz hali ham shu yerdamiz!

🎯 Elite plan - professional daraja:
• Cheksiz mock interview
• 2 ta kunlik topshiriq
• 60 daqiqa ovozli mashq
• Haftalik karyera rejasi
• Shaxsiy AI coaching
• Cheksiz CV tahlili

👑 $30/oy - intervyuga to'liq tayyorgarlik

Rejalarni ko'rish: /upgrade`,

      ru: `👋 Мы все ещё здесь!

🎯 Elite план - профессиональный уровень:
• Безлимит mock интервью
• 2 ежедневных задания
• 60 минут голосовой практики
• Еженедельный план карьеры
• Персональный AI коучинг
• Безлимит анализ CV

👑 $30/мес - полная подготовка к интервью

Смотреть планы: /upgrade`,

      en: `👋 We're still here!

🎯 Elite plan - professional level:
• Unlimited mock interviews
• 2 daily tasks
• 60 minutes voice practice
• Weekly career roadmap
• Personal AI coaching
• Unlimited CV analyses

👑 $30/mo - complete interview preparation

View plans: /upgrade`,
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
