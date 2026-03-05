import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { DailyTask, DailyTaskDocument } from '../tasks/schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
import { getTashkentMidnight } from '@common/utils/tashkent-time';

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

  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * First reminder: 10:30 Tashkent — 90 minutes after 09:00 task delivery.
   * Fires once daily. Tasks delivered at 09:00 are ~1.5h old at this point.
   */
  @Cron('30 10 * * *', {
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

      // Use today's date to find all pending tasks from today's delivery (09:00)
      const today = this.getTashkentMidnight();
      const totalTasks = await this.dailyTaskModel.countDocuments({
        status: 'pending',
        date: today,
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
          date: today,
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
            const result = await this.sendReminderWithTips(user, task, 'first');

            // Mark as sent when: message delivered OR user blocked the bot.
            // Blocked users must be marked so the cron doesn't retry them on
            // every subsequent run (avoiding a retry storm against 403 errors).
            if (result.sent || result.blocked) {
              await this.dailyTaskModel.findByIdAndUpdate(task._id, {
                $set: { 'reminders.firstReminderSentAt': now },
              });
            }

            if (result.sent) sent++;
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
            const result = await this.sendReminderWithTips(user, task, 'second');

            if (result.sent || result.blocked) {
              await this.dailyTaskModel.findByIdAndUpdate(task._id, {
                $set: { 'reminders.secondReminderSentAt': now },
              });
            }

            if (result.sent) sent++;
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
   * Third reminder: 18:30 (6:30 PM Tashkent time)
   * SCALABILITY FIX: Distributed lock + batch processing
   */
  @Cron('30 18 * * *', {
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
            const result = await this.sendReminderWithTips(user, task, 'third');

            if (result.sent || result.blocked) {
              await this.dailyTaskModel.findByIdAndUpdate(task._id, {
                $set: { 'reminders.thirdReminderSentAt': now },
              });
            }

            if (result.sent) sent++;
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
   *
   * Returns true if message was sent OR user is bot-blocked (so caller
   * can mark the reminder as "done" and avoid a retry storm on blocked users).
   */
  private async sendReminderWithTips(
    user: any,
    task: any,
    reminderType: 'first' | 'second' | 'third',
  ): Promise<{ sent: boolean; blocked: boolean }> {
    try {
      const language = user.language || 'uz';
      const incompleteTasks = task.tasks.filter((t: any) => !t.completed);

      if (incompleteTasks.length === 0) {
        // All tasks completed, don't send reminder
        return { sent: false, blocked: false };
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
          return { sent: true, blocked: false };
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
            // Return blocked=true so caller marks reminder as sent and stops retry storm
            return { sent: false, blocked: true };
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
      return { sent: false, blocked: false };
    } catch (error: any) {
      this.logger.error(`Failed to send reminder to user ${user._id}: ${error.message}`);
      return { sent: false, blocked: false };
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
    // FIX #92: Use task title (shorter, cleaner) instead of full question.
    // HTML-escape to prevent parse_mode: 'HTML' failures with <, >, & chars.
    const taskTitles = tasks.map((t, i) => {
      const raw = t.title || (t.question?.length > 60 ? t.question.substring(0, 60) + '...' : t.question) || 'Task';
      const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `${i + 1}. ${escaped}`;
    }).join('\n');

    // Professional messaging based on reminder type
    // Each reminder has a clear purpose: morning = inform, afternoon = nudge, evening = urgency
    const messages: Record<string, Record<string, string>> = {
      uz: {
        first: `<b>Kunlik topshiriqlar</b>\n\nBugun bajarilishi kerak:\n\n${taskTitles}\n\nJami: ${tasks.length} ta topshiriq\n\nBoshlash: /tasks`,
        second: `<b>Eslatma</b>\n\nHali bajarilmagan topshiriqlar:\n\n${taskTitles}\n\n${tasks.length} ta topshiriq kutmoqda.\n\nDavom etish: /tasks`,
        third: `<b>Kunlik topshiriqlar</b>\n\nBugun yakunlanmagan:\n\n${taskTitles}\n\nStreak saqlab qolish uchun bugun bajaring.\n\nOchish: /tasks`,
      },
      ru: {
        first: `<b>Ежедневные задания</b>\n\nНа сегодня:\n\n${taskTitles}\n\nВсего: ${tasks.length} заданий\n\nНачать: /tasks`,
        second: `<b>Напоминание</b>\n\nЕщё не выполнены:\n\n${taskTitles}\n\n${tasks.length} заданий ожидают.\n\nПродолжить: /tasks`,
        third: `<b>Ежедневные задания</b>\n\nНе завершены сегодня:\n\n${taskTitles}\n\nВыполните сегодня чтобы сохранить streak.\n\nОткрыть: /tasks`,
      },
      en: {
        first: `<b>Daily tasks</b>\n\nFor today:\n\n${taskTitles}\n\nTotal: ${tasks.length} tasks\n\nStart: /tasks`,
        second: `<b>Reminder</b>\n\nStill pending:\n\n${taskTitles}\n\n${tasks.length} tasks waiting.\n\nContinue: /tasks`,
        third: `<b>Daily tasks</b>\n\nNot completed today:\n\n${taskTitles}\n\nComplete today to keep your streak.\n\nOpen: /tasks`,
      },
    };

    const langMessages = messages[language] || messages.uz;
    return langMessages[reminderType] || langMessages.first;
  }

  /**
   * Get midnight in Tashkent timezone as UTC date
   * Tashkent is UTC+5, so today 00:00 Tashkent = yesterday 19:00 UTC
   *
   * CRITICAL: DailyTasksService creates tasks with `date` field set to
   * midnight in Tashkent time, stored as UTC. We need to match that.
   */
  /**
   * Thin wrapper around the shared getTashkentMidnight utility.
   * Guaranteed to produce identical values to DailyTasksService
   * so reminder queries always match stored task documents.
   */
  private getTashkentMidnight(): Date {
    return getTashkentMidnight();
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
