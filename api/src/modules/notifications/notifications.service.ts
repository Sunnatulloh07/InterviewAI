import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { TelegramService } from '../telegram/telegram.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly telegramService: TelegramService,
    private readonly usersService: UsersService,
  ) {}

  async create(data: Partial<Notification>): Promise<NotificationDocument> {
    const notification = new this.notificationModel(data);
    await notification.save();

    // Auto-send based on channel
    if (data.channel === 'telegram') {
      await this.sendViaTelegram(notification);
    }

    return notification as any;
  }

  async findByUserId(userId: string, limit = 20, skip = 0): Promise<NotificationDocument[]> {
    return (await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .exec()) as any;
  }

  async markAsRead(notificationId: string): Promise<void> {
    await this.notificationModel
      .findByIdAndUpdate(notificationId, {
        status: 'read',
        readAt: new Date(),
      })
      .exec();
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        { userId, status: { $ne: 'read' } },
        {
          status: 'read',
          readAt: new Date(),
        },
      )
      .exec();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await this.notificationModel.countDocuments({ userId, status: { $ne: 'read' } }).exec();
  }

  async delete(notificationId: string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(notificationId).exec();
  }

  private async sendViaTelegram(notification: NotificationDocument): Promise<void> {
    try {
      const user = await this.usersService.findById(notification.userId.toString());

      if (user.telegramId) {
        const message = `📢 *${notification.title}*\n\n${notification.message}`;
        await this.telegramService.sendNotification(user.telegramId, message);

        await this.notificationModel.findByIdAndUpdate(notification._id, {
          status: 'sent',
          sentAt: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send Telegram notification: ${error.message}`);
      await this.notificationModel.findByIdAndUpdate(notification._id, {
        status: 'failed',
      });
    }
  }
}
