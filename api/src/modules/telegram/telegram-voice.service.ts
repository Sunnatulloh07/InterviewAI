import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiSttService } from '../ai/ai-stt.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { AiGeminiAudioService } from '../ai/ai-gemini-audio.service';
import { BotContext } from './telegram.service';
import { Voice } from 'grammy/types';
import { UsersService } from '../users/users.service';
import { TelegramLiveService } from './telegram-live.service';
import { AiContextService } from '../ai/ai-context.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { InterviewsService } from '../interviews/interviews.service';
import { InterviewsFeedbackService } from '../interviews/interviews-feedback.service';
import { SubscriptionService } from '../payments/subscription.service';

@Injectable()
export class TelegramVoiceService {
  private readonly logger = new Logger(TelegramVoiceService.name);

  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly geminiAudioService: AiGeminiAudioService,
    private readonly usersService: UsersService,
    private readonly liveService: TelegramLiveService,
    private readonly contextService: AiContextService,
    private readonly configService: ConfigService,
    private readonly commandsService: TelegramCommandsService,
    private readonly interviewsService: InterviewsService,
    private readonly interviewsFeedbackService: InterviewsFeedbackService,
    private readonly subscriptionService: SubscriptionService,
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

    // CRITICAL: Check if user is in an active flow before processing voice
    // Voice messages should only be processed during:
    // 1. Live session (liveSessionStep is 'active' or has liveSessionMetadata)
    // 2. Mock interview (currentInterviewSessionId is set)
    const isInLiveSession = ctx.session.liveSessionStep === 'active' || 
      (ctx.session.liveSessionStep && ctx.session.liveSessionStep !== 'complete');
    const isInMockInterview = ctx.session.currentInterviewSessionId !== undefined;
    
    if (!isInLiveSession && !isInMockInterview) {
      // User is not in any active flow - reject voice message
      const notInFlowText: Record<string, string> = {
        uz: `🎤 Ovozli xabar faqat intervyu yoki live sessiyada qabul qilinadi.\n\nIntervyu boshlash uchun "🎯 Intervyu" tugmasini bosing.`,
        ru: `🎤 Голосовые сообщения принимаются только во время интервью или live-сессии.\n\nНажмите "🎯 Интервью", чтобы начать.`,
        en: `🎤 Voice messages are only accepted during interview or live sessions.\n\nPress "🎯 Interview" to start.`,
      };
      await ctx.reply(notInFlowText[lang] || notInFlowText['en']);
      return;
    }

    // Get user ID early (needed for checks)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;

    // Check if voice messages are allowed for this plan and mode
    const canUseVoice = await this.subscriptionService.canUseVoice(userId, !!isInLiveSession);
    if (!canUseVoice) {
      const featureName = isInLiveSession ? 'Voice in Live' : 'Voice Messages';
      this.logger.warn(`User ${userId} tried to use ${featureName} but not allowed by plan`);
      
      const upgradeText: Record<string, string> = {
        uz: `🔒 <b>Ovozli xabarlar cheklangan</b>\n\nSizning tarifingizda bu funksiya mavjud emas.\nIltimos, /upgrade buyrug'i orqali tarifni yangilang.`,
        ru: `🔒 <b>Голосовые сообщения ограничены</b>\n\nВ вашем тарифе эта функция недоступна.\nПожалуйста, обновите тариф через /upgrade.`,
        en: `🔒 <b>Voice messages restricted</b>\n\nThis feature is not available in your plan.\nPlease upgrade using /upgrade.`,
      };
      await ctx.reply(upgradeText[lang] || upgradeText['en'], { parse_mode: 'HTML' });
      return;
    }

