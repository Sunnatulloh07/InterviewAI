import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NotificationLog,
  NotificationLogDocument,
  NotificationTrigger,
  NotificationDeliveryStatus,
} from './schemas/notification-log.schema';
import { CreateNotificationLogDto } from './dto/engagement.dto';

/**
 * Repository for NotificationLog CRUD operations
 * Follows Repository Pattern for clean separation of concerns
 */
@Injectable()
export class NotificationLogRepository {
  private readonly logger = new Logger(NotificationLogRepository.name);

  constructor(
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
  ) {}

  /**
   * Create a new notification log entry
   */
  async create(dto: CreateNotificationLogDto): Promise<NotificationLogDocument> {
    const now = new Date();
    const responseWindowEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 hours

    const log = new this.notificationLogModel({
      userId: new Types.ObjectId(dto.userId),
      telegramId: dto.telegramId,
      trigger: dto.trigger,
      content: dto.content,
      sentAt: now,
      responseWindowEndsAt,
      deliveryStatus: NotificationDeliveryStatus.SENT,
      responseReceived: false,
      metadata: dto.metadata,
    });

    const saved = await log.save();
    this.logger.debug(`Created notification log: ${saved.id} for user ${dto.telegramId}`);
    return saved;
  }

  /**
   * Mark a notification as failed with error details
   */
  async markFailed(
    logId: string,
    status:
      | NotificationDeliveryStatus.FAILED
      | NotificationDeliveryStatus.BLOCKED
      | NotificationDeliveryStatus.DEACTIVATED,
    error: string,
  ): Promise<void> {
    await this.notificationLogModel.updateOne(
      { _id: new Types.ObjectId(logId) },
      { $set: { deliveryStatus: status, deliveryError: error } },
    );
    this.logger.debug(`Marked notification ${logId} as ${status}: ${error}`);
  }

  /**
  /**
   * Mark notification as responded within 24h window
   */
  async markResponded(logId: string): Promise<void> {
    await this.notificationLogModel.updateOne(
      { _id: new Types.ObjectId(logId) },
      { $set: { responseReceived: true, responseReceivedAt: new Date(), processed: true } },
    );
    this.logger.debug(`Marked notification ${logId} as responded`);
  }

  /**
   * Mark notification as processed (expired) without marking as responded
   */
  async markProcessed(logId: string): Promise<void> {
    await this.notificationLogModel.updateOne(
      { _id: new Types.ObjectId(logId) },
      { $set: { processed: true } },
    );
    this.logger.debug(`Marked notification ${logId} as processed (expired)`);
  }

  /**
   * Find the most recent unresponded notification for a user
   * Used to check if user responded within 24h window
   */
  async findLastUnrespondedForUser(userId: string): Promise<any | null> {
    return this.notificationLogModel
      .findOne({
        userId: new Types.ObjectId(userId),
        responseReceived: false,
        deliveryStatus: NotificationDeliveryStatus.SENT,
        responseWindowEndsAt: { $gte: new Date() }, // Window still open
      })
      .sort({ sentAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Find last notification sent to user (regardless of response)
   */
  async findLastForUser(userId: string): Promise<any | null> {
    return this.notificationLogModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ sentAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Get notification history for a user
   */
  async findUserHistory(userId: string, limit = 20): Promise<any[]> {
    return this.notificationLogModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ sentAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Count notifications sent to user in the last N days
   */
  async countRecentForUser(userId: string, days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.notificationLogModel.countDocuments({
      userId: new Types.ObjectId(userId),
      sentAt: { $gte: since },
      deliveryStatus: NotificationDeliveryStatus.SENT,
    });
  }

  /**
   * Get all expired unresponded notifications (for backoff processing)
   */
  async findExpiredUnresponded(): Promise<any[]> {
    return this.notificationLogModel
      .find({
        responseReceived: false,
        processed: false, // Only unprocessed logs
        deliveryStatus: NotificationDeliveryStatus.SENT,
        responseWindowEndsAt: { $lt: new Date() }, // Window expired
      })
      .lean()
      .exec();
  }

  /**
   * Get analytics: notification counts by trigger type
   */
  async getAnalyticsByTrigger(days = 30): Promise<Record<NotificationTrigger, number>> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const result = await this.notificationLogModel.aggregate([
      { $match: { sentAt: { $gte: since } } },
      { $group: { _id: '$trigger', count: { $sum: 1 } } },
    ]);

    const analytics: Record<string, number> = {};
    for (const item of result) {
      analytics[item._id] = item.count;
    }
    return analytics as Record<NotificationTrigger, number>;
  }

  /**
   * Get response rate (responded / total sent)
   */
  async getResponseRate(days = 30): Promise<{ total: number; responded: number; rate: number }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [total, responded] = await Promise.all([
      this.notificationLogModel.countDocuments({
        sentAt: { $gte: since },
        deliveryStatus: NotificationDeliveryStatus.SENT,
      }),
      this.notificationLogModel.countDocuments({
        sentAt: { $gte: since },
        deliveryStatus: NotificationDeliveryStatus.SENT,
        responseReceived: true,
      }),
    ]);

    return {
      total,
      responded,
      rate: total > 0 ? Math.round((responded / total) * 100) : 0,
    };
  }
}
