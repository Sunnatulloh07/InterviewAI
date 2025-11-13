import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramSession, TelegramSessionDocument } from './schemas/telegram-session.schema';
import { BotContext } from './telegram.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { AiSttService } from '../ai/ai-stt.service';
import { UsersService } from '../users/users.service';
import { AiContextService } from '../ai/ai-context.service';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class TelegramLiveService {
  private readonly logger = new Logger(TelegramLiveService.name);

  constructor(
    @InjectModel(TelegramSession.name)
    private readonly sessionModel: Model<TelegramSessionDocument>,
    private readonly answerService: AiAnswerService,
    private readonly sttService: AiSttService,
    private readonly usersService: UsersService,
    private readonly contextService: AiContextService,
  ) {}

  async handleStartLive(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    if (!user) {
      // For non-registered users, use session language or default to 'en'
      const lang = ctx.session?.language || 'en';
      const notRegisteredText: Record<string, string> = {
        uz: `Iltimos avval /start buyrug'i bilan ro'yxatdan o'ting`,
        ru: `Пожалуйста, сначала зарегистрируйтесь используя /start`,
        en: `Please register first using /start`,
      };
      await ctx.reply(notRegisteredText[lang] || notRegisteredText['en']);
      return;
    }

    // Get language from session, user preferences, or database
    // Priority: session > user.preferences.language > user.language > 'en'
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const startText: Record<string, string> = {
      uz:
        `🎯 <b>Live Intervyu Rejimi Faollashtirildi</b>\n\n` +
        `Men endi real vaqtda sizga yordam bera olaman!\n\n` +
        `Savollaringizni yuboring yoki ovozli xabarlardan foydalaning, men darhol javob beraman.\n\n` +
        `To'xtatish uchun /end_live buyrug'ini yuboring.`,
      ru:
        `🎯 <b>Режим Live Интервью Активирован</b>\n\n` +
        `Я теперь готов помочь вам в реальном времени!\n\n` +
        `Отправляйте вопросы или используйте голосовые сообщения, я предоставлю мгновенные ответы.\n\n` +
        `Используйте /end_live для остановки.`,
      en:
        `🎯 <b>Live Interview Mode Activated</b>\n\n` +
        `I'm now ready to assist you in real-time!\n\n` +
        `Send me questions or use voice messages, and I'll provide instant answers.\n\n` +
        `Use /end_live to stop.`,
    };

    await ctx.reply(startText[lang] || startText['en'], {
      parse_mode: 'HTML',
    });

    // Create or update session
    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      {
        userId: user.id as any,
        telegramChatId: telegramId,
        status: 'live_session',
        sessionStartedAt: new Date(),
        lastActivityAt: new Date(),
        messages: [],
        context: '',
        metadata: {
          jobRole: ctx.session.liveSessionMetadata?.jobRole,
          company: ctx.session.liveSessionMetadata?.company,
          interviewType: ctx.session.liveSessionMetadata?.interviewType,
          language: lang,
        },
      },
      { upsert: true },
    );

    // Create AI context session
    const aiSession = await this.contextService.createSession(user.id, 'live_interview');
    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      { context: aiSession.id },
    );
  }

  async handleEndLive(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;

    // Get user for language preference
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    // Priority: session > user.preferences.language > user.language > 'en'
    let lang = ctx.session?.language;
    if (!lang && user) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    } else if (!lang) {
      lang = 'en';
    }

    const session = await this.sessionModel.findOne({
      telegramChatId: telegramId,
      status: 'live_session',
    });

    if (session && session.context) {
      // Archive AI session
      await this.contextService.archiveSession(session.context);
    }

    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      { status: 'idle', lastActivityAt: new Date() },
    );

    const endText: Record<string, string> = {
      uz: `✅ <b>Live sessiya yakunlandi</b>\n\nIntervyu uchun omad tilaymiz!`,
      ru: `✅ <b>Live сессия завершена</b>\n\nУдачи на интервью!`,
      en: `✅ <b>Live session ended</b>\n\nGood luck with your interview!`,
    };

    await ctx.reply(endText[lang] || endText['en'], {
      parse_mode: 'HTML',
    });
  }

  async isInLiveSession(telegramId: number): Promise<boolean> {
    const session = await this.sessionModel.findOne({
      telegramChatId: telegramId,
      status: 'live_session',
    });
    return !!session;
  }

  /**
   * Get session model (for internal use by other services)
   */
  getSessionModel() {
    return this.sessionModel;
  }

  async handleLiveMessage(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const text = ctx.message?.text;

    if (!text) {
      return;
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      return;
    }

    // Get language from session, user preferences, or database
    // Priority: session > user.preferences.language > user.language > 'en'
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    try {
      const processingText: Record<string, string> = {
        uz: `⏳ Javob tayyorlanmoqda...`,
        ru: `⏳ Генерируется ответ...`,
        en: `⏳ Generating answer...`,
      };
      await ctx.reply(processingText[lang] || processingText['en']);

      // Get or create AI session
      const telegramSession = await this.sessionModel.findOne({
        telegramChatId: telegramId,
        status: 'live_session',
      });

      let sessionId = telegramSession?.context;
      if (!sessionId) {
        const aiSession = await this.contextService.createSession(user.id, 'live_interview');
        sessionId = aiSession.id;
        await this.sessionModel.findOneAndUpdate(
          { telegramChatId: telegramId },
          { context: sessionId },
        );
      }

      // Generate answer with error handling
      let answerResponse;
      let answer;
      try {
        // Use the language we already retrieved (lang is already from DB if session was empty)
        answerResponse = await this.answerService.generateAnswer(user.id, {
          question: text,
          sessionId,
          variations: 1,
          style: 'professional',
          length: 'medium',
          language: lang, // Pass user's language preference
        });
        answer = answerResponse.answers[0];
      } catch (error) {
        this.logger.error(`AI answer generation failed: ${error.message}`, error.stack);
        const errorText: Record<string, string> = {
          uz:
            `❌ <b>Xatolik yuz berdi</b>\n\n` +
            `AI javob yaratishda muammo bo'ldi. Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Qayta urinib ko'ring\n` +
            `• Yoki /end_live bilan sessiyani to'xtating`,
          ru:
            `❌ <b>Произошла ошибка</b>\n\n` +
            `Проблема при генерации AI ответа. Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Попробуйте снова\n` +
            `• Или остановите сессию с /end_live`,
          en:
            `❌ <b>An error occurred</b>\n\n` +
            `Problem generating AI answer. Please:\n` +
            `• Check your internet connection\n` +
            `• Try again\n` +
            `• Or stop the session with /end_live`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // Format response
      const responseText: Record<string, string> = {
        uz:
          `💡 <b>Javob:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Asosiy nuqtalar:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
        ru:
          `💡 <b>Ответ:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Ключевые моменты:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
        en:
          `💡 <b>Answer:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Key Points:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
      };

      await ctx.reply(responseText[lang] || responseText['en'], {
        parse_mode: 'HTML',
      });

      // Update session
      await this.sessionModel.findOneAndUpdate(
        { telegramChatId: telegramId },
        {
          $push: {
            messages: {
              timestamp: new Date(),
              type: 'question',
              content: text,
              aiResponse: answer.content,
              processingTime: answerResponse.processingTime,
            },
          },
          lastActivityAt: new Date(),
        },
      );
    } catch (error) {
      this.logger.error(`Error handling live message: ${error.message}`, error.stack);

      // Check if it's a BadRequestException (API key not configured)
      const isApiKeyError =
        error.message?.includes('not configured') || error.message?.includes('OPENAI_API_KEY');

      const errorText: Record<string, string> = {
        uz: isApiKeyError
          ? `❌ <b>AI xizmati sozlanganmagan</b>\n\n` +
            `AI javob yaratish uchun OPENAI_API_KEY sozlanishi kerak.\n\n` +
            `Hozircha faqat matn xabarlarni qabul qilamiz.\n\n` +
            `Live rejimni to'xtatish uchun /end_live buyrug'ini yuboring.`
          : `❌ <b>Xatolik yuz berdi</b>\n\n` +
            `Savolingizni qayta ishlashda muammo bo'ldi.\n\n` +
            `Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Qayta urinib ko'ring\n` +
            `• Yoki /end_live bilan sessiyani to'xtating`,
        ru: isApiKeyError
          ? `❌ <b>AI сервис не настроен</b>\n\n` +
            `Для генерации AI ответов необходимо настроить OPENAI_API_KEY.\n\n` +
            `Пока мы принимаем только текстовые сообщения.\n\n` +
            `Используйте /end_live для остановки live режима.`
          : `❌ <b>Произошла ошибка</b>\n\n` +
            `Проблема при обработке вашего вопроса.\n\n` +
            `Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Попробуйте снова\n` +
            `• Или остановите сессию с /end_live`,
        en: isApiKeyError
          ? `❌ <b>AI service not configured</b>\n\n` +
            `OPENAI_API_KEY needs to be configured for AI answer generation.\n\n` +
            `For now, we only accept text messages.\n\n` +
            `Use /end_live to stop live mode.`
          : `❌ <b>An error occurred</b>\n\n` +
            `Problem processing your question.\n\n` +
            `Please:\n` +
            `• Check your internet connection\n` +
            `• Try again\n` +
            `• Or stop the session with /end_live`,
      };
      await ctx.reply(errorText[lang] || errorText['en'], {
        parse_mode: 'HTML',
      });
    }
  }
}
