import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DailyTask, DailyTaskDocument } from './schemas/daily-task.schema';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { DailyTasksService } from './daily-tasks.service';

/**
 * 🔍 DEBUG CONTROLLER FOR DAILY TASKS
 * 
 * Endpoints to help diagnose issues with daily task delivery
 * IMPORTANT: Should be protected in production!
 */
@Controller('api/v1/debug/tasks')
export class TasksDebugController {
  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(GeneratedQuestion.name)
    private readonly questionModel: Model<GeneratedQuestionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly dailyTasksService: DailyTasksService,
  ) {}

  /**
   * Health check for daily tasks system
   */
  @Get('health')
  async getHealth() {
    const now = new Date();
    const today = this.getTashkentMidnight();

    // Count paid users
    const paidUsersCount = await this.userModel.countDocuments({
      'subscription.status': 'active',
      'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
      $or: [
        { 'subscription.endDate': { $exists: false } },
        { 'subscription.endDate': null },
        { 'subscription.endDate': { $gt: now } },
      ],
      isBlocked: false,
      'engagement.isBotBlocked': { $ne: true },
    });

    // Count daily tasks created today
    const tasksToday = await this.dailyTaskModel.countDocuments({
      date: today,
    });

    // Count questions in pool by language
    const poolByLanguage = await this.questionModel.aggregate([
      { $group: { _id: '$language', count: { $sum: 1 } } },
    ]);

    // Count questions by type
    const poolByType = await this.questionModel.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      tashkentTime: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }),
      nextCronRun: '09:00 Asia/Tashkent',
      stats: {
        paidUsers: paidUsersCount,
        dailyTasksToday: tasksToday,
        questionPool: {
          total: await this.questionModel.countDocuments({}),
          byLanguage: poolByLanguage.reduce((acc, item) => {
            acc[item._id || 'null'] = item.count;
            return acc;
          }, {}),
          byType: poolByType.reduce((acc, item) => {
            acc[item._id || 'null'] = item.count;
            return acc;
          }, {}),
        },
      },
      warnings: [
        paidUsersCount === 0 ? 'No paid users found - daily tasks will not be created' : null,
        tasksToday === 0 ? 'No tasks created today - check cron logs or wait for 09:00' : null,
      ].filter(Boolean),
    };
  }

  /**
   * Manually trigger daily tasks delivery (for testing)
   * IMPORTANT: Should be protected in production!
   */
  @Post('trigger-delivery')
  async triggerDelivery() {
    try {
      await this.dailyTasksService.deliverDailyTasks();
      return {
        status: 'triggered',
        message: 'Daily tasks delivery started. Check logs for progress.',
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Get sample paid users (for debugging)
   */
  @Get('paid-users')
  async getPaidUsers() {
    const now = new Date();
    
    const users = await this.userModel
      .find({
        'subscription.status': 'active',
        'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
        $or: [
          { 'subscription.endDate': { $exists: false } },
          { 'subscription.endDate': null },
          { 'subscription.endDate': { $gt: now } },
        ],
        isBlocked: false,
      })
      .limit(10)
      .select('_id telegramId subscription profile.position language preferences.language seenQuestionIds')
      .lean();

    return {
      total: users.length,
      users: users.map(u => ({
        userId: u._id,
        telegramId: u.telegramId,
        plan: u.subscription?.plan,
        status: u.subscription?.status,
        position: u.profile?.position,
        language: (u as any).preferences?.language || (u as any).language || 'en',
        seenQuestions: ((u as any).seenQuestionIds || []).length,
      })),
    };
  }

  /**
   * Get Tashkent midnight helper
   */
  private getTashkentMidnight(): Date {
    const tashkentOffset = 5 * 60; // UTC+5 in minutes
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const tashkentTime = new Date(utcTime + tashkentOffset * 60000);
    
    tashkentTime.setHours(0, 0, 0, 0);
    
    return tashkentTime;
  }
}
