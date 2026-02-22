import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InlineKeyboard } from 'grammy';
import { UsersService } from '../users/users.service';
import { TelegramService } from '../telegram/telegram.service';
import { JobSeekingStatus } from './dto/job-seeking-status.enum';

/**
 * Survey text content for all supported languages
 */
const SURVEY_CONTENT = {
  uz: {
    question: `🎯 <b>Bir savol bor!</b>\n\nHozirda siz qaysi bosqichdasiz?`,
    buttons: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: '🔥 Faol ish izlayapman',
      [JobSeekingStatus.PREPARING]: '📚 Intervyuga tayyorgarlik',
      [JobSeekingStatus.LEARNING]: '🎓 Bilimlarni oshirish',
      [JobSeekingStatus.EMPLOYED]: '✅ Ish topdim',
    },
    thanks: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: `Ajoyib! 💪 Ish izlash jarayonida sizga yordam beramiz. Doimiy mashq qilish muvaffaqiyatga olib boradi!`,
      [JobSeekingStatus.PREPARING]: `Zo'r! 📚 Tayyorgarlik ko'rish - eng muhim qadam. Mock intervyular orqali o'zingizni sinovdan o'tkazing.`,
      [JobSeekingStatus.LEARNING]: `Ajoyib tanlov! 🎓 Bilimlarni oshirish kelajak uchun investitsiya. Yangi texnologiyalarni o'rganishda davom eting.`,
      [JobSeekingStatus.EMPLOYED]: `Tabriklaymiz! 🎉 Agar kelajakda kerak bo'lsa, biz shu yerda.`,
    },
  },
  ru: {
    question: `🎯 <b>Один вопрос!</b>\n\nНа каком этапе вы сейчас?`,
    buttons: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: '🔥 Активно ищу работу',
      [JobSeekingStatus.PREPARING]: '📚 Готовлюсь к собеседованиям',
      [JobSeekingStatus.LEARNING]: '🎓 Улучшаю навыки',
      [JobSeekingStatus.EMPLOYED]: '✅ Нашёл работу',
    },
    thanks: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: `Отлично! 💪 Поможем вам в поиске. Регулярная практика ведёт к успеху!`,
      [JobSeekingStatus.PREPARING]: `Супер! 📚 Подготовка — ключ к успеху. Попробуйте mock-интервью.`,
      [JobSeekingStatus.LEARNING]: `Отличный выбор! 🎓 Обучение — инвестиция в будущее.`,
      [JobSeekingStatus.EMPLOYED]: `Поздравляем! 🎉 Если понадобимся — мы здесь.`,
    },
  },
  en: {
    question: `🎯 <b>Quick question!</b>\n\nWhat stage are you at right now?`,
    buttons: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: '🔥 Actively job hunting',
      [JobSeekingStatus.PREPARING]: '📚 Preparing for interviews',
      [JobSeekingStatus.LEARNING]: '🎓 Improving skills',
      [JobSeekingStatus.EMPLOYED]: '✅ Found a job',
    },
    thanks: {
      [JobSeekingStatus.ACTIVELY_LOOKING]: `Great! 💪 We'll help you in your search. Consistent practice leads to success!`,
      [JobSeekingStatus.PREPARING]: `Awesome! 📚 Preparation is key. Try our mock interviews.`,
      [JobSeekingStatus.LEARNING]: `Excellent choice! 🎓 Learning is an investment in your future.`,
      [JobSeekingStatus.EMPLOYED]: `Congratulations! 🎉 We're here if you ever need us.`,
    },
  },
} as const;

/**
 * SurveyHandlerService
 *
 * Handles the onboarding survey flow for new users:
 * 1. Sends survey with inline keyboard buttons
 * 2. Processes user responses via callback queries
 * 3. Updates user's jobSeekingStatus accordingly
 * 4. Marks survey as completed
 *
 * Production-ready with:
 * - Multi-language support (uz, ru, en)
 * - Error handling and logging
 * - Idempotent response processing
 */
