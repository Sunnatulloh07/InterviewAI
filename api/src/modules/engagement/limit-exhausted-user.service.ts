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
            { 'usage.mockInterviewsThisMonth': { $gte: 5 } },
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
          const isMockExhausted = mockInterviewsUsed >= 5;
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
          this.logger.error(`Failed to process limit exhausted user ${user._id}: ${userError.message}`);
          failed++;
        }
      }

      this.logger.log(`Limit exhausted engagement: sent=${sent}, failed=${failed}, skipped=${skipped}`);
    } catch (error: any) {
      this.logger.error(`Limit exhausted engagement failed: ${error.message}`);
    }
  }

  private getMockExhaustedMessage(lang: string, usedCount: number): string {
    const messages: Record<string, string> = {
      uz: `🎯 Tabriklaymiz! Siz ${usedCount} ta mock interview bajardingiz!

✅ Siz intervyu tayyorgarligini jiddiy olayotganingizni ko'rsatdingiz.

💪 Endi haqiqiy o'sish vaqti!

🚀 PREMIUM bilan quyidagilarga ega bo'lasiz:
• Cheksiz mock interviews
• 45 daqiqa ovozli javoblar/oy
• Advanced AI tahlil
• Shaxsiy mentorlik

💰 Faqat 49,000 so'm/oy (50% chegirma!)

📞 @interviewai_support_bot

🔥 Chegirma faqat 3 kun!`,

      ru: `🎯 Поздравляем! Вы прошли ${usedCount} mock интервью!

✅ Вы показали, что серьезно относитесь к подготовке.

💪 Теперь время для реального роста!

🚀 С PREMIUM вы получите:
• Неограниченные mock интервью
• 45 минут голосовых ответов/мес
• Продвинутый AI анализ
• Персональное менторство

💰 Всего 49,000 сум/мес (скидка 50%!)

📞 @interviewai_support_bot

🔥 Скидка только 3 дня!`,

      en: `🎯 Congratulations! You completed ${usedCount} mock interviews!

✅ You've shown you're serious about preparation.

💪 Now it's time for real growth!

🚀 With PREMIUM you get:
• Unlimited mock interviews
• 45 minutes voice answers/mo
• Advanced AI analysis
• Personal mentorship

💰 Only 49,000 sum/mo (50% discount!)

📞 @interviewai_support_bot

🔥 Discount only for 3 days!`,
    };

    return messages[lang] || messages.uz;
  }

  private getVoiceExhaustedMessage(lang: string): string {
    const messages: Record<string, string> = {
      uz: `🎙️ Ovozli javob limiti tugadi!

Sizning bepul 5 daqiqa ovozli javob limitingiz tugagan.

💡 Ovozli javoblar 85% intervyu muvaffaqiyatini oshiradi!

🚀 Premium bilan quyidagilarga ega bo'lasiz:
• 45 daqiqa ovozli javoblar/oy
• Avtomatik transkripsiya
• Ovozli tahlil va feedback

💰 STARTER: 49,000 so'm/oy

📞 @interviewai_support_bot

⏰ Hozir yangilang va intervyuda yaxshiroq natijalar ga erishing!`,

      ru: `🎙️ Лимит голосовых ответов исчерпан!

Ваш бесплатный лимит 5 минут голосовых ответов закончился.

💡 Голосовые ответы повышают успех интервью на 85%!

🚀 С Premium вы получите:
• 45 минут голосовых ответов/мес
• Автоматическая транскрипция
• Голосовой анализ и feedback

💰 STARTER: 49,000 сум/мес

📞 @interviewai_support_bot

⏰ Обновитесь сейчас и достигните лучших результатов на собеседовании!`,

      en: `🎙️ Voice answer limit exhausted!

Your free 5-minute voice answer limit has ended.

💡 Voice answers increase interview success by 85%!

🚀 With Premium you get:
• 45 minutes voice answers/mo
• Automatic transcription
• Voice analysis and feedback

💰 STARTER: 49,000 sum/mo

📞 @interviewai_support_bot

⏰ Upgrade now and achieve better interview results!`,
    };

    return messages[lang] || messages.uz;
  }

  private getBothExhaustedMessage(lang: string, usedCount: number): string {
    const messages: Record<string, string> = {
      uz: `🚀 Siz ajoyib ish qildingiz! ${usedCount} ta mock interview + 5 daqiqa ovozli javob!

✅ Bepul imkoniyatlardan to'liq foydalandingiz.

🔥 Endi Premiumga o'tish vaqti!

💎 PREMIUM imkoniyatlari:
✅ Cheksiz mock interviews
✅ 45 daqiqa ovozli javoblar/oy
✅ CV tahlili va optimallashtirish
✅ Kunlik topshiriqlar
✅ 24/7 AI yordamchisi

💰 Maxsus taklif: 50% chegirma
📞 @interviewai_support_bot

⏰ Faqat 3 kun!`,

      ru: `🚀 Отличная работа! ${usedCount} mock интервью + 5 минут голосовых ответов!

✅ Вы полностью использовали бесплатные возможности.

🔥 Теперь время перейти на Premium!

💎 Возможности PREMIUM:
✅ Неограниченные mock интервью
✅ 45 минут голосовых ответов/мес
✅ Анализ и оптимизация CV
✅ Ежедневные задания
✅ AI помощник 24/7

💰 Специальное предложение: скидка 50%
📞 @interviewai_support_bot

⏰ Только 3 дня!`,

      en: `🚀 Great job! ${usedCount} mock interviews + 5 minutes voice answers!

✅ You've fully used free opportunities.

🔥 Now it's time to upgrade to Premium!

💎 PREMIUM features:
✅ Unlimited mock interviews
✅ 45 minutes voice answers/mo
✅ CV analysis and optimization
✅ Daily tasks
✅ 24/7 AI assistant

💰 Special offer: 50% discount
📞 @interviewai_support_bot

⏰ Only 3 days!`,
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
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $gte: 5 },
          'voiceQuota.mockVoice.remaining': { $gt: 0 },
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $lt: 5 },
          'voiceQuota.mockVoice.remaining': 0,
        }),
        this.userModel.countDocuments({
          'subscription.plan': 'free_trial',
          'usage.mockInterviewsThisMonth': { $gte: 5 },
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
