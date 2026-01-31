import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramService, BotContext } from './telegram.service';
import { DailyTasksService } from '../tasks/daily-tasks.service';
import { UsersService } from '../users/users.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { AiSttService } from '../ai/ai-stt.service';
import { ConfigService } from '@nestjs/config';
import {
  canUseDailyTaskVoiceAnswer,
  canUseDailyTaskImageAnswer,
  getPlanLimits,
} from '@common/constants';
import { TelegramSession, TelegramSessionDocument } from './schemas/telegram-session.schema';

/**
 * Telegram Daily Task Handler Service
 * 
 * Handles daily task answer submissions via Telegram
 * Supports: text, voice, image answers
 * Validates plan permissions before processing
 */
@Injectable()
export class TelegramDailyTaskService {
  private readonly logger = new Logger(TelegramDailyTaskService.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly dailyTasksService: DailyTasksService,
    private readonly usersService: UsersService,
    private readonly voiceQuotaService: VoiceQuotaService,
    private readonly sttService: AiSttService,
    private readonly configService: ConfigService,
    @InjectModel(TelegramSession.name)
    private readonly sessionModel: Model<TelegramSessionDocument>,
  ) {}

  /**
   * Start daily task session for user
   * Called when user clicks /tasks or receives daily tasks
   */
  async startDailyTaskSession(ctx: BotContext, userId: string): Promise<void> {
    try {
      // Get today's tasks
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const dailyTask = await this.dailyTasksService.getTodayTasks(userId, today);
      
      if (!dailyTask) {
        const noTasksText = {
          uz: '❌ Bugun uchun vazifalar topilmadi.\n\nErtalab 09:00 da yangi vazifalar yuboriladi.',
          ru: '❌ Задачи на сегодня не найдены.\n\nНовые задачи будут отправлены в 09:00 утра.',
          en: '❌ No tasks found for today.\n\nNew tasks will be sent at 09:00 AM.',
        };
        const lang = ctx.session?.language || 'uz';
        await ctx.reply(noTasksText[lang as keyof typeof noTasksText] || noTasksText.uz);
        return;
      }

      // Find first incomplete task
      const currentTaskIndex = dailyTask.tasks.findIndex(t => !t.completed);
      
      if (currentTaskIndex === -1) {
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
      }

      // Show current task
      await this.showCurrentTask(ctx, dailyTask, currentTaskIndex);
      
    } catch (error: any) {
      this.logger.error(`Failed to start daily task session: ${error.message}`);
      await ctx.reply('❌ Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
    }
  }

  /**
   * Show current task to user
   */
  private async showCurrentTask(ctx: BotContext, dailyTask: any, taskIndex: number): Promise<void> {
    const task = dailyTask.tasks[taskIndex];
    const lang = ctx.session?.language || 'uz';
    
    // Get user plan to show allowed answer types
    const userId = ctx.session?.userId || '';
    if (!userId) return;
    const user = await this.usersService.findById(userId);
    const plan = user?.subscription?.plan || 'free_trial';
    const planLimits = getPlanLimits(plan);
    
    // Build answer type instructions based on plan
    let answerInstructions = '';
    if (planLimits.dailyTasks.textAnswer) {
      answerInstructions += '✍️ Matn yozing';
    }
    if (planLimits.dailyTasks.voiceAnswer) {
      answerInstructions += answerInstructions ? ', 🎙️ ovozli xabar' : '🎙️ Ovozli xabar';
    }
    if (planLimits.dailyTasks.imageAnswer) {
      answerInstructions += answerInstructions ? ', yoki 📸 rasm' : '📸 Rasm';
    }

    const taskText = {
      uz: `📚 <b>Kunlik vazifa ${taskIndex + 1}/${dailyTask.tasks.length}</b>\n\n` +
          `❓ <b>Savol:</b>\n${task.question}\n\n` +
          `✏️ <b>Javob yuboring:</b>\n${answerInstructions}\n\n` +
          `💡 <b>Eslatma:</b> Video javoblar qo'llab-quvvatlanmaydi.`,
      ru: `📚 <b>Ежедневное задание ${taskIndex + 1}/${dailyTask.tasks.length}</b>\n\n` +
          `❓ <b>Вопрос:</b>\n${task.question}\n\n` +
          `✏️ <b>Отправьте ответ:</b>\n${answerInstructions}\n\n` +
          `💡 <b>Примечание:</b> Видео ответы не поддерживаются.`,
      en: `📚 <b>Daily Task ${taskIndex + 1}/${dailyTask.tasks.length}</b>\n\n` +
          `❓ <b>Question:</b>\n${task.question}\n\n` +
          `✏️ <b>Send answer:</b>\n${answerInstructions}\n\n` +
          `💡 <b>Note:</b> Video answers are not supported.`,
    };

    await ctx.reply(taskText[lang as keyof typeof taskText] || taskText.uz, {
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
      await ctx.reply('❌ Javobni qayta ishlashda xatolik. Iltimos, qayta urinib ko\'ring.');
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

      // Check if plan allows voice answers
      if (!canUseDailyTaskVoiceAnswer(plan)) {
        const lang = ctx.session?.language || 'uz';
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
      const hasQuota = await this.voiceQuotaService.hasEnoughQuota(userId, 'mock', estimatedMinutes);
      
      if (!hasQuota) {
        const quota = await this.voiceQuotaService.getQuota(userId);
        const lang = ctx.session?.language || 'uz';
        const noQuotaText = {
          uz: `❌ Ovozli javob uchun yetarli daqiqa yo'q!\n\nMavjud: ${quota.mockVoice.remaining} daqiqa\nMatn shaklida davom eting.`,
          ru: `❌ Недостаточно минут для голосового ответа!\n\nДоступно: ${quota.mockVoice.remaining} мин\nПродолжите текстом.`,
          en: `❌ Not enough voice minutes!\n\nAvailable: ${quota.mockVoice.remaining} min\nContinue with text.`,
        };
        await ctx.reply(noQuotaText[lang as keyof typeof noQuotaText] || noQuotaText.uz);
        return;
      }

      // Show processing message
      const lang = ctx.session?.language || 'uz';
      const processingText = {
        uz: '🎤 Ovozli xabar qayta ishlanmoqda...',
        ru: '🎤 Обрабатывается голосовое сообщение...',
        en: '🎤 Processing voice message...',
      };
      const processingMsg = await ctx.reply(processingText[lang as keyof typeof processingText] || processingText.uz);

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
      } catch {}

      // Submit transcribed answer
      const { dailyTaskId, currentTaskIndex, date } = session.dailyTaskSession;
      
      const result = await this.dailyTasksService.completeTask(
        userId,
        date,
        currentTaskIndex,
        {
          type: 'voice',
          content: transcription.text,
          transcript: transcription.text,
        },
      );

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
      await ctx.reply('❌ Ovozli xabarni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko\'ring.');
    }
  }

  /**
   * Handle image answer for daily task
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

      // Check if plan allows image answers
      if (!canUseDailyTaskImageAnswer(plan)) {
        const lang = ctx.session?.language || 'uz';
        const noImageText = {
          uz: '❌ Rasm javob faqat Starter va yuqori tariflarda!\n\nMatn shaklida javob yuboring.',
          ru: '❌ Ответы изображениями только в Starter и выше!\n\nОтправьте текстовый ответ.',
          en: '❌ Image answers only in Starter and higher plans!\n\nPlease send a text answer.',
        };
        await ctx.reply(noImageText[lang as keyof typeof noImageText] || noImageText.uz);
        return;
      }

      // Show processing message
      const lang = ctx.session?.language || 'uz';
      const processingText = {
        uz: '📸 Rasm qayta ishlanmoqda...',
        ru: '📸 Обрабатывается изображение...',
        en: '📸 Processing image...',
      };
      const processingMsg = await ctx.reply(processingText[lang as keyof typeof processingText] || processingText.uz);

      // Get highest resolution photo
      const largestPhoto = photo[photo.length - 1];
      const file = await ctx.api.getFile(largestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${file.file_path}`;
      
      // Download image
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // TODO: Implement OCR service call
      // For now, ask user to type answer
      const lang2 = ctx.session?.language || 'uz';
      const ocrPendingText = {
        uz: '⚠️ Rasmni matnga o\'girish vaqtinchalik mavjud emas.\n\nIltimos, javobni matn shaklida yuboring.',
        ru: '⚠️ Распознавание текста с изображения временно недоступно.\n\nПожалуйста, отправьте ответ текстом.',
        en: '⚠️ Image OCR is temporarily unavailable.\n\nPlease type your answer.',
      };
      
      // Delete processing message
      try {
        await ctx.api.deleteMessage(chatId, processingMsg.message_id);
      } catch {}
      
      await ctx.reply(ocrPendingText[lang2 as keyof typeof ocrPendingText] || ocrPendingText.uz);
      
    } catch (error: any) {
      this.logger.error(`Failed to handle image answer: ${error.message}`);
      await ctx.reply('❌ Rasmni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko\'ring.');
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
      uz: `${emoji} <b>Vazifa ${taskIndex + 1} bajarildi!</b>\n\n` +
          `📊 <b>Baho:</b> ${result.score}/10\n` +
          `💬 <b>Feedback:</b> ${result.feedback}`,
      ru: `${emoji} <b>Задание ${taskIndex + 1} выполнено!</b>\n\n` +
          `📊 <b>Оценка:</b> ${result.score}/10\n` +
          `💬 <b>Отзыв:</b> ${result.feedback}`,
      en: `${emoji} <b>Task ${taskIndex + 1} completed!</b>\n\n` +
          `📊 <b>Score:</b> ${result.score}/10\n` +
          `💬 <b>Feedback:</b> ${result.feedback}`,
    };

    await ctx.reply(resultText[lang as keyof typeof resultText] || resultText.uz, {
      parse_mode: 'HTML',
    });
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
        // All tasks completed
        return;
      }

      // Update session with next task
      await this.sessionModel.findByIdAndUpdate(session._id, {
        $set: {
          'dailyTaskSession.currentTaskIndex': nextTaskIndex,
          lastActivityAt: new Date(),
        },
      });

      // Show next task
      await this.showCurrentTask(ctx, dailyTask, nextTaskIndex);
      
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
      uz: `🎉 <b>Tabriklaymiz!</b>\n\n` +
          `✅ Barcha kunlik vazifalar bajarildi!\n` +
          `🔥 Joriy ketma-ketlik: ${streak} kun\n\n` +
          `Ertaga yangi vazifalar bilan ko'rishguncha! 👋`,
      ru: `🎉 <b>Поздравляем!</b>\n\n` +
          `✅ Все ежедневные задания выполнены!\n` +
          `🔥 Текущая серия: ${streak} дней\n\n` +
          `До завтра с новыми заданиями! 👋`,
      en: `🎉 <b>Congratulations!</b>\n\n` +
          `✅ All daily tasks completed!\n` +
          `🔥 Current streak: ${streak} days\n\n` +
          `See you tomorrow with new tasks! 👋`,
    };

    await ctx.reply(completionText[lang as keyof typeof completionText] || completionText.uz, {
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
}
