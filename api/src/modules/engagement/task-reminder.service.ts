import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { DailyTask, DailyTaskDocument } from '../tasks/schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { createOpenAIClient } from '@common/utils/openai-client.factory';

/**
 * Task Reminder Service
 * 
 * Sends 3 daily reminders to PAID users who haven't completed their daily tasks:
 * 1. First reminder: 30 minutes after task delivery (09:30 if tasks delivered at 09:00)
 * 2. Second reminder: 13:30 (1:30 PM)
 * 3. Third reminder: 18:00 (6:00 PM)
 * 
 * Features:
 * - AI-generated learning tips and recommendations (not answers!)
 * - Stops sending after user completes all tasks
 * - Only for paid users (starter, pro, elite plans)
 * - Tracks which reminders have been sent to avoid duplicates
 */
@Injectable()
export class TaskReminderService {
  private readonly logger = new Logger(TaskReminderService.name);
  private readonly openai: OpenAI | null;

  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * First reminder: 30 minutes after task delivery
   * Runs every 30 minutes from 09:30 to 21:30 (Tashkent time)
   */
  @Cron('30 9-21 * * *', {
    name: 'first-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendFirstReminder() {
    try {
      const now = new Date();
      // CRITICAL FIX: Correct time window calculation
      // We want tasks created 30-60 minutes ago
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // CRITICAL FIX: Correct query logic - tasks created BETWEEN 30-60 min ago
      // oneHourAgo < createdAt < thirtyMinutesAgo
      const tasksNeedingReminder = await this.dailyTaskModel
        .find({
          status: 'pending', // Not completed
          createdAt: { 
            $gte: oneHourAgo,      // Greater than or equal to 60 min ago
            $lte: thirtyMinutesAgo  // Less than or equal to 30 min ago
          },
          'reminders.firstReminderSentAt': null, // First reminder not sent yet
        })
        .select('_id userId tasks reminders')
        .lean();

      this.logger.log(`Found ${tasksNeedingReminder.length} tasks for first reminder`);

      // PERFORMANCE FIX: Get unique user IDs and filter paid users BEFORE processing
      const userIds = [...new Set(tasksNeedingReminder.map(t => t.userId.toString()))];
      
      // CRITICAL FIX: Fetch only paid users with ACTIVE and NON-EXPIRED subscription
      const paidUsers = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          // CRITICAL: Check subscription not expired
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': null },
            { 'subscription.endDate': { $gt: now } },
          ],
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language profile subscription')
        .lean();

      const paidUserIdsSet = new Set(paidUsers.map(u => u._id.toString()));
      const userMap = new Map(paidUsers.map(u => [u._id.toString(), u]));

      // Process only tasks belonging to paid users
      for (const task of tasksNeedingReminder) {
        const userId = task.userId.toString();
        
        if (!paidUserIdsSet.has(userId)) {
          continue; // Skip non-paid users
        }

        const user = userMap.get(userId);
        if (!user) continue;

        await this.sendReminderWithTips(user, task, 'first');
        
        // Mark as sent
        await this.dailyTaskModel.findByIdAndUpdate(task._id, {
          $set: { 'reminders.firstReminderSentAt': now },
        });

        // Rate limiting
        await this.delay(200);
      }
    } catch (error: any) {
      this.logger.error(`First reminder job failed: ${error.message}`);
    }
  }

  /**
   * Second reminder: 13:30 (1:30 PM Tashkent time)
   */
  @Cron('30 13 * * *', {
    name: 'second-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendSecondReminder() {
    try {
      // CRITICAL FIX: Use UTC midnight for Tashkent timezone
      // Tashkent is UTC+5, so today at 00:00 Tashkent = yesterday 19:00 UTC
      const today = this.getTashkentMidnight();

      // Find today's pending tasks that haven't received second reminder
      const tasksNeedingReminder = await this.dailyTaskModel
        .find({
          status: 'pending',
          date: today,
          'reminders.secondReminderSentAt': null,
        })
        .select('_id userId tasks reminders')
        .lean();

      this.logger.log(`Found ${tasksNeedingReminder.length} tasks for second reminder`);

      // PERFORMANCE FIX: Filter paid users first
      const userIds = [...new Set(tasksNeedingReminder.map(t => t.userId.toString()))];
      
      const now2 = new Date();
      const paidUsers = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          // CRITICAL: Check subscription not expired
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': null },
            { 'subscription.endDate': { $gt: now2 } },
          ],
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language profile subscription')
        .lean();

      const paidUserIdsSet = new Set(paidUsers.map(u => u._id.toString()));
      const userMap = new Map(paidUsers.map(u => [u._id.toString(), u]));

      for (const task of tasksNeedingReminder) {
        const userId = task.userId.toString();
        
        if (!paidUserIdsSet.has(userId)) {
          continue;
        }

        const user = userMap.get(userId);
        if (!user) continue;

        await this.sendReminderWithTips(user, task, 'second');
        
        await this.dailyTaskModel.findByIdAndUpdate(task._id, {
          $set: { 'reminders.secondReminderSentAt': new Date() },
        });

        await this.delay(200);
      }
    } catch (error: any) {
      this.logger.error(`Second reminder job failed: ${error.message}`);
    }
  }

