import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiSttService } from '../ai/ai-stt.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { BotContext } from './telegram.service';
import { Voice } from 'grammy/types';
import { UsersService } from '../users/users.service';
import { TelegramLiveService } from './telegram-live.service';
import { AiContextService } from '../ai/ai-context.service';

@Injectable()
export class TelegramVoiceService {
  private readonly logger = new Logger(TelegramVoiceService.name);

  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly usersService: UsersService,
    private readonly liveService: TelegramLiveService,
    private readonly contextService: AiContextService,
    private readonly configService: ConfigService,
  ) {}

  async handleVoiceMessage(ctx: BotContext) {
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

    try {
      const processingText: Record<string, string> = {
        uz: `🎤 Ovozli xabar qayta ishlanmoqda...`,
        ru: `🎤 Обрабатывается голосовое сообщение...`,
        en: `🎤 Processing voice message...`,
      };
      await ctx.reply(processingText[lang] || processingText['en']);

      // Download voice file
      const voice = ctx.message?.voice as Voice;
      if (!voice) {
        throw new Error('Voice message not found');
      }

      const file = await ctx.api.getFile(voice.file_id);
      const filePath = file.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${filePath}`;

      // Download file
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('Failed to download voice file from Telegram');
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Convert to base64
      const base64Audio = buffer.toString('base64');

      // Transcribe with error handling
      let transcription;
      let transcribedText;
      try {
        transcription = await this.sttService.transcribe({
          audioData: base64Audio,
          language: lang === 'uz' ? 'uz' : lang === 'ru' ? 'ru' : 'en',
        });
        transcribedText = transcription.text;
      } catch (error) {
        this.logger.error(`Transcription failed: ${error.message}`, error.stack);
        const errorText: Record<string, string> = {
          uz:
            `❌ <b>Ovozli xabarni qayta ishlashda xatolik</b>\n\n` +
            `Ovozli xabarni matnga aylantirishda muammo bo'ldi.\n\n` +
            `Sabab: AI xizmati sozlanganmagan yoki internet aloqasi muammosi.\n\n` +
            `Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Yoki matn xabar yuboring`,
          ru:
            `❌ <b>Ошибка обработки голосового сообщения</b>\n\n` +
            `Проблема при преобразовании голосового сообщения в текст.\n\n` +
            `Причина: AI сервис не настроен или проблема с интернет-соединением.\n\n` +
            `Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Или отправьте текстовое сообщение`,
          en:
            `❌ <b>Voice message processing error</b>\n\n` +
            `Problem converting voice message to text.\n\n` +
            `Reason: AI service is not configured or internet connection issue.\n\n` +
            `Please:\n` +
            `• Check your internet connection\n` +
            `• Or send a text message`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // Check if in live session
      const isLive = await this.liveService.isInLiveSession(telegramId);

      if (isLive) {
        // Handle as live message
        await this.handleLiveVoiceMessage(ctx, transcribedText, user.id);
      } else {
        // Handle as regular voice message with error handling
        let answerResponse;
        let answer;
        try {
          // Use the language we already retrieved (lang is already from DB if session was empty)
          answerResponse = await this.answerService.generateAnswer(user.id, {
            question: transcribedText,
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
              `❌ <b>Javob yaratishda xatolik</b>\n\n` +
              `AI javob yaratishda muammo bo'ldi. Iltimos qayta urinib ko'ring.`,
            ru:
              `❌ <b>Ошибка при генерации ответа</b>\n\n` +
              `Проблема при генерации AI ответа. Пожалуйста, попробуйте снова.`,
            en:
              `❌ <b>Error generating answer</b>\n\n` +
              `Problem generating AI answer. Please try again.`,
          };
          await ctx.reply(errorText[lang] || errorText['en'], {
            parse_mode: 'HTML',
          });
          return;
        }

        const responseText: Record<string, string> = {
          uz:
            `📝 <b>Transkripsiya:</b> ${transcribedText}\n\n` +
            `💡 <b>Javob:</b>\n\n${answer.content}`,
          ru:
            `📝 <b>Транскрипция:</b> ${transcribedText}\n\n` +
            `💡 <b>Ответ:</b>\n\n${answer.content}`,
          en:
            `📝 <b>Transcription:</b> ${transcribedText}\n\n` +
            `💡 <b>Answer:</b>\n\n${answer.content}`,
        };

        await ctx.reply(responseText[lang] || responseText['en'], {
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      this.logger.error(`Voice message error: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz:
          `❌ <b>Ovozli xabarni qayta ishlashda xatolik</b>\n\n` +
          `Ovozli xabaringizni qayta ishlashda muammo bo'ldi.\n\n` +
          `Iltimos:\n` +
          `• Internet aloqasini tekshiring\n` +
          `• Qayta urinib ko'ring\n` +
          `• Yoki matn xabar yuboring`,
        ru:
          `❌ <b>Ошибка обработки голосового сообщения</b>\n\n` +
          `Произошла ошибка при обработке вашего голосового сообщения.\n\n` +
          `Пожалуйста:\n` +
          `• Проверьте интернет-соединение\n` +
          `• Попробуйте снова\n` +
          `• Или отправьте текстовое сообщение`,
        en:
          `❌ <b>Voice message processing error</b>\n\n` +
          `An error occurred while processing your voice message.\n\n` +
          `Please:\n` +
          `• Check your internet connection\n` +
          `• Try again\n` +
          `• Or send a text message`,
      };
      await ctx.reply(errorText[lang] || errorText['en'], {
        parse_mode: 'HTML',
      });
    }
  }

  private async handleLiveVoiceMessage(ctx: BotContext, transcribedText: string, userId: string) {
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

    // Get AI session from live service
    const liveSessionModel = this.liveService.getSessionModel();
    const telegramSession = await liveSessionModel.findOne({
      telegramChatId: telegramId,
      status: 'live_session',
    });

    let sessionId = telegramSession?.context;
    if (!sessionId) {
      sessionId = (await this.contextService.createSession(userId, 'live_interview')).id;
      await liveSessionModel.findOneAndUpdate(
        { telegramChatId: telegramId },
        { context: sessionId },
      );
    }

    // Generate answer with context and error handling
    let answerResponse;
    let answer;
    try {
      answerResponse = await this.answerService.generateAnswer(userId, {
        question: transcribedText,
        sessionId,
        variations: 1,
        style: 'professional',
        length: 'medium',
        language: lang, // Pass user's language preference
      });
      answer = answerResponse.answers[0];
    } catch (error) {
      this.logger.error(`AI answer generation failed in live mode: ${error.message}`, error.stack);

      // Check if it's a BadRequestException (API key not configured)
      const isApiKeyError =
        error.message?.includes('not configured') || error.message?.includes('OPENAI_API_KEY');

      const errorText: Record<string, string> = {
        uz: isApiKeyError
          ? `❌ <b>AI xizmati sozlanganmagan</b>\n\n` +
            `AI javob yaratish uchun OPENAI_API_KEY sozlanishi kerak.\n\n` +
            `Hozircha faqat matn xabarlarni qabul qilamiz.\n\n` +
            `Live rejimni to'xtatish uchun /end_live buyrug'ini yuboring.`
          : `❌ <b>Javob yaratishda xatolik</b>\n\n` +
            `AI javob yaratishda muammo bo'ldi.\n\n` +
            `Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Qayta urinib ko'ring\n` +
            `• Yoki /end_live bilan sessiyani to'xtating`,
        ru: isApiKeyError
          ? `❌ <b>AI сервис не настроен</b>\n\n` +
            `Для генерации AI ответов необходимо настроить OPENAI_API_KEY.\n\n` +
            `Пока мы принимаем только текстовые сообщения.\n\n` +
            `Используйте /end_live для остановки live режима.`
          : `❌ <b>Ошибка при генерации ответа</b>\n\n` +
            `Проблема при генерации AI ответа.\n\n` +
            `Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Попробуйте снова\n` +
            `• Или остановите сессию с /end_live`,
        en: isApiKeyError
          ? `❌ <b>AI service not configured</b>\n\n` +
            `OPENAI_API_KEY needs to be configured for AI answer generation.\n\n` +
            `For now, we only accept text messages.\n\n` +
            `Use /end_live to stop live mode.`
          : `❌ <b>Error generating answer</b>\n\n` +
            `Problem generating AI answer.\n\n` +
            `Please:\n` +
            `• Check your internet connection\n` +
            `• Try again\n` +
            `• Or stop the session with /end_live`,
      };
      await ctx.reply(errorText[lang] || errorText['en'], {
        parse_mode: 'HTML',
      });
      return;
    }

    const responseText: Record<string, string> = {
      uz:
        `📝 <b>Transkripsiya:</b> ${transcribedText}\n\n` +
        `💡 <b>Javob:</b>\n\n${answer.content}` +
        (answer.keyPoints?.length
          ? `\n\n📌 <b>Asosiy nuqtalar:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}`
          : ''),
      ru:
        `📝 <b>Транскрипция:</b> ${transcribedText}\n\n` +
        `💡 <b>Ответ:</b>\n\n${answer.content}` +
        (answer.keyPoints?.length
          ? `\n\n📌 <b>Ключевые моменты:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}`
          : ''),
      en:
        `📝 <b>Transcription:</b> ${transcribedText}\n\n` +
        `💡 <b>Answer:</b>\n\n${answer.content}` +
        (answer.keyPoints?.length
          ? `\n\n📌 <b>Key Points:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}`
          : ''),
    };

    await ctx.reply(responseText[lang] || responseText['en'], {
      parse_mode: 'HTML',
    });

    // Update live session
    await liveSessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      {
        $push: {
          messages: {
            timestamp: new Date(),
            type: 'question',
            content: transcribedText,
            audioUrl: undefined,
            aiResponse: answer.content,
            processingTime: answerResponse.processingTime,
          },
        },
        lastActivityAt: new Date(),
      },
    );
  }
}
