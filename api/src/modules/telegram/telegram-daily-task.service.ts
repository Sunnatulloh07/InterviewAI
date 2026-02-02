import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios, { AxiosError } from 'axios';
import { AiOcrService } from '../ai/ai-ocr.service';
import { AiTtsService } from '../ai/ai-tts.service';
import { TelegramService, BotContext } from './telegram.service';
import { InputFile } from 'grammy';
import { DailyTasksService } from '../tasks/daily-tasks.service';
import { UsersService } from '../users/users.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { AiSttService } from '../ai/ai-stt.service';
import { TelegramSession, TelegramSessionDocument } from './schemas/telegram-session.schema';
import { COMPLETE_PLAN_LIMITS } from '../../common/constants/plan-limits.constant';

/**
 * Telegram Daily Task Handler Service
 *
 * Handles daily task answer submissions via Telegram
 * Supports: text, voice, image answers
 * Validates plan permissions before processing
 *
 * UPDATED: Now includes OCR integration with OpenRouter Vision API (Gemini 2.5 Flash)
 */
@Injectable()
export class TelegramDailyTaskService {
  private readonly logger = new Logger(TelegramDailyTaskService.name);
  private readonly openrouterBaseUrl: string;
  private readonly openrouterApiKey: string;

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly dailyTasksService: DailyTasksService,
    private readonly usersService: UsersService,
    private readonly voiceQuotaService: VoiceQuotaService,
    private readonly sttService: AiSttService,
    private readonly configService: ConfigService,
    private readonly ocrService: AiOcrService,
    private readonly ttsService: AiTtsService,
    @InjectModel(TelegramSession.name)
    private readonly sessionModel: Model<TelegramSessionDocument>,
  ) {
    this.openrouterBaseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    this.openrouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';

    if (!this.openrouterApiKey) {
      this.logger.warn('OPENROUTER_API_KEY not configured. Image OCR will be unavailable.');
    }
  }

  /**
   * Start daily task session for user
   * Called when user clicks /tasks or receives daily tasks
   */
  async startDailyTaskSession(ctx: BotContext, userId: string): Promise<void> {
    try {
      this.logger.debug(`Starting daily task session for userId: ${userId}`);

      // Get today's tasks
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dailyTask = await this.dailyTasksService.getTodayTasks(userId, today);

      if (!dailyTask) {
        this.logger.warn(`No tasks found for userId: ${userId} on ${today.toISOString()}`);
        const noTasksText = {
          uz: '❌ Bugun uchun vazifalar topilmadi.\n\nErtalab 09:00 da yangi vazifalar yuboriladi.',
          ru: '❌ Задачи на сегодня не найдены.\n\nНовые задачи будут отправлены в 09:00 утра.',
          en: '❌ No tasks found for today.\n\nNew tasks will be sent at 09:00 AM.',
        };
        const lang = ctx.session?.language || 'uz';
        await ctx.reply(noTasksText[lang as keyof typeof noTasksText] || noTasksText.uz);
        return;
      }

      this.logger.debug(
        `Found daily task for userId: ${userId}, tasks count: ${dailyTask.tasks.length}`,
      );

      // Find first incomplete task
      const currentTaskIndex = dailyTask.tasks.findIndex((t) => !t.completed);

      if (currentTaskIndex === -1) {
        this.logger.log(`All tasks completed for userId: ${userId}`);
        // All tasks completed
        const completedText = {
          uz: `✅ Bugun barcha vazifalar bajarilgan!\n\n🔥 Joriy ketma-ketlik: ${dailyTask.tasks.length} kun`,
          ru: `✅ Все задачи на сегодня выполнены!\n\n🔥 Текущая серия: ${dailyTask.tasks.length} дней`,
          en: `✅ All tasks for today are completed!\n\n🔥 Current streak: ${dailyTask.tasks.length} days`,
        };
        const lang = ctx.session?.language || 'uz';
        await ctx.reply(completedText[lang as keyof typeof completedText] || completedText.uz);
        return;
      }

      this.logger.debug(`Current task index: ${currentTaskIndex} for userId: ${userId}`);

      // Update session
      const chatId = ctx.chat?.id;
      if (chatId) {
        await this.sessionModel.findOneAndUpdate(
          { telegramChatId: chatId },
          {
            $set: {
              status: 'daily_task',
              dailyTaskSession: {
                dailyTaskId: (dailyTask as any)._id.toString(),
                currentTaskIndex,
                totalTasks: dailyTask.tasks.length,
                date: today,
              },
              lastActivityAt: new Date(),
            },
          },
          { upsert: true },
        );
        this.logger.debug(`Session updated for chatId: ${chatId}`);
      }

      // Show current task
      await this.showCurrentTask(ctx, dailyTask, currentTaskIndex);
      this.logger.log(`Successfully started daily task session for userId: ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to start daily task session: ${error.message}`, error.stack);
      await ctx.reply("❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.");
    }
  }

  /**
   * Show ALL TASKS to user (senior PM approach)
   * User can answer any task they want
   */
  private async showCurrentTask(
    ctx: BotContext,
    dailyTask: any,
    currentTaskIndex: number,
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';

    // Get user info
    const userId = ctx.session?.userId || '';
    if (!userId) return;
    const user = await this.usersService.findById(userId);
    const plan = user?.subscription?.plan || 'free_trial';
    const planLimits = this.getPlanLimits(plan);
    const position = user.profile?.position || 'junior';

    // Build ALL tasks overview
    let tasksOverview = '';
    dailyTask.tasks.forEach((task, index) => {
      const status = task.completed ? '✅' : '🔄';
      const currentMarker = index === currentTaskIndex ? ' 👉' : '   ';

      if (lang === 'uz') {
        tasksOverview += `${status}${currentMarker} ${index + 1}. ${task.question}\n`;
      } else if (lang === 'ru') {
        tasksOverview += `${status}${currentMarker} ${index + 1}. ${task.question}\n`;
      } else {
        tasksOverview += `${status}${currentMarker} ${index + 1}. ${task.question}\n`;
      }
    });

    // Build answer type instructions based on plan
    let answerInstructions = '';
    if (planLimits.dailyTasks.textAnswer) {
      answerInstructions += '✍️ Text yozing';
    }
    if (planLimits.dailyTasks.voiceAnswer) {
      answerInstructions += answerInstructions ? ' | ' : '';
      answerInstructions += '🎙️ Voice';
    }
    if (planLimits.dailyTasks.imageAnswer) {
      answerInstructions += answerInstructions ? ' | ' : '';
      answerInstructions += '📸 Image';
    }

    // Create professional PM message
    const headerText = {
      uz: `📚 <b>Bugungi vazifalar</b>\n\n${dailyTask.tasks.length} ta vazifa, ${dailyTask.tasks.filter((t) => !t.completed).length} ta qoldi\n\n💡 Foydalanuvchi ${position} darajasiga moslashtirilgan`,
      ru: `📚 <b>Ежедневные задания</b>\n\n${dailyTask.tasks.length} заданий, ${dailyTask.tasks.filter((t) => !t.completed).length} осталось\n\n💡 Адаптировано под уровень ${position}`,
      en: `📚 <b>Daily Tasks</b>\n\n${dailyTask.tasks.length} tasks, ${dailyTask.tasks.filter((t) => !t.completed).length} remaining\n\n💡 Adapted for ${position} level`,
    };

    const overviewText = {
      uz: `━━━━━━━━━━━━━━━━\n<b>Vazifalar ro'yxati:</b>\n${tasksOverview}`,
      ru: `━━━━━━━━━━━━━━━━\n<b>Список задач:</b>\n${tasksOverview}`,
      en: `━━━━━━━━━━━━━━━━\n<b>Task List:</b>\n${tasksOverview}`,
    };

    const instructionsText = {
      uz: `\n━━━━━━━━━━━━━━━━\n📝 <b>Javob turlari:</b> ${answerInstructions}\n\n💡 <b>Eslatma:</b> Video javoblar qo'llab-quvvatlanmaydi`,
      ru: `\n━━━━━━━━━━━━━━━━\n📝 <b>Типы ответов:</b> ${answerInstructions}\n\n💡 <b>Примечание:</b> Видео ответы не поддерживаются`,
      en: `\n━━━━━━━━━━━━━━━━\n📝 <b>Answer Types:</b> ${answerInstructions}\n\n💡 <b>Note:</b> Video answers not supported`,
    };

    const currentTaskText = {
      uz: `\n👉 <b>Joriy vazifa:</b>\n${currentTaskIndex + 1}. ${dailyTask.tasks[currentTaskIndex].question}`,
      ru: `\n👉 <b>Текущая задача:</b>\n${currentTaskIndex + 1}. ${dailyTask.tasks[currentTaskIndex].question}`,
      en: `\n👉 <b>Current Task:</b>\n${currentTaskIndex + 1}. ${dailyTask.tasks[currentTaskIndex].question}`,
    };

    // Combine all parts
    const fullMessage =
      headerText[lang] + overviewText[lang] + currentTaskText[lang] + instructionsText[lang];

    await ctx.reply(fullMessage, {
      parse_mode: 'HTML',
    });
  }

  /**
   * Handle text answer for daily task
   */
  async handleTextAnswer(ctx: BotContext, text: string): Promise<void> {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      const session = await this.sessionModel.findOne({
        telegramChatId: chatId,
        status: 'daily_task',
      });

      if (!session?.dailyTaskSession) {
        return; // Not in daily task mode
      }

      const { dailyTaskId, currentTaskIndex, date } = session.dailyTaskSession;
      const userId = session.userId.toString();

      // Submit answer
      const result = await this.dailyTasksService.completeTask(
        userId,
        date,
        currentTaskIndex,
        text,
      );

      // Show result
      await this.showTaskResult(ctx, result, currentTaskIndex);

      // Move to next task or end session
      if (!result.allCompleted) {
        await this.moveToNextTask(ctx, session, currentTaskIndex + 1);
      } else {
        await this.endDailyTaskSession(ctx, session, result);
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle text answer: ${error.message}`);
      await ctx.reply("❌ Javobni qayta ishlashda xatolik. Iltimos, qayta urinib ko'ring.");
    }
  }

  /**
   * Handle voice answer for daily task
   */
  async handleVoiceAnswer(ctx: BotContext, voice: any): Promise<void> {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      const session = await this.sessionModel.findOne({
        telegramChatId: chatId,
        status: 'daily_task',
      });

      if (!session?.dailyTaskSession) {
        return; // Not in daily task mode
      }

      const userId = session.userId.toString();
      const user = await this.usersService.findById(userId);
      const plan = user?.subscription?.plan || 'free_trial';
      const lang = ctx.session?.language || 'uz';

      // Check if plan allows voice answers
      if (!this.canUseDailyTaskVoiceAnswer(plan)) {
        const noVoiceText = {
          uz: '❌ Ovozli javob faqat Starter va yuqori tariflarda!\n\nMatn shaklida javob yuboring.',
          ru: '❌ Голосовые ответы только в Starter и выше!\n\nОтправьте текстовый ответ.',
          en: '❌ Voice answers only in Starter and higher plans!\n\nPlease send a text answer.',
        };
        await ctx.reply(noVoiceText[lang as keyof typeof noVoiceText] || noVoiceText.uz);
        return;
      }

      // Check voice quota before processing
      const estimatedMinutes = Math.ceil((voice.duration || 30) / 60);
      const hasQuota = await this.voiceQuotaService.hasEnoughQuota(
        userId,
        'mock',
        estimatedMinutes,
      );

      if (!hasQuota) {
        const quota = await this.voiceQuotaService.getQuota(userId);
        const noQuotaText = {
          uz: `❌ Ovozli javob uchun yetarli daqiqa yo'q!\n\nMavjud: ${quota.mockVoice.remaining} daqiqa\nMatn shaklida javob yuboring.`,
          ru: `❌ Недостаточно минут для голосового ответа!\n\nДоступно: ${quota.mockVoice.remaining} мин\nПродолжите текстом.`,
          en: `❌ Not enough voice minutes!\n\nAvailable: ${quota.mockVoice.remaining} min\nContinue with text.`,
        };
        await ctx.reply(noQuotaText[lang] || noQuotaText.uz);
        return;
      }

      // Show processing message
      const processingText = {
        uz: '🎤 Ovozli xabar qayta ishlanmoqda...',
        ru: '🎤 Обрабатывается голосовое сообщение...',
        en: '🎤 Processing voice message...',
      };
      const processingMsg = await ctx.reply(processingText[lang] || processingText.uz);

      // Download and transcribe voice
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Transcribe using STT
      const base64Audio = buffer.toString('base64');
      const transcription = await this.sttService.transcribe({
        audioData: `data:audio/ogg;base64,${base64Audio}`,
        language: lang,
      });

      // Delete processing message
      try {
        await ctx.api.deleteMessage(chatId, processingMsg.message_id);
      } catch (deleteError) {
        // Message might already be deleted or expired - safe to ignore
      }

      // Submit transcribed answer
      const { dailyTaskId, currentTaskIndex, date } = session.dailyTaskSession;

      const result = await this.dailyTasksService.completeTask(userId, date, currentTaskIndex, {
        type: 'voice',
        content: transcription.text,
        transcript: transcription.text,
      });

      // Deduct voice quota after successful processing
      await this.voiceQuotaService.checkAndUseVoice(
        userId,
        'mock',
        voice.duration || 30,
        undefined,
        transcription.text.substring(0, 500),
      );

      // Show result
      await this.showTaskResult(ctx, result, currentTaskIndex);

      // Move to next task or end session
      if (!result.allCompleted) {
        await this.moveToNextTask(ctx, session, currentTaskIndex + 1);
      } else {
        await this.endDailyTaskSession(ctx, session, result);
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle voice answer: ${error.message}`);
      await ctx.reply(
        "❌ Ovozli xabarni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko'ring.",
      );
    }
  }

  /**
   * Handle image answer for daily task
   * UPDATED: Now implements OCR with OpenRouter Vision API
   */
  async handleImageAnswer(ctx: BotContext, photo: any): Promise<void> {
    try {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      const session = await this.sessionModel.findOne({
        telegramChatId: chatId,
        status: 'daily_task',
      });

      if (!session?.dailyTaskSession) {
        return; // Not in daily task mode
      }

      const userId = session.userId.toString();
      const user = await this.usersService.findById(userId);
      const plan = user?.subscription?.plan || 'free_trial';
      const lang = ctx.session?.language || 'uz';

      // Check if plan allows image answers
      if (!this.canUseDailyTaskImageAnswer(plan)) {
        const noImageText = {
          uz: '❌ Rasm javob faqat Starter va yuqori tariflarda!\n\nMatn shaklida javob yuboring.',
          ru: '❌ Ответы изображениями только в Starter и выше!\n\nОтправьте текстовый ответ.',
          en: '❌ Image answers only in Starter and higher plans!\n\nPlease send a text answer.',
        };
        await ctx.reply(noImageText[lang] || noImageText.uz);
        return;
      }

      // Show processing message
      const processingText = {
        uz: '📸 Rasmni tahlil qilinmoqda...',
        ru: '📸 Изображение анализируется...',
        en: '📸 Processing image...',
      };
      const processingMsg = await ctx.reply(
        processingText[lang as keyof typeof processingText] || processingText.uz,
      );

      // Get highest resolution photo
      const largestPhoto = photo[photo.length - 1];
      const file = await ctx.api.getFile(largestPhoto.file_id);

      // Download image
      const fileUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      // Check file size (plan-based limit)
      const planLimits = COMPLETE_PLAN_LIMITS[plan];
      const maxSizeMB = planLimits.fileUploads.maxSize;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      if (imageBuffer.length > maxSizeBytes) {
        const sizeInMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);
        const tooLargeText = {
          uz: `❌ Rasm hajmi katta! Max: ${maxSizeMB}MB. Sizda: ${sizeInMB}MB`,
          ru: `❌ Изображение слишком велико! Макс: ${maxSizeMB}МБ. У вас: ${sizeInMB}МБ`,
          en: `❌ Image too large! Max: ${maxSizeMB}MB. Yours: ${sizeInMB}MB`,
        };

        try {
          await ctx.api.deleteMessage(chatId, processingMsg.message_id);
        } catch (deleteError) {
          // Message might already be deleted or expired - safe to ignore
        }

        await ctx.reply(tooLargeText[lang] || tooLargeText.uz);
        return;
      }

      // Detect MIME type
      const mimeType = 'image/jpeg'; // Telegram sends as JPEG by default

      // Extract text using OpenRouter Vision API
      let extractedText: string;
      let confidence = 0;

      try {
        const ocrResult = await this.ocrService.recognize(imageBuffer, mimeType, lang);
        extractedText = ocrResult.text;
        confidence = ocrResult.confidence;
      } catch (ocrError: any) {
        this.logger.error(`OCR processing failed: ${ocrError.message}`);
        extractedText = '';
        confidence = 0;
      }

      // Delete processing message
      try {
        await ctx.api.deleteMessage(chatId, processingMsg.message_id);
      } catch (deleteError) {
        // Message might already be deleted or expired - safe to ignore
      }

      // If OCR failed, ask for text answer
      if (!extractedText || confidence < 0.5) {
        const fallbackText = {
          uz: '⚠️ Rasmdan matn topilmadi.\n\n📸 Rasmni yana yuborsangiz yoki matn bilan javob bering.',
          ru: '⚠️ Не удалось извлечь текст с изображения.\n\n📸 Отправьте повторно или введите текстовый ответ.',
          en: '⚠️ Could not extract text from image.\n\n📸 Please send again or type your answer.',
        };
        await ctx.reply(fallbackText[lang as keyof typeof fallbackText] || fallbackText.uz);
        return;
      }

      // Submit extracted text as answer
      const { dailyTaskId, currentTaskIndex, date } = session.dailyTaskSession;

      const result = await this.dailyTasksService.completeTask(userId, date, currentTaskIndex, {
        type: 'image',
        content: extractedText,
        imageUrl: fileUrl,
      });

      // Show result
      await this.showTaskResult(ctx, result, currentTaskIndex);

      // Move to next task or end session
      if (!result.allCompleted) {
        await this.moveToNextTask(ctx, session, currentTaskIndex + 1);
      } else {
        await this.endDailyTaskSession(ctx, session, result);
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle image answer: ${error.message}`);
      await ctx.reply("❌ Rasmni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko'ring.");
    }
  }

  /**
   * Show task completion result
   */
  private async showTaskResult(
    ctx: BotContext,
    result: { score: number; feedback: string; allCompleted: boolean },
    taskIndex: number,
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';

    let emoji = '⚪';
    if (result.score >= 8) emoji = '🟢';
    else if (result.score >= 5) emoji = '🟡';
    else emoji = '🔴';

    const resultText = {
      uz: `${emoji} <b>Vazifa ${taskIndex + 1} bajarildi!</b>\n\n📊 <b>Baho:</b> ${result.score}/10\n💬 <b>Feedback:</b> ${result.feedback}`,
      ru: `${emoji} <b>Задание ${taskIndex + 1} выполнено!</b>\n\n📊 <b>Оценка:</b> ${result.score}/10\n💬 <b>Отзыв:</b> ${result.feedback}`,
      en: `${emoji} <b>Task ${taskIndex + 1} completed!</b>\n\n📊 <b>Score:</b> ${result.score}/10\n💬 <b>Feedback:</b> ${result.feedback}`,
    };

    await ctx.reply(resultText[lang] || resultText.uz, {
      parse_mode: 'HTML',
    });

    await this.sendVoiceExplanation(ctx, result, lang);
  }

  /**
   * Send voice explanation (TTS) for users with eligible plans
   */
  private async sendVoiceExplanation(
    ctx: BotContext,
    result: { score: number; feedback: string },
    lang: string,
  ): Promise<void> {
    try {
      const userId = ctx.session?.userId;
      if (!userId) {
        return;
      }

      const user = await this.usersService.findById(userId);
      if (!user) {
        return;
      }

      const plan = user.subscription?.plan || 'free_trial';
      const planLimits = COMPLETE_PLAN_LIMITS[plan];

      if (!planLimits || !planLimits.aiFeatures.voiceExplanations) {
        return;
      }

      if (!this.ttsService.isEnabled()) {
        this.logger.debug('TTS service not enabled, skipping voice explanation');
        return;
      }

      const { audioBuffer } = await this.ttsService.synthesize(result.feedback, {
        language: lang,
        voice: 'alloy',
      });

      await ctx.replyWithAudio(new InputFile(audioBuffer), {
        caption: '🔊 Ovozli izoh (Voice explanation)',
      });

      this.logger.log(`Voice explanation sent to user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send voice explanation: ${error.message}`);
    }
  }

  /**
   * Move to next task
   */
  private async moveToNextTask(
    ctx: BotContext,
    session: TelegramSessionDocument,
    nextTaskIndex: number,
  ): Promise<void> {
    try {
      // Get daily task
      const dailyTask = await this.dailyTasksService.getTodayTasks(
        session.userId.toString(),
        session.dailyTaskSession?.date,
      );

      if (!dailyTask || nextTaskIndex >= dailyTask.tasks.length) {
        return;
      }

      // Show next task
      await this.showCurrentTask(ctx, dailyTask, nextTaskIndex);

      // Update session
      await this.sessionModel.findByIdAndUpdate(session._id, {
        $set: {
          'dailyTaskSession.currentTaskIndex': nextTaskIndex,
          'dailyTaskSession.totalTasks': dailyTask.tasks.length,
          lastActivityAt: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to move to next task: ${error.message}`);
    }
  }

  /**
   * End daily task session
   */
  private async endDailyTaskSession(
    ctx: BotContext,
    session: TelegramSessionDocument,
    result: { score: number; feedback: string; allCompleted: boolean },
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';

    // Get user streak info
    const user = await this.usersService.findById(session.userId.toString());
    const streak = user?.dailyTasks?.currentStreak || 0;

    const completionText = {
      uz: `🎉 <b>Tabriklaymiz!</b>\n\n✅ Barcha kunlik vazifalar bajarildi!\n\n🔥 Joriy ketma-ketlik: ${streak} kun\n\nErtaga yangi vazifalar bilan ko'rishguncha u yuborish! 👋`,
      ru: `🎉 <b>Поздравляем!</b>\n\n✅ Все ежедневные задания выполнены!\n\n🔥 Текущая серия: ${streak} дней\n\nДо завтра с новыми заданиями! 👋`,
      en: `🎉 <b>Congratulations!</b>\n\n✅ All daily tasks completed!\n\n🔥 Current streak: ${streak} days\n\nSee you tomorrow with new tasks! 👋`,
    };

    await ctx.reply(completionText[lang] || completionText.uz, {
      parse_mode: 'HTML',
    });

    // Clear session
    await this.sessionModel.findByIdAndUpdate(session._id, {
      $set: {
        status: 'idle',
        dailyTaskSession: null,
        lastActivityAt: new Date(),
      },
    });
  }

  /**
   * Check if user is in daily task mode
   */
  async isInDailyTaskMode(ctx: BotContext): Promise<boolean> {
    const chatId = ctx.chat?.id;
    if (!chatId) return false;

    const session = await this.sessionModel.findOne({
      telegramChatId: chatId,
      status: 'daily_task',
    });

    return !!session?.dailyTaskSession;
  }

  /**
   * Helper: Check if plan allows voice answers for daily tasks
   */
  private canUseDailyTaskVoiceAnswer(plan: string): boolean {
    const planLimits = this.getPlanLimits(plan);
    return planLimits.dailyTasks.voiceAnswer;
  }

  /**
   * Helper: Check if plan allows image answers for daily tasks
   */
  private canUseDailyTaskImageAnswer(plan: string): boolean {
    const planLimits = this.getPlanLimits(plan);
    return planLimits.dailyTasks.imageAnswer;
  }

  /**
   * Helper: Get plan limits from COMPLETE_PLAN_LIMITS
   */
  private getPlanLimits(plan: string) {
    const { COMPLETE_PLAN_LIMITS } = require('@common/constants');
    return COMPLETE_PLAN_LIMITS[plan] || COMPLETE_PLAN_LIMITS.free_trial;
  }

  /**
   * Helper: Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
