import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/analytics-event.schema';
import { COMPLETE_PLAN_LIMITS } from '../../common/constants/plan-limits.constant';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(AnalyticsEvent.name)
    private readonly eventModel: Model<AnalyticsEventDocument>,
  ) {}

  async trackEvent(data: Partial<AnalyticsEvent>): Promise<void> {
    try {
      await this.eventModel.create(data);
    } catch (error) {
      this.logger.error(`Failed to track event: ${error.message}`);
    }
  }

  async getPlanDistribution(): Promise<any> {
    const distribution = await this.eventModel
      .aggregate([
        {
          $group: {
            _id: '$properties.plan',
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 as any },
        },
      ])
      .exec();

    const result: any = {};
    for (const item of distribution) {
      const plan = item._id || 'unknown';
      result[plan] = item.count;
    }

    return {
      total: distribution.reduce((sum: number, item: any) => sum + item.count, 0),
      distribution: result,
      percentage: this.calculatePercentages(result),
    };
  }

  async getFeatureUsage(days = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const featureUsage = await this.eventModel
      .aggregate([
        {
          $match: {
            timestamp: { $gte: since },
            eventType: {
              $in: [
                'daily_task_completed',
                'ocr_used',
                'tts_used',
                'mock_interview_started',
                'mock_interview_completed',
              ],
            },
          },
        },
        {
          $group: {
            _id: '$eventType',
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 as any },
        },
      ])
      .exec();

    const result: any = {};
    for (const item of featureUsage) {
      result[item._id] = item.count;
    }

    return {
      period: `${days} days`,
      features: result,
      total: featureUsage.reduce((sum: number, item: any) => sum + item.count, 0),
    };
  }

  async getVoiceQuotaUsage(days = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const usage = await this.eventModel
      .aggregate([
        {
          $match: {
            timestamp: { $gte: since },
            eventType: { $in: ['voice_quota_used'] },
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              plan: '$properties.plan',
            },
            minutesUsed: { $sum: '$properties.minutes' },
            users: { $addToSet: '$userId' },
          },
        },
        {
          $sort: { '_id.date': -1 as any },
        },
      ])
      .exec();

    const result: any = {};
    for (const item of usage) {
      const date = item._id.date;
      const plan = item._id.plan || 'unknown';
      if (!result[date]) {
        result[date] = {};
      }
      result[date][plan] = {
        minutesUsed: item.minutesUsed,
        uniqueUsers: item.users.length,
      };
    }

    return {
      period: `${days} days`,
      dailyUsage: result,
      summary: this.summarizeVoiceUsage(usage),
    };
  }

  async getDailyTaskCompletion(days = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const completion = await this.eventModel
      .aggregate([
        {
          $match: {
            timestamp: { $gte: since },
            eventType: 'daily_task_completed',
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              plan: '$properties.plan',
            },
            tasksCompleted: { $sum: { $ifNull: ['$properties.tasksCompleted', 1] } },
            users: { $addToSet: '$userId' },
            averageScore: { $avg: '$properties.averageScore' },
          },
        },
        {
          $sort: { '_id.date': -1 as any },
        },
      ])
      .exec();

    const result: any = {};
    for (const item of completion) {
      const date = item._id.date;
      const plan = item._id.plan || 'unknown';
      if (!result[date]) {
        result[date] = {};
      }
      result[date][plan] = {
        tasksCompleted: item.tasksCompleted,
        uniqueUsers: item.users.length,
        averageScore: Math.round((item.averageScore || 0) * 10) / 10,
      };
    }

    return {
      period: `${days} days`,
      dailyCompletion: result,
      summary: this.summarizeTaskCompletion(completion),
    };
  }

  async getRevenueMetrics(days = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const revenue = await this.eventModel
      .aggregate([
        {
          $match: {
            timestamp: { $gte: since },
            eventType: 'subscription_created',
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              plan: '$properties.plan',
            },
            revenue: { $sum: '$properties.amount' },
            subscriptions: { $sum: 1 },
          },
        },
        {
          $sort: { '_id.date': -1 as any },
        },
      ])
      .exec();

    const result: any = {};
    for (const item of revenue) {
      const date = item._id.date;
      const plan = item._id.plan || 'unknown';
      if (!result[date]) {
        result[date] = {};
      }
      result[date][plan] = {
        revenue: item.revenue || 0,
        subscriptions: item.subscriptions || 0,
      };
    }

    return {
      period: `${days} days`,
      dailyRevenue: result,
      summary: this.summarizeRevenue(revenue),
    };
  }

  async getAnalyticsOverview(): Promise<any> {
    const [planDistribution, featureUsage, voiceQuota, dailyTasks, revenue] = await Promise.all([
      this.getPlanDistribution(),
      this.getFeatureUsage(7),
      this.getVoiceQuotaUsage(7),
      this.getDailyTaskCompletion(7),
      this.getRevenueMetrics(30),
    ]);

    return {
      planDistribution,
      featureUsage,
      voiceQuota,
      dailyTasks,
      revenue,
      generatedAt: new Date(),
    };
  }

  async getDashboard(userId: string): Promise<any> {
    const [cvEvents, interviewEvents, chromeEvents] = await Promise.all([
      this.eventModel.countDocuments({
        userId,
        eventType: { $in: ['cv_uploaded', 'cv_analyzed'] },
      }),
      this.eventModel.countDocuments({
        userId,
        eventType: { $in: ['mock_interview_started', 'mock_interview_completed'] },
      }),
      this.eventModel.countDocuments({
        userId,
        eventType: 'answer_generated',
      }),
    ]);

    return {
      totalCvEvents: cvEvents,
      totalInterviews: interviewEvents,
      totalChromeQuestions: chromeEvents,
      recentEvents: await this.getRecentEvents(userId, 10),
    };
  }

  async getUsageStats(userId: string, days = 30): Promise<any> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const events = await this.eventModel
      .find({ userId, timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .exec();

    return {
      totalEvents: events.length,
      eventsByType: this.groupByType(events),
      dailyActivity: this.groupByDay(events),
    };
  }

  private async getRecentEvents(userId: string, limit: number) {
    return await this.eventModel
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('eventType timestamp properties')
      .exec();
  }

  private groupByType(events: any[]) {
    return events.reduce((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {});
  }

  private groupByDay(events: any[]) {
    return events.reduce((acc, event) => {
      const day = event.timestamp.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + 1;
      return acc;
    }, {});
  }

  private calculatePercentages(distribution: any): any {
    const total = Object.values(distribution).reduce(
      (sum: number, val: any) => sum + (val as number),
      0,
    ) as number;
    const result: any = {};
    for (const [plan, count] of Object.entries(distribution)) {
      result[plan] = total > 0 ? Math.round(((count as number) / total) * 100) : 0;
    }
    return result;
  }

  private summarizeVoiceUsage(usage: any[]): any {
    let totalMinutes = 0;
    const planMinutes: any = {};

    for (const item of usage) {
      const plan = item._id.plan || 'unknown';
      totalMinutes += item.minutesUsed;
      if (!planMinutes[plan]) {
        planMinutes[plan] = 0;
      }
      planMinutes[plan] += item.minutesUsed;
    }

    return {
      totalMinutes,
      planMinutes,
    };
  }

  private summarizeTaskCompletion(completion: any[]): any {
    let totalTasks = 0;
    const planTasks: any = {};
    let totalScore = 0;
    let scoreCount = 0;

    for (const item of completion) {
      const plan = item._id.plan || 'unknown';
      totalTasks += item.tasksCompleted;
      if (!planTasks[plan]) {
        planTasks[plan] = 0;
      }
      planTasks[plan] += item.tasksCompleted;

      if (item.averageScore) {
        totalScore += item.averageScore;
        scoreCount++;
      }
    }

    return {
      totalTasks,
      planTasks,
      averageScore: scoreCount > 0 ? Math.round((totalScore / scoreCount) * 10) / 10 : 0,
    };
  }

  private summarizeRevenue(revenue: any[]): any {
    let totalRevenue = 0;
    let totalSubscriptions = 0;
    const planRevenue: any = {};
    const planSubscriptions: any = {};

    for (const item of revenue) {
      const plan = item._id.plan || 'unknown';
      totalRevenue += item.revenue || 0;
      totalSubscriptions += item.subscriptions || 0;

      if (!planRevenue[plan]) {
        planRevenue[plan] = 0;
        planSubscriptions[plan] = 0;
      }
      planRevenue[plan] += item.revenue || 0;
      planSubscriptions[plan] += item.subscriptions || 0;
    }

    return {
      totalRevenue,
      totalSubscriptions,
      planRevenue,
      planSubscriptions,
      averageRevenue:
        totalSubscriptions > 0 ? Math.round((totalRevenue / totalSubscriptions) * 100) / 100 : 0,
    };
  }
}
