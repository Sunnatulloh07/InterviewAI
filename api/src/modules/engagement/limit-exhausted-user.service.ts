import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
import { getTashkentMidnight } from '@common/utils/tashkent-time';

@Injectable()
export class LimitExhaustedUserService {
  private readonly logger = new Logger(LimitExhaustedUserService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
  ) {}

  @Cron('0 12 * * *', {
    name: 'limit-exhausted-user-engagement',
    timeZone: 'Asia/Tashkent',
  })
  async engageLimitExhaustedUsers(): Promise<void> {
    try {
      const now = new Date();

      const startOfToday = getTashkentMidnight(now);

      const usersWithExhaustedLimits = await this.userModel
        .find({
          'subscription.plan': 'free_trial',
          'subscription.status': { $in: ['trialing', 'expired'] },
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          // Shared daily cap: skip if ANY notification was sent today (trial-expired,
          // inactivity, etc. may have already sent at 10:xx — don't double-notify at 12:00)
          $and: [
            {
              $or: [
                { 'engagement.lastNotificationSentAt': { $exists: false } },
                { 'engagement.lastNotificationSentAt': null },
                { 'engagement.lastNotificationSentAt': { $lt: startOfToday } },
              ],
            },
            {
              $or: [
                // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
                { 'usage.mockInterviewsThisMonth': { $gte: 1 } },
                { 'voiceQuota.mockVoice.remaining': 0 },
              ],
            },
          ],
        })
        .select('_id telegramId language usage voiceQuota limitExhaustedNotifiedAt subscription engagement')
        .lean();

      this.logger.log(`Found ${usersWithExhaustedLimits.length} users with exhausted limits`);

      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const user of usersWithExhaustedLimits) {
        try {
          const lastNotified = user.limitExhaustedNotifiedAt;
          const daysSinceLastNotify = lastNotified
            ? Math.floor((now.getTime() - new Date(lastNotified).getTime()) / (1000 * 60 * 60 * 24))
            : 999;

          if (daysSinceLastNotify < 3) {
            skipped++;
            continue;
          }

          const mockInterviewsUsed = user.usage?.mockInterviewsThisMonth || 0;
          const voiceMinutesRemaining = user.voiceQuota?.mockVoice?.remaining || 0;
          // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
          const isMockExhausted = mockInterviewsUsed >= 1;
          const isVoiceExhausted = voiceMinutesRemaining === 0;

          const lang = user.language || 'uz';
          let message: string;

          if (isMockExhausted && isVoiceExhausted) {
            message = this.getBothExhaustedMessage(lang, mockInterviewsUsed);
          } else if (isMockExhausted) {
            message = this.getMockExhaustedMessage(lang, mockInterviewsUsed);
          } else if (isVoiceExhausted) {
            message = this.getVoiceExhaustedMessage(lang);
          } else {
            skipped++;
            continue;
          }

          const bot = this.telegramService.getBot();
          if (bot && user.telegramId) {
            try {
              await bot.api.sendMessage(user.telegramId, message, {
                parse_mode: 'HTML',
              });

              await this.userModel.findByIdAndUpdate(user._id, {
                $set: {
                  limitExhaustedNotifiedAt: now,
                  // Shared daily cap: prevents AI engagement cron sending another msg today
                  'engagement.lastNotificationSentAt': now,
                },
              });

              sent++;
              this.logger.debug(`Sent limit exhausted message to user ${user._id}`);
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
                  'limit_exhausted',
                  errorDescription,
                  errorCode,
                  {
                    mockExhausted: isMockExhausted,
                    voiceExhausted: isVoiceExhausted,
                    userLanguage: lang,
                    messageContent: message,
                  },
                );
                failed++;
              }
            }
          }

          await this.delay(200);
        } catch (userError: any) {
          this.logger.error(
            `Failed to process limit exhausted user ${user._id}: ${userError.message}`,
          );
          failed++;
        }
      }

      this.logger.log(
        `Limit exhausted engagement: sent=${sent}, failed=${failed}, skipped=${skipped}`,
      );
    } catch (error: any) {
      this.logger.error(`Limit exhausted engagement failed: ${error.message}`);
    }
  }

  private getMockExhaustedMessage(lang: string, usedCount: number): string {
    const messages: Record<string, string> = {
      uz: `Bepul mock intervyu limitingiz tugadi.\n\nDavom etish uchun reja tanlang:\n\n<b>STARTER</b> — $5/oy\n• 2 ta mock intervyu\n• Kunlik topshiriqlar\n• 10 daqiqa ovozli javob\n• 5 ta CV tahlili\n\n<b>PRO</b> — $15/oy\n• 8 ta mock intervyu\n• 30 daqiqa ovozli javob\n• Haftalik AI tavsiyalar\n\nBatafsil: /upgrade`,

      ru: `Лимит бесплатных mock-интервью исчерпан.\n\nВыберите план для продолжения:\n\n<b>STARTER</b> — $5/мес\n• 2 mock-интервью\n• Ежедневные задания\n• 10 мин голосовых ответов\n• 5 анализов CV\n\n<b>PRO</b> — $15/мес\n• 8 mock-интервью\n• 30 мин голосовых ответов\n• Еженедельные AI рекомендации\n\nПодробнее: /upgrade`,

      en: `Your free mock interview limit is reached.\n\nChoose a plan to continue:\n\n<b>STARTER</b> — $5/mo\n• 2 mock interviews\n• Daily tasks\n• 10 min voice responses\n• 5 CV analyses\n\n<b>PRO</b> — $15/mo\n• 8 mock interviews\n• 30 min voice responses\n• Weekly AI recommendations\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getVoiceExhaustedMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `Bepul sinov davrida faqat matn javoblari mavjud.\n\nOvozli mashq qilish uchun reja tanlang:\n\n<b>STARTER</b> — $5/oy\n• 10 daqiqa ovozli javob\n• Avtomatik transkripsiya\n• 2 ta mock intervyu\n\n<b>PRO</b> — $15/oy\n• 30 daqiqa ovozli javob\n• AI ovozli tahlil\n• 8 ta mock intervyu\n\nBatafsil: /upgrade`,

      ru: `В пробном периоде доступны только текстовые ответы.\n\nДля голосовой практики выберите план:\n\n<b>STARTER</b> — $5/мес\n• 10 мин голосовых ответов\n• Автоматическая транскрипция\n• 2 mock-интервью\n\n<b>PRO</b> — $15/мес\n• 30 мин голосовых ответов\n• AI голосовой анализ\n• 8 mock-интервью\n\nПодробнее: /upgrade`,

      en: `Voice responses are not available in the free trial.\n\nChoose a plan for voice practice:\n\n<b>STARTER</b> — $5/mo\n• 10 min voice responses\n• Automatic transcription\n• 2 mock interviews\n\n<b>PRO</b> — $15/mo\n• 30 min voice responses\n• AI voice analysis\n• 8 mock interviews\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private getBothExhaustedMessage(lang: string, usedCount: number): string {
    const messages: Record<string, string> = {
      uz: `Barcha bepul imkoniyatlardan foydalandingiz (${usedCount} ta intervyu).\n\nDavom etish uchun reja tanlang:\n\n<b>STARTER</b> — $5/oy\n• 2 ta mock intervyu + 10 min voice\n• Kunlik topshiriqlar\n• 5 ta CV tahlili\n\n<b>PRO</b> — $15/oy\n• 8 ta mock intervyu + 30 min voice\n• Haftalik AI tavsiyalar\n• 15 ta CV tahlili\n\n<b>ELITE</b> — $30/oy\n• Cheksiz mock intervyu\n• 2 ta kunlik topshiriq\n• Shaxsiy karyera rejasi\n\nBatafsil: /upgrade`,

      ru: `Все бесплатные возможности использованы (${usedCount} интервью).\n\nВыберите план для продолжения:\n\n<b>STARTER</b> — $5/мес\n• 2 mock-интервью + 10 мин voice\n• Ежедневные задания\n• 5 анализов CV\n\n<b>PRO</b> — $15/мес\n• 8 mock-интервью + 30 мин voice\n• Еженедельные AI рекомендации\n• 15 анализов CV\n\n<b>ELITE</b> — $30/мес\n• Безлимитные mock-интервью\n• 2 ежедневных задания\n• Персональный план карьеры\n\nПодробнее: /upgrade`,

      en: `All free features used (${usedCount} interviews).\n\nChoose a plan to continue:\n\n<b>STARTER</b> — $5/mo\n• 2 mock interviews + 10 min voice\n• Daily tasks\n• 5 CV analyses\n\n<b>PRO</b> — $15/mo\n• 8 mock interviews + 30 min voice\n• Weekly AI recommendations\n• 15 CV analyses\n\n<b>ELITE</b> — $30/mo\n• Unlimited mock interviews\n• 2 daily tasks\n• Personal career roadmap\n\nDetails: /upgrade`,
    };

    return messages[lang] || messages.uz;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStats(): Promise<{
    mockExhausted: number;
    voiceExhausted: number;
    bothExhausted: number;
    totalNotified: number;
  }> {
    try {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      const [mockExhausted, voiceExhausted, bothExhausted, totalNotified] = await Promise.all([
        // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $gte: 1 },
          'voiceQuota.mockVoice.remaining': { $gt: 0 },
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $lt: 1 },
          'voiceQuota.mockVoice.remaining': 0,
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $gte: 1 },
          'voiceQuota.mockVoice.remaining': 0,
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          limitExhaustedNotifiedAt: { $gte: threeDaysAgo },
        }),
      ]);

      return { mockExhausted, voiceExhausted, bothExhausted, totalNotified };
    } catch (error: any) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      return { mockExhausted: 0, voiceExhausted: 0, bothExhausted: 0, totalNotified: 0 };
    }
  }
}