    try {
      // Show initial processing message
      const processingText: Record<string, string> = {
        uz: `🎤 Ovozli xabar qayta ishlanmoqda...`,
        ru: `🎤 Обрабатывается голосовое сообщение...`,
        en: `🎤 Processing voice message...`,
      };
      const processingMsg = await ctx.reply(processingText[lang] || processingText['en']);

      // Download voice file (parallel with message sending)
      const voice = ctx.message?.voice as Voice;
      if (!voice) {
        throw new Error('Voice message not found');
      }

      // Optimized: Download and transcribe in parallel where possible
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

      // Get user ID early (needed for all paths)
      const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
      if (!userId) {
        this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
        const errorText: Record<string, string> = {
          uz: `❌ Xatolik: Foydalanuvchi ID topilmadi.`,
          ru: `❌ Ошибка: ID пользователя не найден.`,
          en: `❌ Error: User ID not found.`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // GEMINI MULTIMODAL: Process ALL voice messages with Gemini
      // This handles audio directly without separate STT step
      // ═══════════════════════════════════════════════════════════════════
      
      if (this.geminiAudioService.isEnabled()) {
        this.logger.log(`Using Gemini for voice message from user ${userId}`);
        
        try {
          // Get session metadata if available
          const metadata = ctx.session?.liveSessionMetadata || {};
          
          // Process audio with Gemini
          const response = await this.geminiAudioService.processLiveAudio({
            audioBase64: base64Audio,
            mimeType: 'audio/ogg', // Telegram voice messages are OGG
            context: {
              domain: metadata.domain,
              technologies: metadata.technologies,
              position: metadata.position,
              company: metadata.company,
            },
            language: lang,
          });

          // Delete processing message
          try {
            await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
          } catch {
            // Ignore delete errors
          }

          // Format response
          const responseText = `${response.text}\n\n⏱️ ${response.processingTime}ms | 🤖 Gemini`;
          
          // Send with smart chunking and fallback
          await this.sendSafeMessage(ctx, responseText);
          
          // Deduct usage
          try {
            await this.subscriptionService.addLiveMinutes(userId, 1);
          } catch (error: any) {
            this.logger.warn(`Failed to deduct minutes: ${error.message}`);
          }

          this.logger.log(
            `Gemini audio processed: ${response.processingTime}ms, user=${userId}`,
          );
          return;
        } catch (error: any) {
          this.logger.error(
            `Gemini audio failed: ${error.message}. STT is disabled, cannot fallback.`,
            error.stack,
          );
          const errorText: Record<string, string> = {
            uz: `❌ Ovozli xabarni qayta ishlashda xatolik: ${error.message}`,
            ru: `❌ Ошибка обработки голосового сообщения: ${error.message}`,
            en: `❌ Voice message processing error: ${error.message}`,
          };
          await ctx.reply(errorText[lang] || errorText['en'], {
            parse_mode: 'HTML',
          });
          return;
        }
      }



      // ═══════════════════════════════════════════════════════════════════
      // FALLBACK: STT + LLM (only if Gemini is disabled)
      // ═══════════════════════════════════════════════════════════════════
      
      // Update message: Transcribing
      const transcribingText: Record<string, string> = {
        uz: `🎤 Ovozli xabar qayta ishlanmoqda...\n📝 Matnga o'girilmoqda...`,
        ru: `🎤 Обрабатывается голосовое сообщение...\n📝 Преобразуется в текст...`,
        en: `🎤 Processing voice message...\n📝 Transcribing...`,
      };
      try {
        await ctx.api.editMessageText(
          processingMsg.chat.id,
          processingMsg.message_id,
          transcribingText[lang] || transcribingText['en'],
        );
      } catch {
        // Ignore edit errors
      }

      // Transcribe with error handling (optimized polling)
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

      // Check if in live session (for STT fallback path)
      const isLive = await this.liveService.isInLiveSession(telegramId);
      
      if (isLive) {
        await this.handleLiveVoiceMessage(ctx, transcribedText, userId);
        return;
      }

      // Check if in interview session (answering interview questions)
      // This handles both MOCK and REAL interview modes
      if (ctx.session.currentInterviewSessionId && ctx.session.currentQuestionIndex !== undefined) {
        // MOCK INTERVIEW: Block voice messages - text only
        // Check if this is a mock interview (not live)
        if (ctx.session.interviewMode === 'mock') {
          const voiceBlockedText: Record<string, string> = {
            uz: `❌ Mock interviewda ovozli xabar qabul qilinmaydi.\n\nIltimos, javobingizni <b>matn</b> shaklida yuboring.`,
            ru: `❌ В mock-интервью голосовые сообщения не принимаются.\n\nПожалуйста, отправьте ваш ответ <b>текстом</b>.`,
            en: `❌ Voice messages are not accepted in mock interviews.\n\nPlease send your answer as <b>text</b>.`,
          };
          await ctx.reply(voiceBlockedText[lang] || voiceBlockedText['en'], {
            parse_mode: 'HTML',
          });
          return;
        }
        
        // Handle as interview answer (voice message) - Only for LIVE interviews
        // Get user ID (handle both _id and id fields)
        const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
        if (!userId) {
          this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
          const errorText: Record<string, string> = {
            uz: `❌ Xatolik: Foydalanuvchi ID topilmadi.`,
            ru: `❌ Ошибка: ID пользователя не найден.`,
            en: `❌ Error: User ID not found.`,
          };
          await ctx.reply(errorText[lang] || errorText['en'], {
            parse_mode: 'HTML',
          });
          return;
        }

        // Handle interview answer with audio support
        await this.handleInterviewVoiceAnswer(
          ctx,
          transcribedText,
          userId,
          base64Audio,
          transcription,
        );
        return;
      }

      // Regular voice message (not in live or interview session)
      // Handle as regular voice message with error handling
      // Note: userId is already declared at line 94

      let answerResponse;
      let answer;
      try {
        // Use the language we already retrieved (lang is already from DB if session was empty)
        answerResponse = await this.answerService.generateAnswer(userId, {
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

  /**
   * Handle voice message answer in interview session (Mock or Real interview)
   * Uses Aisha STT for transcription
   */
  private async handleInterviewVoiceAnswer(
    ctx: BotContext,
    transcribedText: string,
    userId: string,
    base64Audio: string,
    transcription: any,
  ) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang && user) {
      lang = user.preferences?.language || user.language || 'en';
      if (ctx.session) {
        ctx.session.language = lang;
      }
    } else if (!lang) {
      lang = 'en';
    }

    const sessionId = ctx.session.currentInterviewSessionId;
    const questionIndex = ctx.session.currentQuestionIndex;

    if (!sessionId || questionIndex === undefined) {
      const errorText: Record<string, string> = {
        uz: `Aktiv intervyu topilmadi.`,
        ru: `Активное интервью не найдено.`,
        en: `No active interview found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    try {
      // Get interview session to find current question
      const session = await this.interviewsService.getSession(userId, sessionId);
      const sessionQuestions = session.questions as any[];
      const currentQuestion = sessionQuestions[questionIndex];

      if (!currentQuestion) {
        const errorText: Record<string, string> = {
          uz: `Savol topilmadi.`,
          ru: `Вопрос не найден.`,
          en: `Question not found.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      // Get question ID - handle both populated objects and ObjectId strings
      let questionId: string;
      if (typeof currentQuestion === 'object' && currentQuestion._id) {
        questionId = currentQuestion._id.toString();
      } else if (currentQuestion.id) {
        questionId = currentQuestion.id.toString();
      } else {
        questionId = currentQuestion.toString();
      }

      // OPTIMIZATION: Removed redundant messages for speed
      const audioUrl: string | undefined = undefined;

      // Submit answer with audio support
      await this.interviewsService.submitAnswer(userId, sessionId, {
        questionId,
        answerType: 'audio', // Mark as audio answer
        answerText: transcribedText, // Transcribed text from Aisha STT
        transcript: transcribedText, // Explicit transcript field
        audioUrl: audioUrl, // Optional: URL to stored audio file
        duration: transcription.duration || 0, // Audio duration from transcription
      });

      // Simple confirmation
      const confirmText: Record<string, string> = {
        uz: `✅ Javobingiz qabul qilindi`,
        ru: `✅ Ваш ответ принят`,
        en: `✅ Your answer has been accepted`,
      };
      await ctx.reply(confirmText[lang] || confirmText['en']);

      // Move to next question or end interview
      // Increment question index
      ctx.session.currentQuestionIndex = questionIndex + 1;

      // Check if there are more questions
      const updatedSession = await this.interviewsService.getSession(userId, sessionId);
      const allQuestions = updatedSession.questions as any[];

      if (ctx.session.currentQuestionIndex >= allQuestions.length) {
        // Interview completed
        await this.interviewsService.completeSession(userId, sessionId);
        ctx.session.currentInterviewSessionId = undefined;
        ctx.session.currentQuestionIndex = undefined;

        const completeText: Record<string, string> = {
          uz: `🎉 <b>Intervyu yakunlandi!</b>\n\nNatijalarni ko'rish uchun /stats buyrug'ini yuboring.`,
          ru: `🎉 <b>Интервью завершено!</b>\n\nИспользуйте /stats для просмотра результатов.`,
          en: `🎉 <b>Interview completed!</b>\n\nUse /stats to view results.`,
        };
        await ctx.reply(completeText[lang] || completeText['en'], {
          parse_mode: 'HTML',
        });
      } else {
        // Show next question
        const nextQuestion = allQuestions[ctx.session.currentQuestionIndex];
        const questionText = typeof nextQuestion === 'object' ? nextQuestion.text : nextQuestion;

        const nextQuestionText: Record<string, string> = {
          uz: `📝 <b>Savol ${ctx.session.currentQuestionIndex + 1}/${allQuestions.length}:</b>\n\n${questionText}`,
          ru: `📝 <b>Вопрос ${ctx.session.currentQuestionIndex + 1}/${allQuestions.length}:</b>\n\n${questionText}`,
          en: `📝 <b>Question ${ctx.session.currentQuestionIndex + 1}/${allQuestions.length}:</b>\n\n${questionText}`,
        };
        await ctx.reply(nextQuestionText[lang] || nextQuestionText['en'], {
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      this.logger.error(`Failed to handle interview voice answer: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `❌ Javobni saqlashda xatolik yuz berdi.`,
        ru: `❌ Ошибка при сохранении ответа.`,
        en: `❌ Error saving answer.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
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

    // Get live session metadata for context
    const sessionMetadata = telegramSession?.metadata as any;
    const sessionLiveMetadata = ctx.session.liveSessionMetadata;
    const metadata = sessionMetadata || sessionLiveMetadata || {};

    // Generate answer with context and error handling
    // Pass metadata for better context-aware answers and transcription error correction
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
        // Pass live session metadata for context
        domain: (metadata as any).domain,
        technologies: (metadata as any).technologies || [],
        position: (metadata as any).position,
        company: (metadata as any).company,
      });
      answer = answerResponse.answers[0];

      // Save question and answer to AI context for conversation history
      if (sessionId) {
        try {
          // Add user question (transcribed text) to context
          await this.contextService.addMessage(sessionId, {
            role: 'user',
            content: transcribedText,
            type: 'question',
            timestamp: new Date(),
          });

          // Add AI answer to context
          await this.contextService.addMessage(sessionId, {
            role: 'assistant',
            content: answer.content,
            type: 'answer',
            timestamp: new Date(),
          });
        } catch (error) {
          this.logger.warn(`Failed to save message to context: ${error.message}`);
          // Continue - not critical for functionality
        }
      }
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

  /**
   * Handle live voice message using Gemini multimodal (faster path)
   * 
   * This method sends audio directly to Gemini, which:
   * 1. Transcribes the audio
   * 2. Understands the context
   * 3. Generates a professional response
   * 
   * Benefits:
   * - Single API call instead of STT + LLM
   * - ~60-70% faster response time
   * - Audio context preserved (tone, emphasis)
   */
  private async handleLiveVoiceWithGemini(
    ctx: BotContext,
    audioBase64: string,
    userId: string,
    lang: string,
  ): Promise<void> {
    const telegramId = ctx.from?.id as number;
    
    // Get metadata from session
    const metadata = ctx.session.liveSessionMetadata || {};
    
    // Show processing message (Gemini-specific)
    const processingText: Record<string, string> = {
      uz: `🚀 Audio tahlil qilinmoqda (Gemini)...`,
      ru: `🚀 Анализ аудио (Gemini)...`,
      en: `🚀 Analyzing audio (Gemini)...`,
    };
    const processingMsg = await ctx.reply(processingText[lang] || processingText['en']);

    try {
      // Process audio with Gemini
      const response = await this.geminiAudioService.processLiveAudio({
        audioBase64,
        mimeType: 'audio/ogg', // Telegram voice messages are OGG
        context: {
          domain: metadata.domain,
          technologies: metadata.technologies,
          position: metadata.position,
          company: metadata.company,
        },
        language: lang,
      });

      // Delete processing message
      try {
        await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
      } catch {
        // Ignore delete errors
      }

      // Format and send response
      const responseText = `${response.text}\n\n⏱️ ${response.processingTime}ms | 🤖 Gemini`;
      
      await ctx.reply(responseText, {
        parse_mode: 'HTML',
      });

      // Deduct live interview minutes
      try {
        const allowed = await this.subscriptionService.addLiveMinutes(userId, 1);
        if (!allowed) {
          const limitText: Record<string, string> = {
            uz: `⚠️ <b>Live intervyu daqiqalari tugadi</b>\n\nKo'proq daqiqalar uchun: /upgrade`,
            ru: `⚠️ <b>Минуты live-интервью закончились</b>\n\nДля продолжения: /upgrade`,
            en: `⚠️ <b>Live interview minutes exhausted</b>\n\nTo continue: /upgrade`,
          };
          await ctx.reply(limitText[lang] || limitText['en'], {
            parse_mode: 'HTML',
          });
        }
      } catch (error: any) {
        this.logger.warn(`Failed to deduct live minutes: ${error.message}`);
      }

      this.logger.log(
        `Gemini live audio processed: ${response.processingTime}ms, user=${userId}`,
      );
    } catch (error: any) {
      // Delete processing message on error
      try {
        await ctx.api.deleteMessage(processingMsg.chat.id, processingMsg.message_id);
      } catch {
        // Ignore
      }
      
      // Re-throw to trigger fallback
      throw error;
    }
  }

  /**
   * Send message with smart splitting and Markdown fallback
   */
  private async sendSafeMessage(ctx: BotContext, text: string): Promise<void> {
    const chunks = this.splitMarkdownMessage(text);
    
    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch (error: any) {
        this.logger.warn(`Failed to send Markdown message, falling back to text: ${error.message}`);
        // Fallback: send as plain text if Markdown parsing fails
        await ctx.reply(chunk);
      }
    }
  }

  /**
   * Split Markdown text into chunks, preserving code blocks
   */
  private splitMarkdownMessage(text: string, limit = 4000): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    let insideCodeBlock = false;
    let currentLanguage = '';

    const lines = text.split('\n');
    
    for (const line of lines) {
      // Check for code block toggle
      if (line.trim().startsWith('```')) {
        insideCodeBlock = !insideCodeBlock;
        if (insideCodeBlock) {
          // Extract language if present (e.g. ```typescript)
          currentLanguage = line.trim().slice(3).trim(); 
        } else {
          currentLanguage = '';
        }
      }

      // Check if adding this line would exceed limit
      // We reserve ~20 chars for closing/reopening blocks
      if ((currentChunk + line).length + 20 > limit) {
        if (insideCodeBlock) {
          // Close current block in this chunk
          chunks.push(currentChunk + '```');
          // Start next chunk with reopened block
          currentChunk = '```' + currentLanguage + '\n' + line + '\n';
        } else {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        }
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }
}
