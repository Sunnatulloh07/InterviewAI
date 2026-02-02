import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios, { AxiosError } from 'axios';
import { AiOcrService } from '../ai/ai-ocr.service';
import { AiTtsService } from '../ai/ai-tts.service';
import { TelegramService, BotContext } from './telegram.service';
import { InputFile, InlineKeyboard } from 'grammy';
import { DailyTasksService } from '../tasks/daily-tasks.service';
import { UsersService } from '../users/users.service';
import { VoiceQuotaService } from '../voice/voice-quota.service';
import { VoiceQuotaGuardService } from '../voice/voice-quota-guard.service';
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
    private readonly voiceQuotaGuardService: VoiceQuotaGuardService,
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
   * Show upgrade prompt for free users or expired premium users
   * Marketing message explaining premium daily tasks feature
   * 
   * SENIOR IMPROVEMENTS:
   * - Type-safe user parameter (UserDocument)
   * - Proper null checks and fallbacks
   * - Enhanced logging with user context
   * - Error handling doesn't throw (user experience priority)
   */
  async showUpgradePrompt(ctx: BotContext, user: any): Promise<void> {
    try {
      // SENIOR LOGIC: Null-safe language detection with proper fallback chain
      const lang = 
        ctx.session?.language || 
        user?.preferences?.language || 
        user?.language || 
        'uz';

      // SENIOR LOGGING: Log with full user context for debugging
      const userId = user?._id?.toString() || user?.id?.toString() || 'unknown';
      const userName = user?.firstName || user?.telegramUsername || 'Unknown User';
      const currentPlan = user?.subscription?.plan || 'no_subscription';
      
      this.logger.log(
        `Showing upgrade prompt - userId: ${userId}, name: ${userName}, currentPlan: ${currentPlan}, lang: ${lang}`,
      );

      const upgradeText = {
        uz: `━━━━━━━━━━━━━━━━━━
❌ <b>Kunlik vazifalar premium xususiyat!</b>

🎯 <b>Premium bilan nimalar olasiz:</b>
• Har kuni 3 ta professional savol
• 📊 Progress tracking va oylik statistika
• 🎤 Voice va 🖼 image javoblar
• 💎 AI-powered batafsil feedback
• 🔥 Streak va motivatsiya sistemasi

💰 <b>Faqat $9.99/oy dan boshlab!</b>

Starter plan bilan barcha imkoniyatlardan foydalaning.

━━━━━━━━━━━━━━━━━━`,

        ru: `━━━━━━━━━━━━━━━━━━
❌ <b>Ежедневные задания - премиум функция!</b>

🎯 <b>Что вы получите с Premium:</b>
• Каждый день 3 профессиональных вопроса
• 📊 Отслеживание прогресса и статистика за месяц
• 🎤 Голосовые и 🖼 ответы изображениями
• 💎 Подробный AI-анализ
• 🔥 Система мотивации и серий

💰 <b>Всего от $9.99/мес!</b>

Получите все возможности с тарифом Starter.

━━━━━━━━━━━━━━━━━━`,

        en: `━━━━━━━━━━━━━━━━━━
❌ <b>Daily Tasks is a premium feature!</b>

🎯 <b>What you get with Premium:</b>
• 3 professional questions every day
• 📊 Progress tracking & monthly statistics
• 🎤 Voice & 🖼 image answers
• 💎 AI-powered detailed feedback
• 🔥 Streak & motivation system

💰 <b>Starting from just $9.99/month!</b>

Get full access with the Starter plan.

━━━━━━━━━━━━━━━━━━`,
      };

      // Build inline keyboard with upgrade and info buttons
      const keyboard = new InlineKeyboard()
        .text(
          lang === 'uz' ? '💳 Premium sotib olish' : lang === 'ru' ? '💳 Купить Premium' : '💳 Upgrade to Premium',
          'daily_task_upgrade'
        )
        .row()
        .text(
          lang === 'uz' ? 'ℹ️ Batafsil ma\'lumot' : lang === 'ru' ? 'ℹ️ Подробнее' : 'ℹ️ More Info',
          'menu_upgrade'
        );

      await ctx.reply(upgradeText[lang] || upgradeText.uz, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      this.logger.log(`Upgrade prompt successfully shown to user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to show upgrade prompt: ${error.message}`, error.stack);
      
      // SENIOR PATTERN: Don't throw - gracefully fallback with simple message
      const fallbackText = {
        uz: '❌ Premium xususiyat. Batafsil ma\'lumot uchun /upgrade buyrug\'ini yuboring.',
        ru: '❌ Премиум функция. Используйте /upgrade для подробностей.',
        en: '❌ Premium feature. Use /upgrade for details.',
      };
      
      const lang = ctx.session?.language || 'uz';
      
      try {
        await ctx.reply(fallbackText[lang] || fallbackText.uz);
      } catch (replyError: any) {
        this.logger.error(`Critical: Failed to send fallback message: ${replyError.message}`);
        // No further action - prevent infinite error loop
      }
    }
  }

  /**
   * Show monthly statistics for premium users
   * Displays comprehensive overview with button to view today's tasks
   * 
   * SENIOR IMPROVEMENTS:
   * - Safe division with proper edge case handling (0/0 case)
   * - Better error handling without throwing (user experience priority)
   * - Enhanced logging for debugging
   */
  async showMonthlyStats(ctx: BotContext, userId: string): Promise<void> {
    try {
      const user = await this.usersService.findById(userId);
      if (!user) {
        this.logger.error(`User ${userId} not found in showMonthlyStats`);
        const errorText = {
          uz: '❌ Foydalanuvchi topilmadi.',
          ru: '❌ Пользователь не найден.',
          en: '❌ User not found.',
        };
        const lang = ctx.session?.language || 'uz';
        await ctx.reply(errorText[lang] || errorText.uz);
        return;
      }

      const lang = ctx.session?.language || user?.preferences?.language || user?.language || 'uz';
      const plan = user.subscription?.plan || 'free_trial';

      this.logger.log(`Fetching monthly stats for user ${userId} (plan: ${plan})`);

      // Get monthly stats from DailyTasksService
      const stats = await this.dailyTasksService.getMonthlyStats(userId);

      // Get current month name
      const now = new Date();
      const monthNames = {
        uz: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'],
        ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
        en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      };
      const currentMonthName = monthNames[lang][now.getMonth()];

      // SENIOR FIX: Safe calculation for failed percentage
      const failedPercentage = stats.totalTasks > 0 
        ? Math.round((stats.failed / stats.totalTasks) * 100) 
        : 0; // If no tasks, 0% failed (not "0/1 = 0%")

      const statsText = {
        uz: `━━━━━━━━━━━━━━━━━━
📊 <b>KUNLIK VAZIFALAR STATISTIKA</b>

📅 <b>Shu oy (${currentMonthName} ${now.getFullYear()}):</b>
✅ Bajarilgan: <b>${stats.completed}/${stats.totalTasks}</b> (${stats.completionRate}%)
❌ Bajarilmagan: <b>${stats.failed}/${stats.totalTasks}</b> (${failedPercentage}%)
🤖 AI javoblar: <b>${stats.aiAnswered}</b>
📊 O'rtacha ball: <b>${stats.averageScore}/10</b>

🔥 <b>Streak:</b>
• Joriy: <b>${stats.currentStreak} kun</b>
• Eng uzun: <b>${stats.longestStreak} kun</b>

━━━━━━━━━━━━━━━━━━`,

        ru: `━━━━━━━━━━━━━━━━━━
📊 <b>СТАТИСТИКА ЕЖЕДНЕВНЫХ ЗАДАНИЙ</b>

📅 <b>Этот месяц (${currentMonthName} ${now.getFullYear()}):</b>
✅ Выполнено: <b>${stats.completed}/${stats.totalTasks}</b> (${stats.completionRate}%)
❌ Не выполнено: <b>${stats.failed}/${stats.totalTasks}</b> (${failedPercentage}%)
🤖 AI ответы: <b>${stats.aiAnswered}</b>
📊 Средний балл: <b>${stats.averageScore}/10</b>

🔥 <b>Серия:</b>
• Текущая: <b>${stats.currentStreak} дней</b>
• Максимальная: <b>${stats.longestStreak} дней</b>

━━━━━━━━━━━━━━━━━━`,

        en: `━━━━━━━━━━━━━━━━━━
📊 <b>DAILY TASKS STATISTICS</b>

📅 <b>This Month (${currentMonthName} ${now.getFullYear()}):</b>
✅ Completed: <b>${stats.completed}/${stats.totalTasks}</b> (${stats.completionRate}%)
❌ Failed: <b>${stats.failed}/${stats.totalTasks}</b> (${failedPercentage}%)
🤖 AI Answers: <b>${stats.aiAnswered}</b>
📊 Average Score: <b>${stats.averageScore}/10</b>

🔥 <b>Streak:</b>
• Current: <b>${stats.currentStreak} days</b>
• Longest: <b>${stats.longestStreak} days</b>

━━━━━━━━━━━━━━━━━━`,
      };

      // Build inline keyboard
      const keyboard = new InlineKeyboard().text(
        lang === 'uz' ? '📋 Bugungi vazifalar' : lang === 'ru' ? '📋 Сегодняшние задания' : '📋 Today\'s Tasks',
        'daily_task_today'
      );

      await ctx.reply(statsText[lang] || statsText.uz, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      this.logger.log(`Monthly stats successfully shown to user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to show monthly stats: ${error.message}`, error.stack);
      
      // SENIOR PATTERN: Don't throw - send fallback message
      const fallbackText = {
        uz: '❌ Statistikani yuklashda xatolik. Keyinroq qayta urinib ko\'ring.',
        ru: '❌ Ошибка при загрузке статистики. Попробуйте позже.',
        en: '❌ Failed to load statistics. Please try again later.',
      };
      
      const lang = ctx.session?.language || 'uz';
      
      try {
        await ctx.reply(fallbackText[lang] || fallbackText.uz);
      } catch (replyError: any) {
        this.logger.error(`Critical: Failed to send error message: ${replyError.message}`);
      }
    }
  }

  /**
   * Start daily task session for user
   * Called when user clicks /tasks or receives daily tasks
   * 
   * CRITICAL FIX: Use Tashkent timezone midnight for date consistency
   * SENIOR PATTERN: Centralized timezone handling via DailyTasksService
   */
  async startDailyTaskSession(ctx: BotContext, userId: string): Promise<void> {
    try {
      this.logger.log(`Starting daily task session for userId: ${userId}`);

      // CRITICAL FIX: Use Tashkent midnight from DailyTasksService
      const today = this.dailyTasksService.getTashkentMidnightPublic();
      
      this.logger.debug(
        `Using Tashkent midnight: ${today.toISOString()} (UTC: ${today.toUTCString()})`,
      );

      const dailyTask = await this.dailyTasksService.getTodayTasks(userId, today);

      if (!dailyTask) {
        this.logger.warn(
          `No tasks found for userId: ${userId} on ${today.toISOString()} (Tashkent midnight)`,
        );
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
      this.logger.log(`Showing tasks overview for userId: ${userId}, taskCount: ${dailyTask.tasks.length}`);
      await this.showCurrentTask(ctx, dailyTask, currentTaskIndex);
      this.logger.log(`Successfully started daily task session for userId: ${userId}`);
    } catch (error: any) {
      this.logger.error(
        `CRITICAL: Failed to start daily task session for user ${userId}: ${error.message}`,
        error.stack,
      );
      
      // SENIOR PATTERN: Send user-friendly error with fallback
      const errorText = {
        uz: "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring yoki /help dan yordam oling.",
        ru: '❌ Произошла ошибка. Попробуйте снова или обратитесь за помощью /help.',
        en: '❌ Error occurred. Please try again or get help via /help.',
      };
      
      const lang = ctx.session?.language || 'uz';
      
      try {
        await ctx.reply(errorText[lang] || errorText.uz);
      } catch (replyError: any) {
        this.logger.error(`CRITICAL: Failed to send error message: ${replyError.message}`);
      }
    }
  }

  /**
   * Show TODAY'S TASKS overview with all questions
   * Completed tasks: collapsed (title + checkmark only)
   * Incomplete tasks: full question + individual "Answer" button
   * 
   * NEW UX: Each incomplete task has its own button, user can answer in any order
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
    const position = user?.profile?.position || 'junior';

    // Calculate progress
    const totalTasks = dailyTask.tasks.length;
    const completedCount = dailyTask.tasks.filter((t) => t.completed).length;
    const progressPercent = Math.round((completedCount / totalTasks) * 100);

    // SENIOR FIX: Proper date formatting with correct locale
    const date = new Date(dailyTask.date);
    const day = date.getDate();
    const monthNames = {
      uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
      ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    };
    const month = monthNames[lang][date.getMonth()];
    const dateStr = lang === 'en' ? `${month} ${day}` : `${day}-${month}`;

    // Build header
    const headerText = {
      uz: `━━━━━━━━━━━━━━━━━━
📋 <b>BUGUNGI VAZIFALAR (${dateStr})</b>

`,
      ru: `━━━━━━━━━━━━━━━━━━
📋 <b>СЕГОДНЯШНИЕ ЗАДАНИЯ (${dateStr})</b>

`,
      en: `━━━━━━━━━━━━━━━━━━
📋 <b>TODAY'S TASKS (${dateStr})</b>

`,
    };

    // SENIOR PATTERN: Build tasks list with proper validation and edge case handling
    let tasksText = '';
    let keyboard = new InlineKeyboard();
    let buttonCount = 0;

    // Validate dailyTask.tasks exists and is array
    if (!dailyTask.tasks || !Array.isArray(dailyTask.tasks) || dailyTask.tasks.length === 0) {
      this.logger.warn(`No tasks found in dailyTask for user ${userId}`);
      const noTasksText = {
        uz: '❌ Vazifalar topilmadi.',
        ru: '❌ Задания не найдены.',
        en: '❌ No tasks found.',
      };
      await ctx.reply(noTasksText[lang] || noTasksText.uz);
      return;
    }

    for (let i = 0; i < dailyTask.tasks.length; i++) {
      const task = dailyTask.tasks[i];
      
      // SENIOR VALIDATION: Check task object integrity
      if (!task || !task.question) {
        this.logger.warn(`Invalid task at index ${i} for user ${userId}`);
        continue; // Skip invalid tasks
      }
      
      if (task.completed) {
        // Completed task: show only title with checkmark and score
        const score = task.score || 0;
        const scoreEmoji = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴';
        
        // SENIOR FIX: Safe substring with proper length check
        const questionPreview = task.question.length > 60 
          ? task.question.substring(0, 60) + '...' 
          : task.question;
        
        const scoreLabel = {
          uz: 'ball',
          ru: 'балл',
          en: 'pts',
        };
        
        tasksText += `✅ <b>${i + 1}. ${questionPreview}</b>\n   ${scoreEmoji} ${score}/10 ${scoreLabel[lang]}\n\n`;
      } else {
        // Incomplete task: show full question + button
        tasksText += `🔄 <b>${i + 1}. ${task.question}</b>\n\n`;
        
        // Add answer button for this specific task
        const buttonLabel = {
          uz: `📝 Javob berish (${i + 1})`,
          ru: `📝 Ответить (${i + 1})`,
          en: `📝 Answer (${i + 1})`,
        };
        
        keyboard.text(buttonLabel[lang] || buttonLabel.uz, `daily_task_answer_${i}`);
        buttonCount++;
        
        // Add row break after every 2 buttons for better UX
        if (buttonCount % 2 === 0) {
          keyboard.row();
        }
      }
    }

    // EDGE CASE: If all tasks are completed, no buttons needed
    if (buttonCount === 0) {
      this.logger.log(`All tasks completed for user ${userId} - no answer buttons shown`);
    }

    // Add answer type instructions based on plan
    let answerInstructions = '';
    if (planLimits.dailyTasks.textAnswer) {
      answerInstructions += lang === 'uz' ? '✍️ Matn' : lang === 'ru' ? '✍️ Текст' : '✍️ Text';
    }
    if (planLimits.dailyTasks.voiceAnswer) {
      answerInstructions += answerInstructions ? ' | ' : '';
      answerInstructions += lang === 'uz' ? '🎙️ Ovoz' : lang === 'ru' ? '🎙️ Голос' : '🎙️ Voice';
    }
    if (planLimits.dailyTasks.imageAnswer) {
      answerInstructions += answerInstructions ? ' | ' : '';
      answerInstructions += lang === 'uz' ? '📸 Rasm' : lang === 'ru' ? '📸 Фото' : '📸 Image';
    }

    const footerText = {
      uz: `━━━━━━━━━━━━━━━━━━
Progress: ${completedCount}/${totalTasks} bajarilgan (${progressPercent}%)

📝 <b>Javob turlari:</b> ${answerInstructions}`,
      ru: `━━━━━━━━━━━━━━━━━━
Прогресс: ${completedCount}/${totalTasks} выполнено (${progressPercent}%)

📝 <b>Типы ответов:</b> ${answerInstructions}`,
      en: `━━━━━━━━━━━━━━━━━━
Progress: ${completedCount}/${totalTasks} completed (${progressPercent}%)

📝 <b>Answer types:</b> ${answerInstructions}`,
    };

    // Combine full message
    const fullMessage = headerText[lang] + tasksText + footerText[lang];

    await ctx.reply(fullMessage, {
      parse_mode: 'HTML',
      reply_markup: completedCount < totalTasks ? keyboard : undefined, // Only show buttons if tasks remain
    });

    this.logger.log(`Showed today's tasks to user ${userId}: ${completedCount}/${totalTasks} completed`);
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
   * 
   * ✅ UPDATED: Now uses VoiceQuotaGuard for transaction safety
   * 
   * Flow:
   * 1. Check plan permission
   * 2. PRE-FLIGHT CHECK (before download)
   * 3. RESERVE quota
   * 4. Download + transcribe
   * 5. Complete task
   * 6. COMMIT quota (only if task completion succeeds)
   * 7. ROLLBACK if any step fails
   */
  async handleVoiceAnswer(ctx: BotContext, voice: any): Promise<void> {
    let reservationId: string | null = null;

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

      // ═══════════════════════════════════════════════════════════════════
      // STEP 1: Check plan permission
      // ═══════════════════════════════════════════════════════════════════
      if (!this.canUseDailyTaskVoiceAnswer(plan)) {
        const noVoiceText = {
          uz: '❌ Ovozli javob faqat Starter va yuqori tariflarda!\\n\\nMatn shaklida javob yuboring.',
          ru: '❌ Голосовые ответы только в Starter и выше!\\n\\nОтправьте текстовый ответ.',
          en: '❌ Voice answers only in Starter and higher plans!\\n\\nPlease send a text answer.',
        };
        await ctx.reply(noVoiceText[lang as keyof typeof noVoiceText] || noVoiceText.uz);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP 2: PRE-FLIGHT CHECK (before downloading audio)
      // Saves bandwidth if user has no quota
      // ═══════════════════════════════════════════════════════════════════
      const preflight = await this.voiceQuotaGuardService.preFlightCheck(
        userId,
        'mock', // Daily tasks use mock quota
        voice.duration || 30,
      );

      if (!preflight.allowed) {
        const noQuotaText = {
          uz:
            `❌ Ovozli javob uchun yetarli daqiqa yo'q!\\n\\n` +
            `Kerak: ${preflight.estimatedMinutes} daq\\n` +
            `Mavjud: ${preflight.quotaInfo.remaining} daq\\n\\n` +
            `Matn shaklida javob yuboring yoki /upgrade orqali tarifni yangilang.`,
          ru:
            `❌ Недостаточно минут для голосового ответа!\\n\\n` +
            `Нужно: ${preflight.estimatedMinutes} мин\\n` +
            `Доступно: ${preflight.quotaInfo.remaining} мин\\n\\n` +
            `Продолжите текстом или обновите тариф через /upgrade.`,
          en:
            `❌ Not enough voice minutes!\\n\\n` +
            `Need: ${preflight.estimatedMinutes} min\\n` +
            `Available: ${preflight.quotaInfo.remaining} min\\n\\n` +
            `Continue with text or upgrade via /upgrade.`,
        };
        await ctx.reply(noQuotaText[lang] || noQuotaText.uz);
        return;
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP 3: RESERVE QUOTA
      // Prevents race conditions and ensures we can rollback if needed
      // ═══════════════════════════════════════════════════════════════════
      reservationId = await this.voiceQuotaGuardService.reserveQuota(
        userId,
        'mock',
        preflight.estimatedMinutes,
        {
          flow: 'daily_task',
          sessionId: session.dailyTaskSession.dailyTaskId,
          estimatedDurationSeconds: voice.duration || 30,
        },
      );

      this.logger.log(
        `Voice quota reserved for daily task: user=${userId}, ` +
          `resId=${reservationId}, minutes=${preflight.estimatedMinutes}`,
      );

      // ═══════════════════════════════════════════════════════════════════
      // STEP 4: Download + Transcribe (quota already reserved)
      // ═══════════════════════════════════════════════════════════════════
      const processingText = {
        uz: '🎤 Ovozli xabar qayta ishlanmoqda...',
        ru: '🎤 Обрабатывается голосовое сообщение...',
        en: '🎤 Processing voice message...',
      };
      const processingMsg = await ctx.reply(processingText[lang] || processingText.uz);

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

      // ═══════════════════════════════════════════════════════════════════
      // STEP 5: Complete task (BEFORE committing quota)
      // If this fails, we rollback the reservation
      // ═══════════════════════════════════════════════════════════════════
      const { dailyTaskId, currentTaskIndex, date } = session.dailyTaskSession;

      const result = await this.dailyTasksService.completeTask(userId, date, currentTaskIndex, {
        type: 'voice',
        content: transcription.text,
        transcript: transcription.text,
      });

      // ═══════════════════════════════════════════════════════════════════
      // STEP 6: COMMIT QUOTA (only after task completion succeeds)
      // This is the revenue protection point
      // ═══════════════════════════════════════════════════════════════════
      await this.voiceQuotaGuardService.commitReservation(reservationId);

      this.logger.log(
        `Voice quota committed for daily task: user=${userId}, resId=${reservationId}`,
      );

      // Clear reservation ID (already committed)
      reservationId = null;

      // Show result
      await this.showTaskResult(ctx, result, currentTaskIndex);

      // Move to next task or end session
      if (!result.allCompleted) {
        await this.moveToNextTask(ctx, session, currentTaskIndex + 1);
      } else {
        await this.endDailyTaskSession(ctx, session, result);
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle voice answer: ${error.message}`, error.stack);

      // ═══════════════════════════════════════════════════════════════════
      // CRITICAL: ROLLBACK quota if any error occurred
      // This prevents charging users for failed services
      // ═══════════════════════════════════════════════════════════════════
      if (reservationId) {
        try {
          await this.voiceQuotaGuardService.rollbackReservation(reservationId, 'ai_failed');
          this.logger.log(
            `Voice quota rolled back due to error: resId=${reservationId}, ` +
              `error=${error.message}`,
          );
        } catch (rollbackError: any) {
          this.logger.error(
            `CRITICAL: Failed to rollback reservation ${reservationId}: ${rollbackError.message}`,
            rollbackError.stack,
          );
        }
      }

      const errorText = {
        uz: "❌ Ovozli xabarni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko'ring.",
        ru: '❌ Ошибка обработки голосового сообщения. Попробуйте отправить текст.',
        en: '❌ Error processing voice message. Please try with text.',
      };

      const lang = ctx.session?.language || 'uz';
      await ctx.reply(errorText[lang as keyof typeof errorText] || errorText.uz);
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
   * PUBLIC METHOD: Set daily task session
   * Used by callback handlers to properly set session without breaking encapsulation
   * 
   * SENIOR PATTERN: Expose controlled public method instead of private property access
   */
  async setDailyTaskSession(
    chatId: number,
    userId: string,
    dailyTaskId: string,
    currentTaskIndex: number,
    totalTasks: number,
    date: Date,
  ): Promise<void> {
    try {
      await this.sessionModel.findOneAndUpdate(
        { telegramChatId: chatId },
        {
          $set: {
            status: 'daily_task',
            dailyTaskSession: {
              dailyTaskId,
              currentTaskIndex,
              totalTasks,
              date,
            },
            lastActivityAt: new Date(),
          },
        },
        { upsert: true },
      );
      
      this.logger.debug(`Daily task session set for chat ${chatId}, task ${currentTaskIndex}/${totalTasks}`);
    } catch (error: any) {
      this.logger.error(`Failed to set daily task session: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Helper: Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
