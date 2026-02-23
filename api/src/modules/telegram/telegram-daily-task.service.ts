import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
// FIX #88: Removed unused axios import (was dead code)
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
    @Inject(forwardRef(() => DailyTasksService))
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
      const lang = ctx.session?.language || user?.preferences?.language || user?.language || 'uz';

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

💎 <b>STARTER ($10/oy):</b>
• Har kuni 1 ta professional savol
• 📊 Oylik AI tahlil va feedback
• 🎤 Voice va 🖼 image javoblar

🚀 <b>PRO ($20/oy):</b>
• Har kuni 1 ta savol + kunlik progress
• 📈 Haftalik AI tavsiyalar
• Kengaytirilgan statistika

👑 <b>ELITE ($30/oy):</b>
• Har kuni 2 ta savol (2x ko'proq!)
• 🗺 Haftalik career roadmap
• Karyera o'sish tahlili
• Unlimited mock interview va CV

━━━━━━━━━━━━━━━━━━`,

        ru: `━━━━━━━━━━━━━━━━━━
❌ <b>Ежедневные задания - премиум функция!</b>

🎯 <b>Что вы получите с Premium:</b>

💎 <b>STARTER ($10/мес):</b>
• 1 профессиональный вопрос в день
• 📊 Месячный AI отчет и feedback
• 🎤 Голосовые и 🖼 ответы фото

🚀 <b>PRO ($20/мес):</b>
• 1 вопрос в день + ежедневный прогресс
• 📈 Еженедельные AI рекомендации
• Расширенная статистика

👑 <b>ELITE ($30/мес):</b>
• 2 вопроса в день (в 2 раза больше!)
• 🗺 Еженедельная карьерная roadmap
• Анализ роста карьеры
• Unlimited mock interview и CV

━━━━━━━━━━━━━━━━━━`,

        en: `━━━━━━━━━━━━━━━━━━
❌ <b>Daily Tasks is a premium feature!</b>

🎯 <b>What you get with Premium:</b>

💎 <b>STARTER ($10/month):</b>
• 1 professional question per day
• 📊 Monthly AI report & feedback
• 🎤 Voice & 🖼 image answers

🚀 <b>PRO ($20/month):</b>
• 1 question/day + daily progress
• 📈 Weekly AI recommendations
• Advanced statistics

👑 <b>ELITE ($30/month):</b>
• 2 questions per day (2x more!)
• 🗺 Weekly career roadmap
• Career growth insights
• Unlimited mock interview & CV

━━━━━━━━━━━━━━━━━━`,
      };

      // Build inline keyboard with upgrade and info buttons
      const keyboard = new InlineKeyboard()
        .text(
          lang === 'uz'
            ? '💳 Premium sotib olish'
            : lang === 'ru'
              ? '💳 Купить Premium'
              : '💳 Upgrade to Premium',
          'daily_task_upgrade',
        )
        .row()
        .text(
          lang === 'uz' ? "ℹ️ Batafsil ma'lumot" : lang === 'ru' ? 'ℹ️ Подробнее' : 'ℹ️ More Info',
          'menu_upgrade',
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
        uz: "❌ Premium xususiyat. Batafsil ma'lumot uchun /upgrade buyrug'ini yuboring.",
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
        uz: [
          'Yanvar',
          'Fevral',
          'Mart',
          'Aprel',
          'May',
          'Iyun',
          'Iyul',
          'Avgust',
          'Sentyabr',
          'Oktyabr',
          'Noyabr',
          'Dekabr',
        ],
        ru: [
          'Январь',
          'Февраль',
          'Март',
          'Апрель',
          'Май',
          'Июнь',
          'Июль',
          'Август',
          'Сентябрь',
          'Октябрь',
          'Ноябрь',
          'Декабрь',
        ],
        en: [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ],
      };
      // FIX #116: Safe access — fallback to 'uz' if lang is not a valid key
      const validMonthLang = (lang in monthNames) ? lang as 'uz' | 'ru' | 'en' : 'uz';
      const currentMonthName = monthNames[validMonthLang][now.getMonth()];

      // SENIOR FIX: Safe calculation for failed percentage
      const failedPercentage =
        stats.totalTasks > 0 ? Math.round((stats.failed / stats.totalTasks) * 100) : 0; // If no tasks, 0% failed (not "0/1 = 0%")

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
        lang === 'uz'
          ? '📋 Bugungi vazifalar'
          : lang === 'ru'
            ? '📋 Сегодняшние задания'
            : "📋 Today's Tasks",
        'daily_task_today',
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
        uz: "❌ Statistikani yuklashda xatolik. Keyinroq qayta urinib ko'ring.",
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
        this.logger.error(
          `🔥 CRITICAL: No tasks found for userId: ${userId} on ${today.toISOString()} | ` +
            `UTC: ${today.toUTCString()} | ` +
            `Current UTC: ${new Date().toISOString()} | ` +
            `Tashkent hour: ${new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours()}`,
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
        // All tasks completed — get actual streak from user document
        const user = await this.usersService.findById(userId);
        const currentStreak = user?.dailyTasks?.currentStreak || 0;
        const completedText = {
          uz: `✅ Bugun barcha vazifalar bajarilgan!\n\n🔥 Joriy ketma-ketlik: ${currentStreak} kun`,
          ru: `✅ Все задачи на сегодня выполнены!\n\n🔥 Текущая серия: ${currentStreak} дней`,
          en: `✅ All tasks for today are completed!\n\n🔥 Current streak: ${currentStreak} days`,
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
      this.logger.log(
        `Showing tasks overview for userId: ${userId}, taskCount: ${dailyTask.tasks.length}`,
      );
      // FIX #116: Pass userId explicitly to avoid session.userId being empty in callback context
      await this.showCurrentTask(ctx, dailyTask, currentTaskIndex, userId);
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
   *
   * FIX #116: Accept userId as parameter instead of relying on ctx.session.userId.
   * In callback query context, Grammy session may not have userId loaded, causing
   * this method to silently return without sending any message to the user.
   */
  private async showCurrentTask(
    ctx: BotContext,
    dailyTask: any,
    _currentTaskIndex: number, // Unused: all tasks shown in overview with individual buttons
    explicitUserId?: string, // FIX #116: Pass userId explicitly from caller
  ): Promise<void> {
    // FIX #116: Use explicit userId first, then fallback to session
    const userId = explicitUserId || ctx.session?.userId || '';
    if (!userId) {
      this.logger.error('showCurrentTask: No userId available (neither explicit nor session)');
      return;
    }
    const user = await this.usersService.findById(userId);

    // FIX #116: Get language from session OR user preferences (callback context may lack session)
    const lang = ctx.session?.language || user?.preferences?.language || (user as any)?.language || 'uz';
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
      uz: [
        'yanvar',
        'fevral',
        'mart',
        'aprel',
        'may',
        'iyun',
        'iyul',
        'avgust',
        'sentyabr',
        'oktyabr',
        'noyabr',
        'dekabr',
      ],
      ru: [
        'января',
        'февраля',
        'марта',
        'апреля',
        'мая',
        'июня',
        'июля',
        'августа',
        'сентября',
        'октября',
        'ноября',
        'декабря',
      ],
      en: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
    };
    // FIX #116: Safe access — fallback to 'uz' if lang is not a valid key
    const validLang = (lang in monthNames) ? lang as 'uz' | 'ru' | 'en' : 'uz';
    const month = monthNames[validLang][date.getMonth()];
    const dateStr = validLang === 'en' ? `${month} ${day}` : `${day}-${month}`;

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

      // Get task title — use title field if available, otherwise first 60 chars of question
      const taskTitle = task.title
        ? this.escapeHtml(task.title)
        : this.escapeHtml(
            task.question.length > 60 ? task.question.substring(0, 60) + '...' : task.question,
          );

      if (task.completed) {
        // Completed task: show title with checkmark and score
        const score = task.score || 0;
        const scoreEmoji = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴';

        const scoreLabel = {
          uz: 'ball',
          ru: 'балл',
          en: 'pts',
        };

        tasksText += `✅ <b>${i + 1}. ${taskTitle}</b>\n   ${scoreEmoji} ${score}/10 ${scoreLabel[lang] || scoreLabel.uz}\n\n`;
      } else {
        // Incomplete task: show TITLE ONLY (full question shown on button click)
        tasksText += `🔄 <b>${i + 1}. ${taskTitle}</b>\n\n`;

        // Add answer button for this specific task — opens full task view
        const buttonLabel = {
          uz: `📝 Ko'rish va javob (${i + 1})`,
          ru: `📝 Открыть и ответить (${i + 1})`,
          en: `📝 View & Answer (${i + 1})`,
        };

        keyboard.text(buttonLabel[lang as keyof typeof buttonLabel] || buttonLabel.uz, `daily_task_answer_${i}`);
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

    // Combine full message — FIX #116: Safe fallback to 'uz' for invalid lang keys
    const fullMessage = (headerText[lang] || headerText.uz) + tasksText + (footerText[lang] || footerText.uz);

    try {
      await ctx.reply(fullMessage, {
        parse_mode: 'HTML',
        reply_markup: completedCount < totalTasks ? keyboard : undefined, // Only show buttons if tasks remain
      });

      this.logger.log(
        `Showed today's tasks to user ${userId}: ${completedCount}/${totalTasks} completed`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to send tasks message: ${error.message}`);
      // Fallback: try sending without HTML parsing if it failed
      try {
        await ctx.reply(fullMessage.replace(/<[^>]*>/g, ''), {
          reply_markup: completedCount < totalTasks ? keyboard : undefined,
        });
      } catch (retryError) {
        this.logger.error(`Failed to send tasks fallback message: ${retryError}`);
      }
    }
  }

  /**
   * Helper to escape HTML characters for Telegram
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Handle text answer for daily task
   * 🛡 PHASE 1.1: Updated to handle async scoring
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

      // Submit answer (returns immediately with pending score)
      const result = await this.dailyTasksService.completeTask(
        userId,
        date,
        currentTaskIndex,
        text,
      );

      // Show result (pending state)
      await this.showTaskResult(ctx, result, currentTaskIndex);

      // Move to next task or end session
      if (!result.allCompleted) {
        await this.moveToNextTask(ctx, session, currentTaskIndex + 1);
      } else {
        await this.endDailyTaskSession(ctx, session, result);
      }
    } catch (error: any) {
      const lang = ctx.session?.language || 'uz';

      // FIX #109: Handle subscription expired errors with upgrade prompt
      if (error.status === 403 || error.name === 'ForbiddenException') {
        this.logger.warn(`Task answer blocked: ${error.message}`);
        const expiredText: Record<string, string> = {
          uz: `⏰ <b>Obuna muddatingiz tugagan</b>\n\nVazifa javoblarini yuborish uchun tarifni yangilang.`,
          ru: `⏰ <b>Срок подписки истёк</b>\n\nОбновите тариф для отправки ответов.`,
          en: `⏰ <b>Subscription expired</b>\n\nUpgrade your plan to submit task answers.`,
        };
        const keyboard = new InlineKeyboard().text(
          lang === 'uz' ? "⬆️ Tariflarni ko'rish" : lang === 'ru' ? '⬆️ Тарифы' : '⬆️ View Plans',
          'show_plans',
        );
        await ctx.reply(expiredText[lang] || expiredText.en, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        return;
      }

      this.logger.error(`Failed to handle text answer: ${error.message}`);
      const errorText: Record<string, string> = {
        uz: "❌ Javobni qayta ishlashda xatolik. Iltimos, qayta urinib ko'ring.",
        ru: '❌ Ошибка обработки ответа. Пожалуйста, попробуйте ещё раз.',
        en: '❌ Error processing answer. Please try again.',
      };
      await ctx.reply(errorText[lang] || errorText.uz);
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
          uz: '❌ Ovozli javob faqat Starter va yuqori tariflarda!\n\nMatn shaklida javob yuboring.',
          ru: '❌ Голосовые ответы только в Starter и выше!\n\nОтправьте текстовый ответ.',
          en: '❌ Voice answers only in Starter and higher plans!\n\nPlease send a text answer.',
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
            `❌ Ovozli javob uchun yetarli daqiqa yo'q!\n\n` +
            `Kerak: ${preflight.estimatedMinutes} daq\n` +
            `Mavjud: ${preflight.quotaInfo.remaining} daq\n\n` +
            `Matn shaklida javob yuboring yoki /upgrade orqali tarifni yangilang.`,
          ru:
            `❌ Недостаточно минут для голосового ответа!\n\n` +
            `Нужно: ${preflight.estimatedMinutes} мин\n` +
            `Доступно: ${preflight.quotaInfo.remaining} мин\n\n` +
            `Продолжите текстом или обновите тариф через /upgrade.`,
          en:
            `❌ Not enough voice minutes!\n\n` +
            `Need: ${preflight.estimatedMinutes} min\n` +
            `Available: ${preflight.quotaInfo.remaining} min\n\n` +
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
      // CRITICAL: ROLLBACK quota if any error occurred
      if (reservationId) {
        await this.voiceQuotaGuardService.rollbackReservation(reservationId, 'ai_failed');
        this.logger.log(
          `Voice quota rollback initiated: resId=${reservationId}, ` + `error=${error.message}`,
        );
      }

      const lang = ctx.session?.language || 'uz';

      // FIX #109: Handle subscription expired errors with upgrade prompt
      if (error.status === 403 || error.name === 'ForbiddenException') {
        this.logger.warn(`Voice answer blocked: ${error.message}`);
        const expiredText: Record<string, string> = {
          uz: `⏰ <b>Obuna muddatingiz tugagan</b>\n\nVazifa javoblarini yuborish uchun tarifni yangilang.`,
          ru: `⏰ <b>Срок подписки истёк</b>\n\nОбновите тариф для отправки ответов.`,
          en: `⏰ <b>Subscription expired</b>\n\nUpgrade your plan to submit task answers.`,
        };
        const keyboard = new InlineKeyboard().text(
          lang === 'uz' ? "⬆️ Tariflarni ko'rish" : lang === 'ru' ? '⬆️ Тарифы' : '⬆️ View Plans',
          'show_plans',
        );
        await ctx.reply(expiredText[lang] || expiredText.en, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        return;
      }

      this.logger.error(`Failed to handle voice answer: ${error.message}`, error.stack);

      const errorText = {
        uz: "❌ Ovozli xabarni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko'ring.",
        ru: '❌ Ошибка обработки голосового сообщения. Попробуйте отправить текст.',
        en: '❌ Error processing voice message. Please try with text.',
      };
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
      // FIX #90: Use lang variable instead of hardcoded Uzbek
      const lang = ctx.session?.language || 'uz';

      // FIX #109: Handle subscription expired errors with upgrade prompt
      if (error.status === 403 || error.name === 'ForbiddenException') {
        this.logger.warn(`Image answer blocked: ${error.message}`);
        const expiredText: Record<string, string> = {
          uz: `⏰ <b>Obuna muddatingiz tugagan</b>\n\nVazifa javoblarini yuborish uchun tarifni yangilang.`,
          ru: `⏰ <b>Срок подписки истёк</b>\n\nОбновите тариф для отправки ответов.`,
          en: `⏰ <b>Subscription expired</b>\n\nUpgrade your plan to submit task answers.`,
        };
        const keyboard = new InlineKeyboard().text(
          lang === 'uz' ? "⬆️ Tariflarni ko'rish" : lang === 'ru' ? '⬆️ Тарифы' : '⬆️ View Plans',
          'show_plans',
        );
        await ctx.reply(expiredText[lang] || expiredText.en, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        return;
      }

      const errorText: Record<string, string> = {
        uz: "❌ Rasmni qayta ishlashda xatolik. Iltimos, matn bilan urinib ko'ring.",
        ru: '❌ Ошибка обработки изображения. Попробуйте отправить текст.',
        en: '❌ Error processing image. Please try with text.',
      };
      await ctx.reply(errorText[lang] || errorText.uz);
    }
  }

  /**
   * Show task completion result
   * 🛡 PHASE 1.1: Handle pending scoring state
   */
  private async showTaskResult(
    ctx: BotContext,
    result: {
      score: number;
      feedback: string;
      allCompleted: boolean;
      scoring?: 'pending' | 'completed';
    },
    taskIndex: number,
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';

    // 🛡 PHASE 1.1: Show pending state for async scoring
    if (result.scoring === 'pending') {
      const pendingText = {
        uz: `✅ <b>Vazifa ${taskIndex + 1} qabul qilindi!</b>\n\n⏳ AI baholash jarayonida...\n💡 Natijani bir necha soniyadan keyin /tasks orqali ko'rishingiz mumkin.`,
        ru: `✅ <b>Задание ${taskIndex + 1} принято!</b>\n\n⏳ AI оценка в процессе...\n💡 Результат можно увидеть через несколько секунд через /tasks.`,
        en: `✅ <b>Task ${taskIndex + 1} submitted!</b>\n\n⏳ AI scoring in progress...\n💡 Check results in a few seconds via /tasks.`,
      };

      await ctx.reply(pendingText[lang] || pendingText.uz, {
        parse_mode: 'HTML',
      });

      return; // Don't send voice explanation for pending scores
    }

    // Show completed score
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
   *
   * FIX #69: Voice explanations now deduct from mockVoice quota.
   * TTS audio typically ~15-30 seconds. We estimate 0.5 min per explanation
   * and deduct from mockVoice quota using pre-flight + reserve + commit pattern.
   * If user has no remaining quota, voice explanation is silently skipped.
   */
  private async sendVoiceExplanation(
    ctx: BotContext,
    result: { score: number; feedback: string },
    lang: string,
  ): Promise<void> {
    let reservationId: string | null = null;

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

      // FIX #69: Check voice quota before generating TTS
      // TTS explanations are short (~15-30 sec), estimate 0.5 min
      const estimatedMinutes = 0.5;
      const preflight = await this.voiceQuotaGuardService.preFlightCheck(
        userId,
        'mock', // Voice explanations use mockVoice quota
        30, // ~30 seconds estimated
      );

      if (!preflight.allowed) {
        this.logger.debug(
          `Skipping voice explanation for user ${userId}: insufficient mockVoice quota ` +
            `(remaining: ${preflight.quotaInfo.remaining} min, need: ${estimatedMinutes} min)`,
        );
        return; // Silently skip — user still gets text feedback
      }

      // Reserve quota before TTS generation
      reservationId = await this.voiceQuotaGuardService.reserveQuota(
        userId,
        'mock',
        estimatedMinutes,
        {
          flow: 'daily_task',
          estimatedDurationSeconds: 30,
        },
      );

      const { audioBuffer } = await this.ttsService.synthesize(result.feedback, {
        language: lang,
        voice: 'alloy',
      });

      await ctx.replyWithAudio(new InputFile(audioBuffer), {
        caption: '🔊 Ovozli izoh (Voice explanation)',
      });

      // Commit quota after successful delivery
      await this.voiceQuotaGuardService.commitReservation(reservationId);
      reservationId = null; // Already committed

      this.logger.log(`Voice explanation sent to user ${userId} (${estimatedMinutes} min deducted)`);
    } catch (error: any) {
      this.logger.error(`Failed to send voice explanation: ${error.message}`);

      // Rollback quota if reserved but not committed
      if (reservationId) {
        try {
          await this.voiceQuotaGuardService.rollbackReservation(reservationId, 'ai_failed');
        } catch (rollbackError: any) {
          this.logger.error(`Failed to rollback voice explanation quota: ${rollbackError.message}`);
        }
      }
    }
  }

  /**
   * Move to next task
   *
   * FIX #78: Find next INCOMPLETE task instead of blindly using nextTaskIndex.
   * User may answer tasks out of order (e.g., task 1 first, then task 0).
   * We must show the overview with remaining incomplete tasks.
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

      if (!dailyTask) {
        return;
      }

      // Find the next incomplete task (may not be nextTaskIndex if answered out of order)
      const actualNextIndex = dailyTask.tasks.findIndex((t, i) => i >= nextTaskIndex && !t.completed);
      const fallbackIndex = actualNextIndex === -1
        ? dailyTask.tasks.findIndex((t) => !t.completed) // Check any remaining incomplete
        : actualNextIndex;

      if (fallbackIndex === -1) {
        // All tasks completed — shouldn't reach here (endDailyTaskSession handles this)
        return;
      }

      // Show tasks overview (all tasks with individual buttons for incomplete ones)
      // FIX #116: Pass userId explicitly
      await this.showCurrentTask(ctx, dailyTask, fallbackIndex, session.userId.toString());

      // Update session with next incomplete task index
      await this.sessionModel.findByIdAndUpdate(session._id, {
        $set: {
          'dailyTaskSession.currentTaskIndex': fallbackIndex,
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
   *
   * FIX #73: Now triggers engagement reports:
   * - ELITE: Daily AI engagement report (after all daily tasks completed)
   * - ALL PAID (Starter/Pro/Elite): Monthly AI engagement report on plan's last day
   */
  private async endDailyTaskSession(
    ctx: BotContext,
    session: TelegramSessionDocument,
    result: { score: number; feedback: string; allCompleted: boolean },
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';
    const userId = session.userId.toString();

    // Get user streak info
    const user = await this.usersService.findById(userId);
    const streak = user?.dailyTasks?.currentStreak || 0;
    const plan = user?.subscription?.plan || 'free_trial';

    const completionText = {
      uz: `🎉 <b>Tabriklaymiz!</b>\n\n✅ Barcha kunlik vazifalar bajarildi!\n\n🔥 Joriy ketma-ketlik: ${streak} kun\n\nErtaga yangi vazifalar bilan ko'rishguncha! 👋`,
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

    // ═══════════════════════════════════════════════════════════════════
    // ENGAGEMENT REPORTS (fire-and-forget, don't block user flow)
    // ═══════════════════════════════════════════════════════════════════

    // ELITE ONLY: Daily AI engagement report after all tasks completed
    if (plan === 'elite') {
      this.generateDailyEngagementReport(ctx, userId, lang).catch((err) => {
        this.logger.error(`Failed to generate daily engagement report: ${err.message}`);
      });
    }

    // ALL PAID PLANS: Monthly report on plan's last day
    if (['starter', 'pro', 'elite'].includes(plan)) {
      this.checkAndSendMonthlyReport(ctx, user, userId, lang).catch((err) => {
        this.logger.error(`Failed to check/send monthly engagement report: ${err.message}`);
      });
    }
  }

  /**
   * ELITE ONLY: Generate daily AI engagement report
   *
   * Sent after all daily tasks are completed. Includes:
   * - Today's task scores summary
   * - Short AI feedback with strengths/improvements
   * - Daily roadmap recommendation
   * - Streak and consistency stats
   */
  private async generateDailyEngagementReport(
    ctx: BotContext,
    userId: string,
    lang: string,
  ): Promise<void> {
    try {
      // FIX #89: Poll for scoring completion instead of fixed 3s delay.
      // scoreTaskInBackground runs async after completeTask returns.
      // Polling checks every 1s for up to 10s whether all tasks have been scored.
      // Falls back gracefully if scoring is still pending after timeout.
      const today = this.dailyTasksService.getTashkentMidnightPublic();
      let dailyTask = await this.dailyTasksService.getTodayTasks(userId, today);

      if (!dailyTask) return;

      // Poll until all tasks are scored or timeout (10 seconds max)
      const MAX_POLLS = 10;
      const POLL_INTERVAL_MS = 1000;
      for (let poll = 0; poll < MAX_POLLS; poll++) {
        const allScored = dailyTask.tasks.every(
          (t) => (t as any).scoringStatus === 'completed' || (t as any).scoringStatus === 'failed',
        );
        if (allScored) break;

        await this.delay(POLL_INTERVAL_MS);
        dailyTask = await this.dailyTasksService.getTodayTasks(userId, today);
        if (!dailyTask) return;
      }

      const user = await this.usersService.findById(userId);
      if (!user) return;

      // FIX #86: Build today's scores summary — HTML-escape titles to prevent rendering issues
      const taskSummaries = dailyTask.tasks.map((t, i) => {
        const rawTitle = (t as any).title || t.question.substring(0, 50);
        const title = this.escapeHtml(rawTitle);
        const score = t.score || 0;
        const emoji = score >= 8 ? '🟢' : score >= 5 ? '🟡' : '🔴';
        return `${emoji} ${i + 1}. ${title}: ${score}/10`;
      });

      const avgScore =
        dailyTask.tasks.length > 0
          ? Math.round(
              (dailyTask.tasks.reduce((sum, t) => sum + (t.score || 0), 0) /
                dailyTask.tasks.length) *
                10,
            ) / 10
          : 0;

      const streak = user.dailyTasks?.currentStreak || 0;
      const position = user.profile?.position || 'junior';

      const reportText: Record<string, string> = {
        uz: `━━━━━━━━━━━━━━━━━━
📊 <b>KUNLIK AI HISOBOT (Elite)</b>
━━━━━━━━━━━━━━━━━━

📋 <b>Bugungi natijalar:</b>
${taskSummaries.join('\n')}

📈 <b>O'rtacha ball:</b> ${avgScore}/10
🔥 <b>Streak:</b> ${streak} kun

💡 <b>AI tavsiya:</b>
${avgScore >= 8 ? `Ajoyib natija! ${position} darajangizda siz juda yaxshi natijalarga erishyapsiz. Shu tezlikda davom eting!` : avgScore >= 5 ? `Yaxshi harakat! Javoblaringizni yanada chuqurroq va aniqroq qilishga e'tibor bering. Misollar va metrikalar qo'shing.` : `Mashq qilishda davom eting! Savollarni yaxshilab o'qib, strukturali javob berishga harakat qiling (STAR metodi).`}

━━━━━━━━━━━━━━━━━━`,

        ru: `━━━━━━━━━━━━━━━━━━
📊 <b>ЕЖЕДНЕВНЫЙ AI ОТЧЕТ (Elite)</b>
━━━━━━━━━━━━━━━━━━

📋 <b>Результаты за сегодня:</b>
${taskSummaries.join('\n')}

📈 <b>Средний балл:</b> ${avgScore}/10
🔥 <b>Серия:</b> ${streak} дней

💡 <b>AI рекомендация:</b>
${avgScore >= 8 ? `Отличный результат! На уровне ${position} вы показываете великолепные результаты. Продолжайте в том же духе!` : avgScore >= 5 ? `Хорошая работа! Обратите внимание на глубину и точность ответов. Добавляйте примеры и метрики.` : `Продолжайте практику! Внимательно читайте вопросы и старайтесь отвечать структурированно (метод STAR).`}

━━━━━━━━━━━━━━━━━━`,

        en: `━━━━━━━━━━━━━━━━━━
📊 <b>DAILY AI REPORT (Elite)</b>
━━━━━━━━━━━━━━━━━━

📋 <b>Today's results:</b>
${taskSummaries.join('\n')}

📈 <b>Average score:</b> ${avgScore}/10
🔥 <b>Streak:</b> ${streak} days

💡 <b>AI recommendation:</b>
${avgScore >= 8 ? `Excellent results! At ${position} level, you're performing outstandingly. Keep up the great work!` : avgScore >= 5 ? `Good effort! Focus on depth and specificity in your answers. Add concrete examples and metrics.` : `Keep practicing! Read questions carefully and try to answer in a structured way (STAR method).`}

━━━━━━━━━━━━━━━━━━`,
      };

      await ctx.reply(reportText[lang] || reportText.uz, { parse_mode: 'HTML' });
      this.logger.log(`Daily engagement report sent to Elite user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to generate daily engagement report: ${error.message}`);
    }
  }

  /**
   * ALL PAID PLANS: Check if today is plan's last day and send monthly report
   *
   * Triggers when:
   * - User has endDate set on subscription
   * - endDate is today or tomorrow (within 24 hours)
   * - Report not already sent this period (checked via Redis)
   *
   * Report includes:
   * - 30-day task completion stats
   * - Average scores and trends
   * - AI-generated roadmap with strengths/weaknesses
   * - Growth forecast and recommendations
   */
  private async checkAndSendMonthlyReport(
    ctx: BotContext,
    user: any,
    userId: string,
    lang: string,
  ): Promise<void> {
    try {
      const endDate = user?.subscription?.endDate;
      if (!endDate) return; // No end date set, skip

      const now = new Date();
      const end = new Date(endDate);
      const hoursUntilEnd = (end.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Only trigger if within last 24 hours of plan period
      if (hoursUntilEnd > 24 || hoursUntilEnd < -24) return;

      // FIX #84: Check if monthly report already sent this period (prevent duplicates)
      // Use public API instead of breaking encapsulation with this.dailyTasksService['redis']
      const reportKey = `engagement:monthly-report:${userId}:${end.toISOString().split('T')[0]}`;
      const alreadySent = await this.dailyTasksService.getRedisKey(reportKey);
      if (alreadySent) {
        this.logger.debug(`Monthly report already sent for user ${userId}`);
        return;
      }

      // Get 30-day stats
      const stats = await this.dailyTasksService.getMonthlyStats(userId);
      const plan = user.subscription?.plan || 'free_trial';
      const position = user.profile?.position || 'junior';
      const domain = user.profile?.domain || '';
      const streak = user.dailyTasks?.currentStreak || 0;
      const longestStreak = user.dailyTasks?.longestStreak || 0;

      // Calculate growth indicators
      const consistencyRate = stats.totalTasks > 0
        ? Math.round((stats.completed / stats.totalTasks) * 100)
        : 0;

      const growthEmoji = stats.averageScore >= 7 ? '📈' : stats.averageScore >= 5 ? '➡️' : '📉';

      const reportText: Record<string, string> = {
        uz: `━━━━━━━━━━━━━━━━━━
📊 <b>30 KUNLIK AI ENGAGEMENT HISOBOT</b>
━━━━━━━━━━━━━━━━━━

👤 <b>Profil:</b> ${position}${domain ? ` | ${domain}` : ''}
📋 <b>Plan:</b> ${plan.toUpperCase()}

📈 <b>30 kunlik statistika:</b>
• Jami vazifalar: <b>${stats.totalTasks}</b>
• Bajarilgan: <b>${stats.completed}</b> (${stats.completionRate}%)
• Bajarilmagan: <b>${stats.failed}</b>
• O'rtacha ball: <b>${stats.averageScore}/10</b>
• AI javoblar: <b>${stats.aiAnswered}</b>

🔥 <b>Streak:</b>
• Joriy: <b>${streak} kun</b>
• Eng uzun: <b>${longestStreak} kun</b>

${growthEmoji} <b>O'sish prognozi:</b>
${consistencyRate >= 80 ? `Ajoyib! Siz ${consistencyRate}% izchillik bilan mashq qilyapsiz. Bu tezlikda 2-3 oy ichida ${position === 'junior' ? 'middle' : position === 'middle' ? 'senior' : 'lead'} darajaga yetishingiz mumkin.` : consistencyRate >= 50 ? `Yaxshi boshlangich! ${consistencyRate}% izchillik yetarli, lekin har kuni mashq qilish natijalarni 2x yaxshilaydi. Kunlik streak ni uzmang!` : `Mashq qilishni ko'paytiring! Hozirgi ${consistencyRate}% izchillik past. Kunlik vazifalarni bajarishni odat qiling.`}

💡 <b>AI tavsiyalar:</b>
${stats.averageScore >= 8 ? `1. Yanada murakkab savollarga o'ting\n2. System design va behavioral savollarni ko'proq mashq qiling\n3. Haqiqiy intervyuga tayyorlaning — siz tayyor!` : stats.averageScore >= 5 ? `1. Javoblaringizga aniq misollar qo'shing\n2. STAR metodidan foydalaning\n3. Texnik terminlarni to'g'ri ishlating\n4. Haftalik 2-3 mock intervyu o'tkazing` : `1. Asosiy tushunchalarni qayta o'rganing\n2. Har bir javobni yozib, keyin tahlil qiling\n3. Oddiy savollardan boshlang, murakkablikni oshiring\n4. Kunlik mashqni uzluksiz davom ettiring`}

━━━━━━━━━━━━━━━━━━
<i>Keyingi oy ham muvaffaqiyatli bo'lsin!</i>`,

        ru: `━━━━━━━━━━━━━━━━━━
📊 <b>30-ДНЕВНЫЙ AI ENGAGEMENT ОТЧЕТ</b>
━━━━━━━━━━━━━━━━━━

👤 <b>Профиль:</b> ${position}${domain ? ` | ${domain}` : ''}
📋 <b>План:</b> ${plan.toUpperCase()}

📈 <b>Статистика за 30 дней:</b>
• Всего заданий: <b>${stats.totalTasks}</b>
• Выполнено: <b>${stats.completed}</b> (${stats.completionRate}%)
• Не выполнено: <b>${stats.failed}</b>
• Средний балл: <b>${stats.averageScore}/10</b>
• AI ответы: <b>${stats.aiAnswered}</b>

🔥 <b>Серия:</b>
• Текущая: <b>${streak} дней</b>
• Максимальная: <b>${longestStreak} дней</b>

${growthEmoji} <b>Прогноз роста:</b>
${consistencyRate >= 80 ? `Отлично! ${consistencyRate}% последовательности. При таком темпе через 2-3 месяца вы можете достичь уровня ${position === 'junior' ? 'middle' : position === 'middle' ? 'senior' : 'lead'}.` : consistencyRate >= 50 ? `Хорошее начало! ${consistencyRate}% — неплохо, но ежедневная практика улучшит результаты в 2 раза. Не прерывайте серию!` : `Нужно больше практики! Текущая последовательность ${consistencyRate}% низкая. Сделайте ежедневные задания привычкой.`}

💡 <b>AI рекомендации:</b>
${stats.averageScore >= 8 ? `1. Переходите к более сложным вопросам\n2. Больше практикуйте system design и behavioral\n3. Готовьтесь к реальному интервью — вы готовы!` : stats.averageScore >= 5 ? `1. Добавляйте конкретные примеры в ответы\n2. Используйте метод STAR\n3. Правильно применяйте технические термины\n4. Проводите 2-3 mock-интервью в неделю` : `1. Повторите основные концепции\n2. Записывайте ответы и анализируйте\n3. Начните с простых вопросов\n4. Продолжайте ежедневную практику`}

━━━━━━━━━━━━━━━━━━
<i>Успехов в следующем месяце!</i>`,

        en: `━━━━━━━━━━━━━━━━━━
📊 <b>30-DAY AI ENGAGEMENT REPORT</b>
━━━━━━━━━━━━━━━━━━

👤 <b>Profile:</b> ${position}${domain ? ` | ${domain}` : ''}
📋 <b>Plan:</b> ${plan.toUpperCase()}

📈 <b>30-Day Statistics:</b>
• Total tasks: <b>${stats.totalTasks}</b>
• Completed: <b>${stats.completed}</b> (${stats.completionRate}%)
• Failed: <b>${stats.failed}</b>
• Average score: <b>${stats.averageScore}/10</b>
• AI answers: <b>${stats.aiAnswered}</b>

🔥 <b>Streak:</b>
• Current: <b>${streak} days</b>
• Longest: <b>${longestStreak} days</b>

${growthEmoji} <b>Growth Forecast:</b>
${consistencyRate >= 80 ? `Excellent! ${consistencyRate}% consistency. At this pace, you could reach ${position === 'junior' ? 'middle' : position === 'middle' ? 'senior' : 'lead'} level in 2-3 months.` : consistencyRate >= 50 ? `Good start! ${consistencyRate}% is decent, but daily practice doubles results. Don't break your streak!` : `Need more practice! Current ${consistencyRate}% consistency is low. Make daily tasks a habit.`}

💡 <b>AI Recommendations:</b>
${stats.averageScore >= 8 ? `1. Move to more complex questions\n2. Practice more system design & behavioral\n3. Prepare for real interviews — you're ready!` : stats.averageScore >= 5 ? `1. Add specific examples to your answers\n2. Use the STAR method\n3. Apply technical terms correctly\n4. Do 2-3 mock interviews per week` : `1. Review fundamental concepts\n2. Write down answers and analyze them\n3. Start with simple questions\n4. Keep practicing daily consistently`}

━━━━━━━━━━━━━━━━━━
<i>Good luck next month!</i>`,
      };

      await ctx.reply(reportText[lang] || reportText.uz, { parse_mode: 'HTML' });

      // FIX #84: Mark report as sent (prevent duplicates for 48 hours)
      // Use public API instead of breaking encapsulation
      try {
        await this.dailyTasksService.setRedisKey(reportKey, '1', 172800);
      } catch {
        // Redis failure is non-critical
      }

      this.logger.log(`Monthly engagement report sent to user ${userId} (plan: ${plan})`);
    } catch (error: any) {
      this.logger.error(`Failed to send monthly engagement report: ${error.message}`);
    }
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

      this.logger.debug(
        `Daily task session set for chat ${chatId}, task ${currentTaskIndex}/${totalTasks}`,
      );
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