  /**
   * Third reminder: 18:00 (6:00 PM Tashkent time)
   */
  @Cron('0 18 * * *', {
    name: 'third-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendThirdReminder() {
    try {
      // CRITICAL FIX: Use UTC midnight for Tashkent timezone
      const today = this.getTashkentMidnight();

      // Find today's pending tasks that haven't received third reminder
      const tasksNeedingReminder = await this.dailyTaskModel
        .find({
          status: 'pending',
          date: today,
          'reminders.thirdReminderSentAt': null,
        })
        .select('_id userId tasks reminders')
        .lean();

      this.logger.log(`Found ${tasksNeedingReminder.length} tasks for third reminder`);

      // PERFORMANCE FIX: Filter paid users first
      const userIds = [...new Set(tasksNeedingReminder.map(t => t.userId.toString()))];
      
      const now3 = new Date();
      const paidUsers = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          // CRITICAL: Check subscription not expired
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': null },
            { 'subscription.endDate': { $gt: now3 } },
          ],
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language profile subscription')
        .lean();

      const paidUserIdsSet = new Set(paidUsers.map(u => u._id.toString()));
      const userMap = new Map(paidUsers.map(u => [u._id.toString(), u]));

      for (const task of tasksNeedingReminder) {
        const userId = task.userId.toString();
        
        if (!paidUserIdsSet.has(userId)) {
          continue;
        }

        const user = userMap.get(userId);
        if (!user) continue;

        await this.sendReminderWithTips(user, task, 'third');
        
        await this.dailyTaskModel.findByIdAndUpdate(task._id, {
          $set: { 'reminders.thirdReminderSentAt': new Date() },
        });

        await this.delay(200);
      }
    } catch (error: any) {
      this.logger.error(`Third reminder job failed: ${error.message}`);
    }
  }

