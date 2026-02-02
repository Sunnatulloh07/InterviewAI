import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { OpenAI } from 'openai';
import { DailyTask, DailyTaskDocument } from '../tasks/schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
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
    @Inject(() => TelegramService) // ✅ FIXED: Remove forwardRef
    private readonly telegramService: TelegramService,
    @Inject(() => FailedNotificationRetryService) // ✅ FIXED: Remove forwardRef
    private readonly retryService: FailedNotificationRetryService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * First reminder: 30 minutes after task delivery
   * Runs every 30 minutes from 09:30 to 21:30 (Tashkent time)
   * SCALABILITY FIX: Distributed lock + batch processing
   */
  @Cron('30 9-21 * * *', {
    name: 'first-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendFirstReminder() {
    const lockKey = 'cron:task-reminder:first';
    const lockTTL = 1800; // 30 minutes

    try {
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('First reminder cron already running, skipping');
        return;
      }

      const now = new Date();
      // CRITICAL FIX: Correct time window calculation
      // We want tasks created 30-60 minutes ago
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // SCALABILITY FIX: Use aggregation to get task count
      const totalTasks = await this.dailyTaskModel.countDocuments({
        status: 'pending',
        createdAt: {
          $gte: oneHourAgo,
          $lte: thirtyMinutesAgo,
        },
        'reminders.firstReminderSentAt': null,
      });

      this.logger.log(`Found ${totalTasks} tasks for first reminder`);

      let sent = 0;
      let skipped = 0;
      let failed = 0;
      const BATCH_SIZE = 100;
      let lastId: any = null;

      while (true) {
        const query: any = {
          status: 'pending',
          createdAt: {
            $gte: oneHourAgo,
            $lte: thirtyMinutesAgo,
          },
          'reminders.firstReminderSentAt': null,
        };

        if (lastId) {
          query._id = { $gt: lastId };
        }

        const taskBatch = await this.dailyTaskModel
          .find(query)
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .select('_id userId tasks reminders')
          .lean();

        if (taskBatch.length === 0) {
          break;
        }

        this.logger.log(
          `Processing reminder batch: ${taskBatch.length} tasks (${sent + skipped + failed}/${totalTasks})`,
        );

        // Get unique user IDs and filter paid users
        const userIds = [...new Set(taskBatch.map((t) => t.userId.toString()))];

        const paidUsers = await this.userModel
          .find({
            _id: { $in: userIds },
            'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
            'subscription.status': 'active',
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

        const paidUserIdsSet = new Set(paidUsers.map((u) => u._id.toString()));
        const userMap = new Map(paidUsers.map((u) => [u._id.toString(), u]));

        for (const task of taskBatch) {
          const userId = task.userId.toString();

          if (!paidUserIdsSet.has(userId)) {
            skipped++;
            continue;
          }

          const user = userMap.get(userId);
          if (!user) {
            skipped++;
            continue;
          }

          try {
            await this.sendReminderWithTips(user, task, 'first');

            await this.dailyTaskModel.findByIdAndUpdate(task._id, {
              $set: { 'reminders.firstReminderSentAt': now },
            });

            sent++;
            await this.delay(200);
          } catch (error: any) {
            this.logger.error(
              `Failed to send first reminder for task ${task._id}: ${error.message}`,
            );
            failed++;
          }
        }

        lastId = taskBatch[taskBatch.length - 1]._id;
      }

      this.logger.log(
        `First reminder completed: sent=${sent}, skipped=${skipped}, failed=${failed}`,
      );
    } catch (error: any) {
      this.logger.error(`First reminder job failed: ${error.message}`);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release first reminder lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Second reminder: 13:30 (1:30 PM Tashkent time)
   * SCALABILITY FIX: Distributed lock + batch processing
   */
  @Cron('30 13 * * *', {
    name: 'second-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendSecondReminder() {
    const lockKey = 'cron:task-reminder:second';
    const lockTTL = 1800;

    try {
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('Second reminder cron already running, skipping');
        return;
      }

      const today = this.getTashkentMidnight();
      const now = new Date();

      const totalTasks = await this.dailyTaskModel.countDocuments({
        status: 'pending',
        date: today,
        'reminders.secondReminderSentAt': null,
      });

      this.logger.log(`Found ${totalTasks} tasks for second reminder`);

      let sent = 0;
      let skipped = 0;
      let failed = 0;
      const BATCH_SIZE = 100;
      let lastId: any = null;

      while (true) {
        const query: any = {
          status: 'pending',
          date: today,
          'reminders.secondReminderSentAt': null,
        };

        if (lastId) {
          query._id = { $gt: lastId };
        }

        const taskBatch = await this.dailyTaskModel
          .find(query)
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .select('_id userId tasks reminders')
          .lean();

        if (taskBatch.length === 0) break;

        const userIds = [...new Set(taskBatch.map((t) => t.userId.toString()))];

        const paidUsers = await this.userModel
          .find({
            _id: { $in: userIds },
            'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
            'subscription.status': 'active',
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

        const paidUserIdsSet = new Set(paidUsers.map((u) => u._id.toString()));
        const userMap = new Map(paidUsers.map((u) => [u._id.toString(), u]));

        for (const task of taskBatch) {
          const userId = task.userId.toString();

          if (!paidUserIdsSet.has(userId)) {
            skipped++;
            continue;
          }

          const user = userMap.get(userId);
          if (!user) {
            skipped++;
            continue;
          }

          try {
            await this.sendReminderWithTips(user, task, 'second');

            await this.dailyTaskModel.findByIdAndUpdate(task._id, {
              $set: { 'reminders.secondReminderSentAt': now },
            });

            sent++;
            await this.delay(200);
          } catch (error: any) {
            this.logger.error(
              `Failed to send second reminder for task ${task._id}: ${error.message}`,
            );
            failed++;
          }
        }

        lastId = taskBatch[taskBatch.length - 1]._id;
      }

      this.logger.log(
        `Second reminder completed: sent=${sent}, skipped=${skipped}, failed=${failed}`,
      );
    } catch (error: any) {
      this.logger.error(`Second reminder job failed: ${error.message}`);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release second reminder lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Third reminder: 18:00 (6:00 PM Tashkent time)
   * SCALABILITY FIX: Distributed lock + batch processing
   */
  @Cron('0 18 * * *', {
    name: 'third-task-reminder',
    timeZone: 'Asia/Tashkent',
  })
  async sendThirdReminder() {
    const lockKey = 'cron:task-reminder:third';
    const lockTTL = 1800;

    try {
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('Third reminder cron already running, skipping');
        return;
      }

      const today = this.getTashkentMidnight();
      const now = new Date();

      const totalTasks = await this.dailyTaskModel.countDocuments({
        status: 'pending',
        date: today,
        'reminders.thirdReminderSentAt': null,
      });

      this.logger.log(`Found ${totalTasks} tasks for third reminder`);

      let sent = 0;
      let skipped = 0;
      let failed = 0;
      const BATCH_SIZE = 100;
      let lastId: any = null;

      while (true) {
        const query: any = {
          status: 'pending',
          date: today,
          'reminders.thirdReminderSentAt': null,
        };

        if (lastId) {
          query._id = { $gt: lastId };
        }

        const taskBatch = await this.dailyTaskModel
          .find(query)
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .select('_id userId tasks reminders')
          .lean();

        if (taskBatch.length === 0) break;

        const userIds = [...new Set(taskBatch.map((t) => t.userId.toString()))];

        const paidUsers = await this.userModel
          .find({
            _id: { $in: userIds },
            'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
            'subscription.status': 'active',
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

        const paidUserIdsSet = new Set(paidUsers.map((u) => u._id.toString()));
        const userMap = new Map(paidUsers.map((u) => [u._id.toString(), u]));

        for (const task of taskBatch) {
          const userId = task.userId.toString();

          if (!paidUserIdsSet.has(userId)) {
            skipped++;
            continue;
          }

          const user = userMap.get(userId);
          if (!user) {
            skipped++;
            continue;
          }

          try {
            await this.sendReminderWithTips(user, task, 'third');

            await this.dailyTaskModel.findByIdAndUpdate(task._id, {
              $set: { 'reminders.thirdReminderSentAt': now },
            });

            sent++;
            await this.delay(200);
          } catch (error: any) {
            this.logger.error(
              `Failed to send third reminder for task ${task._id}: ${error.message}`,
            );
            failed++;
          }
        }

        lastId = taskBatch[taskBatch.length - 1]._id;
      }

      this.logger.log(
        `Third reminder completed: sent=${sent}, skipped=${skipped}, failed=${failed}`,
      );
    } catch (error: any) {
      this.logger.error(`Third reminder job failed: ${error.message}`);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release third reminder lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Send SIMPLE task reminder (NO AI, clean format)
   * Shows only task titles with professional messaging
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

      // Generate SIMPLE reminder (no AI, no full descriptions)
      const reminderMessage = this.generateTaskReminder(
        incompleteTasks,
        user.profile?.position || 'junior',
        language,
        reminderType,
      );

      const bot = this.telegramService.getBot();
      if (bot && user.telegramId) {
        try {
          await bot.api.sendMessage(user.telegramId, reminderMessage, {
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
            this.logger.warn(`User ${user._id} blocked bot or chat not found. Marking as blocked.`);

            // Mark user as bot blocked (prevent future notifications)
            await this.userModel.findByIdAndUpdate(user._id, {
              $set: {
                'engagement.isBotBlocked': true,
                'engagement.botBlockedAt': new Date(),
              },
            });
          } else {
            // Other Telegram errors (rate limit, network, etc.) - track for retry
            await this.retryService.trackFailedNotification(
              user._id.toString(),
              user.telegramId,
              reminderType === 'first'
                ? 'first_reminder'
                : reminderType === 'second'
                  ? 'second_reminder'
                  : 'third_reminder',
              errorDescription,
              errorCode,
              {
                taskId: task._id.toString(),
                messageContent: reminderMessage,
                incompleteTasks: incompleteTasks.length,
              },
            );
            throw sendError;
          }
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to send reminder to user ${user._id}: ${error.message}`);
    }
  }

  /**
   * Generate SIMPLE task reminder (NO AI, NO full descriptions)
   * Only shows task titles with professional PM/TechLead messaging
   */
  private generateTaskReminder(
    tasks: any[],
    position: string,
    language: string,
    reminderType: 'first' | 'second' | 'third',
  ): string {
    // Extract only task titles (questions)
    const taskTitles = tasks.map((t, i) => `${i + 1}. ${t.question}`).join('\n');

    // Professional PM/TechLead messaging based on reminder type
    const messages: Record<string, Record<string, string>> = {
      uz: {
        first: `👋 <b>Eslatma</b>

Sizda tugallanmagan topshiriqlar mavjud:

${taskTitles}

⏰ ${tasks.length} ta topshiriq kutilmoqda

💡 Vaqtingizni samarali o'tkazing!`,
        second: `⏰ <b>Kunning o'rtasi</b>

Hali topshirilmagan vazifalar:

${taskTitles}

📊 ${tasks.length} ta topshiriq qoldi

⚡ Tezroq bajaring va kunning qolgan qismini rejalashtiring!`,
        third: `🌆 <b>Kun yakunlanmoqda</b>

Oxirgi eslatma - topshirilmagan vazifalar:

${taskTitles}

🚨 ${tasks.length} ta topshiriq - kechga qoldirmang!

🎯 Bugun oxirgi imkoniyat!`,
      },
      ru: {
        first: `👋 <b>Напоминание</b>

У вас есть невыполненные задания:

${taskTitles}

⏰ ${tasks.length} заданий ожидает

💡 Используйте время эффективно!`,
        second: `⏰ <b>Середина дня</b>

Еще не выполненные задачи:

${taskTitles}

📊 ${tasks.length} заданий осталось

⚡ Выполните быстрее и спланируйте оставшуюся часть дня!`,
        third: `🌆 <b>День подходит к концу</b>

Последнее напоминание - невыполненные задачи:

${taskTitles}

🚨 ${tasks.length} заданий - не откладывайте на вечер!

🎯 Последний шанс сегодня!`,
      },
      en: {
        first: `👋 <b>Reminder</b>

You have pending tasks:

${taskTitles}

⏰ ${tasks.length} tasks waiting

💡 Use your time effectively!`,
        second: `⏰ <b>Mid-day check</b>

Tasks still pending:

${taskTitles}

📊 ${tasks.length} tasks remaining

⚡ Complete them quickly and plan the rest of your day!`,
        third: `🌆 <b>Day is ending</b>

Final reminder - pending tasks:

${taskTitles}

🚨 ${tasks.length} tasks - don't leave them for tonight!

🎯 Last chance today!`,
      },
    };

    const langMessages = messages[language] || messages.uz;
    return langMessages[reminderType] || langMessages.first;
  }

  /**
   * Fallback message if AI generation fails
   */
  private getFallbackMessage(taskCount: number, language: string, reminderType: string): string {
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
    return paidPlans.includes(user.subscription?.plan) && user.subscription?.status === 'active';
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
