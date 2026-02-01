import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { DailyTask, DailyTaskDocument } from '../tasks/schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';

@Injectable()
export class NotificationConsistencyChecker {
  private readonly logger = new Logger(NotificationConsistencyChecker.name);

  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
  ) {}

  @Cron('30 23 * * *', {
    name: 'daily-notification-consistency-check',
    timeZone: 'Asia/Tashkent',
  })
  async runDailyConsistencyCheck(): Promise<void> {
    try {
      this.logger.log('Starting daily notification consistency check...');

      const results = await Promise.all([
        this.checkDailyTaskDelivery(),
        this.checkFirstReminders(),
        this.checkSecondReminders(),
        this.checkThirdReminders(),
        this.checkEngagementNotifications(),
      ]);

      const totalIssues = results.reduce((sum, r) => sum + r.missed, 0);
      const totalFixed = results.reduce((sum, r) => sum + r.fixed, 0);
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

      this.logger.log(
        `Consistency check complete: issues=${totalIssues}, fixed=${totalFixed}, failed=${totalFailed}`,
      );
    } catch (error: any) {
      this.logger.error(`Consistency check failed: ${error.message}`);
    }
  }

  private async checkDailyTaskDelivery(): Promise<{ missed: number; fixed: number; failed: number }> {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCHours(today.getUTCHours() - 5);

    try {
      const paidUsersWithTasks = await this.userModel
        .find({
          'subscription.status': 'active',
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': null },
            { 'subscription.endDate': { $gt: now } },
          ],
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
          createdAt: { $lt: new Date(now.getTime() - 60 * 60 * 1000) },
        })
        .select('_id telegramId language')
        .lean();

      const userIds = paidUsersWithTasks.map((u) => u._id.toString());

      const usersWithTasks = await this.dailyTaskModel
        .find({
          date: today,
          userId: { $in: userIds },
        })
        .select('userId')
        .lean();

      const usersWithTasksSet = new Set(usersWithTasks.map((t) => t.userId.toString()));

      const missedUsers = paidUsersWithTasks.filter((u) => !usersWithTasksSet.has(u._id.toString()));

      if (missedUsers.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      this.logger.warn(`Found ${missedUsers.length} users without daily tasks for today`);

      let fixed = 0;
      let failed = 0;

      for (const user of missedUsers) {
        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'daily_task_delivery',
            'Daily task not delivered',
            undefined,
            { userLanguage: user.language, checkDate: today },
          );
          fixed++;
        } catch (error: any) {
          this.logger.error(`Failed to track missing task for user ${user._id}: ${error.message}`);
          failed++;
        }
      }

      return { missed: missedUsers.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Daily task delivery check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  private async checkFirstReminders(): Promise<{ missed: number; fixed: number; failed: number }> {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCHours(today.getUTCHours() - 5);

    try {
      const pendingTasksWithoutReminder = await this.dailyTaskModel
        .find({
          date: today,
          status: 'pending',
          'reminders.firstReminderSentAt': null,
          createdAt: { $lt: new Date(now.getTime() - 30 * 60 * 1000) },
        })
        .select('userId tasks')
        .lean();

      if (pendingTasksWithoutReminder.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      const userIds = pendingTasksWithoutReminder.map((t) => t.userId.toString());

      const users = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language')
        .lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      let fixed = 0;
      let failed = 0;

      for (const task of pendingTasksWithoutReminder) {
        const user = userMap.get(task.userId.toString());
        if (!user) continue;

        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'first_reminder',
            'First reminder not sent',
            undefined,
            {
              taskId: task._id.toString(),
              messageContent: `You have ${task.tasks.filter((t) => !t.completed).length} incomplete tasks!`,
            },
          );
          fixed++;
        } catch (error: any) {
          failed++;
        }
      }

      return { missed: pendingTasksWithoutReminder.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`First reminder check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  private async checkSecondReminders(): Promise<{ missed: number; fixed: number; failed: number }> {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCHours(today.getUTCHours() - 5);

    if (now.getUTCHours() + 5 < 13) {
      return { missed: 0, fixed: 0, failed: 0 };
    }

    try {
      const pendingTasksWithoutReminder = await this.dailyTaskModel
        .find({
          date: today,
          status: 'pending',
          'reminders.secondReminderSentAt': null,
        })
        .select('userId tasks')
        .lean();

      if (pendingTasksWithoutReminder.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      const userIds = pendingTasksWithoutReminder.map((t) => t.userId.toString());

      const users = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language')
        .lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      let fixed = 0;
      let failed = 0;

      for (const task of pendingTasksWithoutReminder) {
        const user = userMap.get(task.userId.toString());
        if (!user) continue;

        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'second_reminder',
            'Second reminder not sent',
            undefined,
            {
              taskId: task._id.toString(),
              messageContent: `Reminder: You still have ${task.tasks.filter((t) => !t.completed).length} incomplete tasks!`,
            },
          );
          fixed++;
        } catch (error: any) {
          failed++;
        }
      }

      return { missed: pendingTasksWithoutReminder.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Second reminder check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  private async checkThirdReminders(): Promise<{ missed: number; fixed: number; failed: number }> {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    today.setUTCHours(today.getUTCHours() - 5);

    if (now.getUTCHours() + 5 < 18) {
      return { missed: 0, fixed: 0, failed: 0 };
    }

    try {
      const pendingTasksWithoutReminder = await this.dailyTaskModel
        .find({
          date: today,
          status: 'pending',
          'reminders.thirdReminderSentAt': null,
        })
        .select('userId tasks')
        .lean();

      if (pendingTasksWithoutReminder.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      const userIds = pendingTasksWithoutReminder.map((t) => t.userId.toString());

      const users = await this.userModel
        .find({
          _id: { $in: userIds },
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          'subscription.status': 'active',
          'engagement.isBotBlocked': { $ne: true },
        })
        .select('_id telegramId language')
        .lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));

      let fixed = 0;
      let failed = 0;

      for (const task of pendingTasksWithoutReminder) {
        const user = userMap.get(task.userId.toString());
        if (!user) continue;

        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'third_reminder',
            'Third reminder not sent',
            undefined,
            {
              taskId: task._id.toString(),
              messageContent: `Final reminder: Complete your ${task.tasks.filter((t) => !t.completed).length} tasks today!`,
            },
          );
          fixed++;
        } catch (error: any) {
          failed++;
        }
      }

      return { missed: pendingTasksWithoutReminder.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Third reminder check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  private async checkEngagementNotifications(): Promise<{ missed: number; fixed: number; failed: number }> {
    try {
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const eligibleUsers = await this.userModel
        .find({
          'engagement.isBotBlocked': { $ne: true },
          'engagement.notificationsPaused': { $ne: true },
          'engagement.consecutiveIgnores': { $lt: 5 },
          $or: [
            { 'engagement.nextNotificationAt': { $exists: false } },
            { 'engagement.nextNotificationAt': null },
            { 'engagement.nextNotificationAt': { $lte: now } },
          ],
        })
        .select('_id telegramId language engagement')
        .lean();

      const missedUsers = eligibleUsers.filter((u) => {
        const lastSent = u.engagement?.lastNotificationSentAt;
        return lastSent && new Date(lastSent) >= startOfToday;
      });

      if (missedUsers.length === 0) {
        return { missed: 0, fixed: 0, failed: 0 };
      }

      let fixed = 0;
      let failed = 0;

      for (const user of missedUsers) {
        try {
          await this.retryService.trackFailedNotification(
            user._id.toString(),
            user.telegramId,
            'engagement',
            'Engagement notification missed',
            undefined,
            { userLanguage: user.language },
          );
          fixed++;
        } catch (error: any) {
          failed++;
        }
      }

      return { missed: missedUsers.length, fixed, failed };
    } catch (error: any) {
      this.logger.error(`Engagement check failed: ${error.message}`);
      return { missed: 0, fixed: 0, failed: 0 };
    }
  }

  async getConsistencyStats(): Promise<{
    lastCheckAt: Date | null;
    issuesFound: number;
    issuesFixed: number;
    issuesFailed: number;
  }> {
    return {
      lastCheckAt: new Date(),
      issuesFound: 0,
      issuesFixed: 0,
      issuesFailed: 0,
    };
  }
}