  /**
   * Send reminder with AI-generated learning tips
   */
  private async sendReminderWithTips(
    user: any,
    task: any,
    reminderType: 'first' | 'second' | 'third',
  ): Promise<void> {
    try {
      const language = user.language || 'uz';
      const incompleteTasks = task.tasks.filter((t: any) => !t.completed);
      
      if (incompleteTasks.length === 0) {
        // All tasks completed, don't send reminder
        return;
      }

      // Generate AI learning tips for the incomplete tasks
      const learningTips = await this.generateLearningTips(
        incompleteTasks,
        user.profile?.position || 'junior',
        language,
        reminderType,
      );

      const bot = this.telegramService.getBot();
      if (bot && user.telegramId) {
        try {
          await bot.api.sendMessage(user.telegramId, learningTips, {
            parse_mode: 'HTML',
          });

          this.logger.debug(
            `Sent ${reminderType} reminder to user ${user._id} (${incompleteTasks.length} tasks remaining)`,
          );
        } catch (sendError: any) {
          // CRITICAL: Handle Telegram bot block errors
          const errorCode = sendError.error_code;
          const errorDescription = sendError.description || '';

          // User blocked bot or chat not found
          if (
            errorCode === 403 ||
            errorDescription.includes('bot was blocked') ||
            errorDescription.includes('user is deactivated') ||
            errorDescription.includes('chat not found')
          ) {
            this.logger.warn(
              `User ${user._id} blocked bot or chat not found. Marking as blocked.`,
            );

            // Mark user as bot blocked (prevent future notifications)
            await this.userModel.findByIdAndUpdate(user._id, {
              $set: {
                'engagement.isBotBlocked': true,
                'engagement.botBlockedAt': new Date(),
              },
            });
          } else {
            // Other Telegram errors (rate limit, network, etc.)
            throw sendError;
          }
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to send reminder to user ${user._id}: ${error.message}`,
      );
    }
  }

  /**
   * Generate AI-powered learning tips
   * IMPORTANT: This should NOT give answers, but rather:
   * - Where to learn about the topic
   * - How to approach learning it
   * - What resources to use
   * - Best practices for gaining experience
   */
  private async generateLearningTips(
    tasks: any[],
    position: string,
    language: string,
    reminderType: 'first' | 'second' | 'third',
  ): Promise<string> {
    if (!this.openai) {
      return this.getFallbackMessage(tasks.length, language, reminderType);
    }

    try {
      const taskQuestions = tasks.map((t, i) => `${i + 1}. ${t.question}`).join('\n');

      const prompts = {
        uz: `Siz professional IT mentor va career coachsiz. Foydalanuvchi quyidagi ${tasks.length} ta kunlik topshiriqni hali yopmagan:

${taskQuestions}

MUHIM: Javoblarni BERMANG! Faqat o'rganish bo'yicha maslahatlar bering:
- Qayerdan o'rganishi mumkin (manbalar, veb-saytlar, kurslar)
- Qanday yondashuv qo'llash kerak
- Qanday amaliy tajriba to'plash kerak
- Eng yaxshi practice'lar

Foydalanuvchi darajasi: ${position}
Bu ${reminderType === 'first' ? '1-chi' : reminderType === 'second' ? '2-chi' : '3-chi'} eslatma.

3-4 ta konkret, amaliy maslahat bering. Qisqa va motivatsion yozing (max 500 belgi).`,

        ru: `Вы профессиональный IT ментор и карьерный коуч. Пользователь еще не завершил ${tasks.length} ежедневных заданий:

${taskQuestions}

ВАЖНО: НЕ давайте ответы! Только советы по обучению:
- Где можно изучить (ресурсы, сайты, курсы)
- Какой подход использовать
- Как получить практический опыт
- Лучшие практики

Уровень пользователя: ${position}
Это ${reminderType === 'first' ? '1-е' : reminderType === 'second' ? '2-е' : '3-е'} напоминание.

Дайте 3-4 конкретных практических совета. Пишите коротко и мотивационно (макс 500 символов).`,

        en: `You are a professional IT mentor and career coach. The user hasn't completed ${tasks.length} daily tasks yet:

${taskQuestions}

IMPORTANT: Do NOT give answers! Only provide learning advice:
- Where to learn (resources, websites, courses)
- What approach to take
- How to gain practical experience
- Best practices

User level: ${position}
This is the ${reminderType === 'first' ? '1st' : reminderType === 'second' ? '2nd' : '3rd'} reminder.

Give 3-4 specific practical tips. Keep it short and motivational (max 500 chars).`,
      };

      const prompt = prompts[language as keyof typeof prompts] || prompts.uz;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a supportive IT mentor who provides learning guidance, not answers. Be encouraging and practical.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 500,
      });

      const aiTips = completion.choices[0]?.message?.content || '';

      // Add header and footer
      const headers = {
        uz: `📚 <b>Kunlik topshiriqlar eslatmasi</b>\n\n⏰ Tugallanmagan: ${tasks.length} ta topshiriq\n\n${aiTips}\n\n💡 Topshiriqlarni ko'rish: /tasks`,
        ru: `📚 <b>Напоминание о ежедневных заданиях</b>\n\n⏰ Не завершено: ${tasks.length} заданий\n\n${aiTips}\n\n💡 Посмотреть задания: /tasks`,
        en: `📚 <b>Daily Tasks Reminder</b>\n\n⏰ Incomplete: ${tasks.length} tasks\n\n${aiTips}\n\n💡 View tasks: /tasks`,
      };

      return headers[language as keyof typeof headers] || headers.uz;
    } catch (error: any) {
      this.logger.error(`Failed to generate AI tips: ${error.message}`);
      return this.getFallbackMessage(tasks.length, language, reminderType);
    }
  }

  /**
   * Fallback message if AI generation fails
   */
  private getFallbackMessage(
    taskCount: number,
    language: string,
    reminderType: string,
  ): string {
    const messages = {
      uz: `📚 <b>Kunlik topshiriqlar eslatmasi</b>\n\n⏰ Sizda ${taskCount} ta tugallanmagan topshiriq bor!\n\n💡 Har kuni 30 daqiqa mashq qilish sizni mutaxassis darajasiga olib chiqadi.\n\n🎯 Bugungi topshiriqlarni yakunlang!\n\nTopshiriqlar: /tasks`,
      ru: `📚 <b>Напоминание о ежедневных заданиях</b>\n\n⏰ У вас ${taskCount} незавершенных заданий!\n\n💡 Ежедневная практика 30 минут приведет вас к уровню эксперта.\n\n🎯 Завершите сегодняшние задания!\n\nЗадания: /tasks`,
      en: `📚 <b>Daily Tasks Reminder</b>\n\n⏰ You have ${taskCount} incomplete tasks!\n\n💡 Daily 30-minute practice will lead you to expert level.\n\n🎯 Complete today's tasks!\n\nTasks: /tasks`,
    };

    return messages[language as keyof typeof messages] || messages.uz;
  }

  /**
   * Check if user is on paid plan
   */
  private isPaidUser(user: any): boolean {
    const paidPlans = ['starter', 'pro', 'elite'];
    return (
      paidPlans.includes(user.subscription?.plan) &&
      user.subscription?.status === 'active'
    );
  }

  /**
   * Get midnight in Tashkent timezone as UTC date
   * Tashkent is UTC+5, so today 00:00 Tashkent = yesterday 19:00 UTC
   * 
   * CRITICAL: DailyTasksService creates tasks with `date` field set to
   * midnight in Tashkent time, stored as UTC. We need to match that.
   */
  private getTashkentMidnight(): Date {
    const now = new Date();
    
    // Get current time in Tashkent (UTC+5)
    // Method: Convert to UTC, then add 5 hours to get Tashkent time
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    
    // Tashkent hours = UTC hours + 5
    const tashkentHours = utcHours + 5;
    
    // Create date for today at midnight Tashkent
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);
    
    // Subtract 5 hours to convert Tashkent midnight to UTC
    // Example: Tashkent 00:00 Jan 15 = UTC 19:00 Jan 14
    midnight.setUTCHours(midnight.getUTCHours() - 5);
    
    return midnight;
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