@Injectable()
export class SurveyHandlerService {
  private readonly logger = new Logger(SurveyHandlerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Send the onboarding survey to a user
   *
   * @param userId - MongoDB user ID
   * @param telegramId - Telegram user ID
   * @param lang - User's preferred language
   * @returns true if sent successfully, false otherwise
   */
  async sendSurvey(userId: string, telegramId: number, lang: string): Promise<boolean> {
    const bot = this.telegramService.getBot();
    if (!bot) {
      this.logger.warn('Bot not available, survey sending disabled');
      return false;
    }

    const content = SURVEY_CONTENT[lang as keyof typeof SURVEY_CONTENT] || SURVEY_CONTENT.uz;

    // Build inline keyboard with survey options
    const keyboard = new InlineKeyboard()
      .text(
        content.buttons[JobSeekingStatus.ACTIVELY_LOOKING],
        `survey_${JobSeekingStatus.ACTIVELY_LOOKING}`,
      )
      .row()
      .text(content.buttons[JobSeekingStatus.PREPARING], `survey_${JobSeekingStatus.PREPARING}`)
      .row()
      .text(content.buttons[JobSeekingStatus.LEARNING], `survey_${JobSeekingStatus.LEARNING}`)
      .row()
      .text(content.buttons[JobSeekingStatus.EMPLOYED], `survey_${JobSeekingStatus.EMPLOYED}`);

    try {
      await bot.api.sendMessage(telegramId, content.question, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      // Clear scheduled time on successful send (survey is now pending user response)
      await this.usersService.updateEngagement(userId, {
        scheduledSurveyAt: null,
        lastNotificationSentAt: new Date(),
      });

      this.logger.log(`Survey sent to user ${userId} (telegram: ${telegramId})`);
      return true;
    } catch (error: any) {
      // Handle common Telegram API errors
      if (error?.description?.includes('bot was blocked')) {
        await this.usersService.updateEngagement(userId, {
          isBotBlocked: true,
          botBlockedAt: new Date(),
          scheduledSurveyAt: null, // Clear to prevent retry
        });
        this.logger.warn(`User ${userId} has blocked the bot`);
      } else if (error?.description?.includes('user is deactivated')) {
        // Clear survey schedule for deactivated accounts
        await this.usersService.updateEngagement(userId, {
          scheduledSurveyAt: null,
        });
        this.logger.warn(`User ${userId} account is deactivated`);
      } else if (error?.description?.includes('chat not found')) {
        // Clear survey schedule for non-existent chats
        await this.usersService.updateEngagement(userId, {
          scheduledSurveyAt: null,
        });
        this.logger.warn(`Chat not found for user ${userId}`);
      } else {
        // For other errors, reschedule for later (1 hour delay)
        const retryTime = new Date(Date.now() + 60 * 60 * 1000);
        await this.usersService.updateEngagement(userId, {
          scheduledSurveyAt: retryTime,
        });
        this.logger.error(
          `Failed to send survey to user ${userId}: ${error.message}, retrying at ${retryTime.toISOString()}`,
        );
      }
      return false;
    }
  }

  /**
   * Process user's survey response from callback query
   *
   * @param userId - MongoDB user ID
   * @param status - Selected job-seeking status
   * @param lang - User's preferred language
   * @returns Thank you message to display
   */
  async handleSurveyResponse(
    userId: string,
    status: JobSeekingStatus,
    lang: string,
  ): Promise<string> {
    // Update user's engagement with survey response
    await this.usersService.updateEngagement(userId, {
      jobSeekingStatus: status,
      surveyCompletedAt: new Date(),
      scheduledSurveyAt: null, // Clear scheduled time
    });

    this.logger.log(`User ${userId} completed survey with status: ${status}`);

    // Get thank you message
    const content = SURVEY_CONTENT[lang as keyof typeof SURVEY_CONTENT] || SURVEY_CONTENT.uz;
    return content.thanks[status] || content.thanks[JobSeekingStatus.LEARNING];
  }

  /**
   * Update user's job-seeking status (e.g., from settings)
   *
   * @param userId - MongoDB user ID
   * @param status - New job-seeking status
   */
  async updateJobStatus(userId: string, status: JobSeekingStatus): Promise<void> {
    await this.usersService.updateEngagement(userId, {
      jobSeekingStatus: status,
    });
    this.logger.log(`User ${userId} updated job status to: ${status}`);
  }

  /**
   * Check if a callback data string is a survey response
   */
  isSurveyCallback(callbackData: string): boolean {
    return callbackData.startsWith('survey_');
  }

  /**
   * Extract job-seeking status from callback data
   */
  parseCallbackData(callbackData: string): JobSeekingStatus | null {
    if (!this.isSurveyCallback(callbackData)) {
      return null;
    }

    const status = callbackData.replace('survey_', '') as JobSeekingStatus;

    // Validate it's a valid status
    if (Object.values(JobSeekingStatus).includes(status)) {
      return status;
    }

    return null;
  }

  /**
   * Get available job status options for settings menu
   */
  getJobStatusOptions(lang: string): Array<{ status: JobSeekingStatus; label: string }> {
    const content = SURVEY_CONTENT[lang as keyof typeof SURVEY_CONTENT] || SURVEY_CONTENT.uz;

    return [
      {
        status: JobSeekingStatus.ACTIVELY_LOOKING,
        label: content.buttons[JobSeekingStatus.ACTIVELY_LOOKING],
      },
      { status: JobSeekingStatus.PREPARING, label: content.buttons[JobSeekingStatus.PREPARING] },
      { status: JobSeekingStatus.LEARNING, label: content.buttons[JobSeekingStatus.LEARNING] },
      { status: JobSeekingStatus.EMPLOYED, label: content.buttons[JobSeekingStatus.EMPLOYED] },
    ];
  }

  /**
   * Get human-readable label for a job-seeking status
   */
  getStatusLabel(status: JobSeekingStatus, lang: string): string {
    const content = SURVEY_CONTENT[lang as keyof typeof SURVEY_CONTENT] || SURVEY_CONTENT.uz;

    // NOT_SET doesn't have a button label, return appropriate fallback
    if (status === JobSeekingStatus.NOT_SET) {
      return lang === 'uz' ? 'Belgilanmagan' : lang === 'ru' ? 'Не указано' : 'Not set';
    }

    return content.buttons[status] || 'Unknown';
  }
}
