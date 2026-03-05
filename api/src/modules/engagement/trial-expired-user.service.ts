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
      uz: `Bepul sinov muddatingiz tugadi.\n\nDavom etish uchun rejalardan birini tanlang:\n\n<b>STARTER</b> — $5/oy\n• Kunlik topshiriqlar\n• 2 ta mock intervyu\n• 10 daqiqa ovozli javob\n• 5 ta CV tahlili\n\n<b>PRO</b> — $15/oy\n• 8 ta mock intervyu\n• 30 daqiqa ovozli javob\n• Haftalik AI tavsiyalar\n\n<b>ELITE</b> — $30/oy\n• Cheksiz mock intervyu\n• 2 ta kunlik topshiriq\n• Shaxsiy karyera rejasi\n\nBatafsil: /upgrade`,

      ru: `Пробный период закончился.\n\nВыберите план для продолжения:\n\n<b>STARTER</b> — $5/мес\n• Ежедневные задания\n• 2 mock-интервью\n• 10 мин голосовых ответов\n• 5 анализов CV\n\n<b>PRO</b> — $15/мес\n• 8 mock-интервью\n• 30 мин голосовых ответов\n• Еженедельные AI рекомендации\n\n<b>ELITE</b> — $30/мес\n• Безлимитные mock-интервью\n• 2 ежедневных задания\n• Персональный план карьеры\n\nПодробнее: /upgrade`,

      en: `Your free trial has ended.\n\nChoose a plan to continue:\n\n<b>STARTER</b> — $5/mo\n• Daily tasks\n• 2 mock interviews\n• 10 min voice responses\n• 5 CV analyses\n\n<b>PRO</b> — $15/mo\n• 8 mock interviews\n• 30 min voice responses\n• Weekly AI recommendations\n\n<b>ELITE</b> — $30/mo\n• Unlimited mock interviews\n• 2 daily tasks\n• Personal career roadmap\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getWeekExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `Sinov muddati tugaganiga bir hafta bo'ldi.\n\nStarter plan bilan nimalar qilasiz:\n• Har kuni AI savollar olasiz\n• 2 ta mock intervyu o'tkazasiz\n• Ovozli javoblaringiz tahlil qilinadi\n• CV ni 5 marta professional tahlil\n\n$5/oy dan boshlanadi.\n\nBatafsil: /upgrade`,

      ru: `Пробный период закончился неделю назад.\n\nЧто входит в Starter план:\n• Ежедневные AI вопросы\n• 2 mock-интервью в месяц\n• AI анализ голосовых ответов\n• 5 профессиональных анализов CV\n\nОт $5/мес.\n\nПодробнее: /upgrade`,

      en: `Your trial expired a week ago.\n\nWhat Starter plan includes:\n• Daily AI questions\n• 2 mock interviews per month\n• AI voice answer analysis\n• 5 professional CV analyses\n\nStarting from $5/mo.\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getTwoWeeksExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `Pro plan imkoniyatlari:\n\n• 8 ta mock intervyu/oy\n• 30 daqiqa ovozli mashq\n• Haftalik AI tavsiyalar\n• 15 ta CV tahlili\n\n$15/oy.\n\nBatafsil: /upgrade`,

      ru: `Возможности Pro плана:\n\n• 8 mock-интервью/мес\n• 30 мин голосовой практики\n• Еженедельные AI рекомендации\n• 15 анализов CV\n\n$15/мес.\n\nПодробнее: /upgrade`,

      en: `Pro plan features:\n\n• 8 mock interviews/mo\n• 30 min voice practice\n• Weekly AI recommendations\n• 15 CV analyses\n\n$15/mo.\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getMonthExpiredMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `Istalgan payt qaytishingiz mumkin.\n\nElite plan — to'liq tayyorgarlik:\n• Cheksiz mock intervyu\n• 2 ta kunlik topshiriq\n• 60 daqiqa ovozli mashq\n• Haftalik karyera rejasi\n• Shaxsiy AI coaching\n\n$30/oy.\n\nBatafsil: /upgrade`,

      ru: `Вы можете вернуться в любой момент.\n\nElite план — полная подготовка:\n• Безлимитные mock-интервью\n• 2 ежедневных задания\n• 60 мин голосовой практики\n• Еженедельный план карьеры\n• Персональный AI коучинг\n\n$30/мес.\n\nПодробнее: /upgrade`,

      en: `You can come back anytime.\n\nElite plan — complete preparation:\n• Unlimited mock interviews\n• 2 daily tasks\n• 60 min voice practice\n• Weekly career roadmap\n• Personal AI coaching\n\n$30/mo.\n\nDetails: /upgrade`,
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
