import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { InlineKeyboard } from 'grammy';

/**
 * Position Prompt Service
 * 
 * Prompts users 4-4.5 hours after registration to confirm their position
 * if they still have the default 'junior' position and haven't manually changed it.
 * 
 * This ensures users get personalized interview questions and daily tasks
 * appropriate for their actual skill level.
 */
@Injectable()
export class PositionPromptService {
  private readonly logger = new Logger(PositionPromptService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Send position confirmation prompt to user
   * Asks: "What position do you have at your current/previous job or learned?"
   */
  async sendPositionPrompt(
    userId: string,
    telegramId: number,
    language: string = 'uz',
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const bot = this.telegramService.getBot();

      // Get position prompt messages in user's language
      const messages = this.getPositionPromptMessages(language);

      // Create inline keyboard with position options
      const keyboard = new InlineKeyboard()
        .text(messages.junior, 'confirm_position_junior')
        .text(messages.middle, 'confirm_position_middle')
        .row()
        .text(messages.senior, 'confirm_position_senior')
        .text(messages.lead, 'confirm_position_lead');

      await bot.api.sendMessage(
        telegramId,
        messages.prompt,
        {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        },
      );

      this.logger.log(
        `Position prompt sent to user ${userId} (telegram: ${telegramId})`,
      );

      return { success: true };
    } catch (error: any) {
      // Handle bot blocked / user deactivated errors
      if (error.error_code === 403 || error.description?.includes('bot was blocked')) {
        this.logger.warn(
          `User ${userId} has blocked the bot - marking as blocked`,
        );

        await this.userModel.findByIdAndUpdate(userId, {
          $set: {
            'engagement.isBotBlocked': true,
            'engagement.botBlockedAt': new Date(),
          },
        });

        return {
          success: false,
          error: 'User has blocked the bot',
        };
      }

      if (error.error_code === 400 && error.description?.includes('chat not found')) {
        this.logger.warn(
          `User ${userId} deactivated their Telegram account`,
        );

        await this.userModel.findByIdAndUpdate(userId, {
          $set: { isActive: false },
        });

        return {
          success: false,
          error: 'User deactivated account',
        };
      }

      this.logger.error(
        `Failed to send position prompt to user ${userId}: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Handle position confirmation callback
   * Called when user selects a position from the prompt
   */
  async handlePositionConfirmation(
    userId: string,
    position: 'junior' | 'middle' | 'senior' | 'lead',
    language: string = 'uz',
  ): Promise<void> {
    try {
      // Update user profile with confirmed position
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'profile.position': position,
          'engagement.positionConfirmed': true,
        },
      });

      this.logger.log(
        `User ${userId} confirmed position: ${position}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to update position for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get position prompt messages in different languages
   */
  private getPositionPromptMessages(language: string): {
    prompt: string;
    junior: string;
    middle: string;
    senior: string;
    lead: string;
    thanks: string;
  } {
    const messages = {
      uz: {
        prompt:
          '👋 Assalomu alaykum!\n\n' +
          '📊 Sizning mahorat darajangizni aniqlash uchun yordam bering.\n\n' +
          '<b>Hozirgi yoki oldingi ishingizda (yoki o\'rgangan joyingizda) qaysi lavozimda edingiz?</b>\n\n' +
          'Bu savollarga mos javoblar olishingiz uchun muhim.',
        junior: '🌱 Junior (0-2 yil tajriba)',
        middle: '💼 Middle (2-5 yil tajriba)',
        senior: '🎯 Senior (5+ yil tajriba)',
        lead: '👑 Lead/Architect (Team lead)',
        thanks: '✅ Rahmat! Lavozimingiz saqlandi. Endi sizga mos savollar jo\'natiladi.',
      },
      ru: {
        prompt:
          '👋 Здравствуйте!\n\n' +
          '📊 Помогите нам определить ваш уровень навыков.\n\n' +
          '<b>На какой должности вы работаете/работали (или учились)?</b>\n\n' +
          'Это важно для подбора подходящих вопросов.',
        junior: '🌱 Junior (0-2 года опыта)',
        middle: '💼 Middle (2-5 лет опыта)',
        senior: '🎯 Senior (5+ лет опыта)',
        lead: '👑 Lead/Architect (Team lead)',
        thanks: '✅ Спасибо! Ваша должность сохранена. Теперь вы получите соответствующие вопросы.',
      },
      en: {
        prompt:
          '👋 Hello!\n\n' +
          '📊 Please help us determine your skill level.\n\n' +
          '<b>What position do you have/had at your current or previous job (or learned)?</b>\n\n' +
          'This is important to provide you with appropriate questions.',
        junior: '🌱 Junior (0-2 years experience)',
        middle: '💼 Middle (2-5 years experience)',
        senior: '🎯 Senior (5+ years experience)',
        lead: '👑 Lead/Architect (Team lead)',
        thanks: '✅ Thank you! Your position has been saved. You will now receive appropriate questions.',
      },
    };

    return messages[language] || messages.uz;
  }

  /**
   * Get confirmation message after position is set
   */
  getPositionConfirmationMessage(
    position: string,
    language: string = 'uz',
  ): string {
    const messages = this.getPositionPromptMessages(language);
    return messages.thanks;
  }
}
