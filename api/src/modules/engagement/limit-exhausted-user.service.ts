import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';

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

      const usersWithExhaustedLimits = await this.userModel
        .find({
          'subscription.plan': 'free_trial',
          'subscription.status': { $in: ['trialing', 'expired'] },
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          $or: [
            // ALIGNED with COMPLETE_PLAN_LIMITS: free_trial = 1 mock interview
            { 'usage.mockInterviewsThisMonth': { $gte: 1 } },
            { 'voiceQuota.mockVoice.remaining': 0 },
          ],
        })
        .select('_id telegramId language usage voiceQuota limitExhaustedNotifiedAt subscription')
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
                $set: { limitExhaustedNotifiedAt: now },
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
      uz: `🎯 Siz bepul mock interview limitingizni tugatdingiz!

💪 Davom etish uchun Premium rejani tanlang:

💼 <b>STARTER</b> - $10/oy:
• 10 ta mock interview/oy
• Kunlik savol va topshiriqlar
• 10 daqiqa ovozli javoblar
• 5 ta CV tahlili

🚀 <b>PRO</b> - $20/oy:
• 30 ta mock interview/oy
• 30 daqiqa ovozli javoblar
• Haftalik AI tavsiyalar

Rejalarni ko'rish: /plans`,

      ru: `🎯 Вы исчерпали лимит бесплатных mock интервью!

💪 Для продолжения выберите Premium план:

💼 <b>STARTER</b> - $10/мес:
• 10 mock интервью/мес
• Ежедневные вопросы и задания
• 10 минут голосовых ответов
• 5 анализов CV

🚀 <b>PRO</b> - $20/мес:
• 30 mock интервью/мес
• 30 минут голосовых ответов
• Еженедельные AI рекомендации

Смотреть планы: /plans`,

      en: `🎯 You've used your free mock interview limit!

💪 Choose a Premium plan to continue:

💼 <b>STARTER</b> - $10/mo:
• 10 mock interviews/mo
• Daily questions and tasks
• 10 minutes voice responses
• 5 CV analyses

🚀 <b>PRO</b> - $20/mo:
• 30 mock interviews/mo
• 30 minutes voice responses
• Weekly AI recommendations

View plans: /plans`,
    };

    return messages[lang] || messages.uz;
  }

  private getVoiceExhaustedMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `🎙️ Bepul 2 daqiqa ovozli javob limitingiz tugadi!

🚀 Premium bilan ko'proq ovozli mashq:

💼 <b>STARTER</b> - $10/oy:
• 10 daqiqa ovozli javoblar
• Avtomatik transkripsiya
• 10 ta mock interview

🚀 <b>PRO</b> - $20/oy:
• 30 daqiqa ovozli javoblar
• AI ovozli tahlil va feedback
• 30 ta mock interview

Rejalarni ko'rish: /plans`,

      ru: `🎙️ Бесплатный лимит 2 минуты голосовых ответов исчерпан!

🚀 Premium для больше голосовой практики:

💼 <b>STARTER</b> - $10/мес:
• 10 минут голосовых ответов
• Автоматическая транскрипция
• 10 mock интервью

🚀 <b>PRO</b> - $20/мес:
• 30 минут голосовых ответов
• AI голосовой анализ и feedback
• 30 mock интервью

Смотреть планы: /plans`,

      en: `🎙️ Your free 2-minute voice answer limit is exhausted!

🚀 Premium for more voice practice:

💼 <b>STARTER</b> - $10/mo:
• 10 minutes voice responses
• Automatic transcription
• 10 mock interviews

🚀 <b>PRO</b> - $20/mo:
• 30 minutes voice responses
• AI voice analysis and feedback
• 30 mock interviews

View plans: /plans`,
    };

    return messages[lang] || messages.uz;
  }

  private getBothExhaustedMessage(lang: string, usedCount: number): string {
    const messages: Record<string, string> = {
      uz: `🚀 Barcha bepul imkoniyatlardan foydalandingiz!

✅ ${usedCount} ta mock interview + 2 daqiqa ovozli javob

💎 Premium bilan karyerangizni oshiring:

💼 <b>STARTER</b> - $10/oy:
• 10 ta mock interview + 10 min voice
• Kunlik AI savollari
• 5 ta CV tahlili

🚀 <b>PRO</b> - $20/oy:
• 30 ta mock interview + 30 min voice
• Haftalik AI tavsiyalar
• 15 ta CV tahlili

👑 <b>ELITE</b> - $30/oy:
• Cheksiz mock interview
• 2 ta kunlik topshiriq
• Shaxsiy karyera rejasi

Rejalarni ko'rish: /plans`,

      ru: `🚀 Вы использовали все бесплатные возможности!

✅ ${usedCount} mock интервью + 2 минуты голосовых ответов

💎 Поднимите карьеру с Premium:

💼 <b>STARTER</b> - $10/мес:
• 10 mock интервью + 10 мин voice
• Ежедневные AI вопросы
• 5 анализов CV

🚀 <b>PRO</b> - $20/мес:
• 30 mock интервью + 30 мин voice
• Еженедельные AI рекомендации
• 15 анализов CV

👑 <b>ELITE</b> - $30/мес:
• Безлимит mock интервью
• 2 ежедневных задания
• Персональный план карьеры

Смотреть планы: /plans`,

      en: `🚀 You've used all free features!

✅ ${usedCount} mock interviews + 2 minutes voice answers

💎 Level up your career with Premium:

💼 <b>STARTER</b> - $10/mo:
• 10 mock interviews + 10 min voice
• Daily AI questions
• 5 CV analyses

🚀 <b>PRO</b> - $20/mo:
• 30 mock interviews + 30 min voice
• Weekly AI recommendations
• 15 CV analyses

👑 <b>ELITE</b> - $30/mo:
• Unlimited mock interviews
• 2 daily tasks
• Personal career roadmap

View plans: /plans`,
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
