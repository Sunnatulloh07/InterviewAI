import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/analytics-event.schema';

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
}
