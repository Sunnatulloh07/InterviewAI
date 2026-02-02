import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  UnregisteredUser,
  UnregisteredUserDocument,
} from '../telegram/schemas/unregistered-user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { getRandomNonRegisteredMessage } from './constants/engagement-messages';

@Injectable()
export class UnregisteredUserService {
  private readonly logger = new Logger(UnregisteredUserService.name);
  private readonly MAX_ENGAGEMENT_MESSAGES = 10;

  constructor(
    @InjectModel(UnregisteredUser.name)
    private readonly unregisteredUserModel: Model<UnregisteredUserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  async trackUserStart(
    telegramChatId: number,
    firstName?: string,
    lastName?: string,
    username?: string,
    language = 'uz',
  ): Promise<void> {
    try {
      await this.unregisteredUserModel.findOneAndUpdate(
        { telegramChatId },
        {
          telegramFirstName: firstName,
          telegramLastName: lastName,
          telegramUsername: username,
          language,
          registrationStatus: 'not_started',
        },
        { upsert: true, new: true },
      );
      this.logger.log(`Tracked unregistered user: ${telegramChatId}`);
    } catch (error: any) {
      this.logger.error(`Failed to track unregistered user ${telegramChatId}: ${error.message}`);
    }
  }

  async updateRegistrationStatus(
    telegramChatId: number,
    status: 'not_started' | 'phone_entered' | 'otp_sent' | 'otp_failed',
  ): Promise<void> {
    try {
      await this.unregisteredUserModel.findOneAndUpdate(
        { telegramChatId },
        { registrationStatus: status },
        { new: true },
      );
      this.logger.debug(`Updated registration status for ${telegramChatId}: ${status}`);
    } catch (error: any) {
      this.logger.error(`Failed to update registration status: ${error.message}`);
    }
  }

  async markAsRegistered(telegramChatId: number): Promise<void> {
    try {
      await this.unregisteredUserModel.deleteOne({ telegramChatId });
      this.logger.log(`User registered, removed from tracking: ${telegramChatId}`);
    } catch (error: any) {
      this.logger.error(`Failed to remove registered user: ${error.message}`);
    }
  }

  async markAsBlocked(telegramChatId: number): Promise<void> {
    try {
      await this.unregisteredUserModel.findOneAndUpdate(
        { telegramChatId },
        {
          isBotBlocked: true,
          botBlockedAt: new Date(),
        },
      );
      this.logger.warn(`Unregistered user blocked bot: ${telegramChatId}`);
    } catch (error: any) {
      this.logger.error(`Failed to mark as blocked: ${error.message}`);
    }
  }

  @Cron('0 */6 * * *', {
    name: 'engage-non-registered-users',
    timeZone: 'Asia/Tashkent',
  })
  async engageNonRegisteredUsers(): Promise<void> {
    try {
      const now = new Date();

      // SCALABILITY FIX: Count total users first
      const totalUsers = await this.unregisteredUserModel.countDocuments({
        isBotBlocked: false,
        blockedAt: { $exists: false },
      });

      this.logger.log(`Found ${totalUsers} unregistered users for engagement`);

      let sent = 0;
      let failed = 0;
      let skipped = 0;
      const BATCH_SIZE = 100;
      let lastId: any = null;

      // SCALABILITY FIX: Cursor-based batch processing
      while (true) {
        const query: any = {
          isBotBlocked: false,
          blockedAt: { $exists: false },
        };

        if (lastId) {
          query._id = { $gt: lastId };
        }

        const userBatch = await this.unregisteredUserModel
          .find(query)
          .sort({ _id: 1 })
          .limit(BATCH_SIZE)
          .lean();

        if (userBatch.length === 0) break;

        this.logger.log(
          `Processing unregistered batch: ${userBatch.length} users (${sent + failed + skipped}/${totalUsers})`,
        );

        for (const user of userBatch) {
          try {
            if (user.totalEngagementSent >= this.MAX_ENGAGEMENT_MESSAGES) {
              skipped++;
              continue;
            }

            const lastSent = user.lastEngagementSentAt || user.createdAt;
            const hoursSinceLastMessage =
              (now.getTime() - new Date(lastSent).getTime()) / (1000 * 60 * 60);

            if (hoursSinceLastMessage < 6) {
              skipped++;
              continue;
            }

            const messageIndex = user.lastEngagementMessageIndex ?? 0;
            const message = getRandomNonRegisteredMessage(user.language || 'uz');

            const bot = this.telegramService.getBot();
            if (bot) {
              try {
                await bot.api.sendMessage(user.telegramChatId, message, {
                  parse_mode: 'HTML',
                });

                await this.unregisteredUserModel.updateOne(
                  { _id: user._id },
                  {
                    $set: {
                      lastEngagementSentAt: now,
                      lastEngagementMessageIndex: messageIndex + 1,
                      totalEngagementSent: user.totalEngagementSent + 1,
                    },
                  },
                );

                sent++;
              } catch (sendError: any) {
                const errorCode = sendError.error_code;
                const errorDescription = sendError.description || '';

                if (
                  errorCode === 403 ||
                  errorDescription.includes('bot was blocked') ||
                  errorDescription.includes('user is deactivated') ||
                  errorDescription.includes('chat not found')
                ) {
                  await this.markAsBlocked(user.telegramChatId);
                } else {
                  failed++;
                }
              }
            }

            await this.delay(200);
          } catch (userError: any) {
            this.logger.error(
              `Failed to process user ${user.telegramChatId}: ${userError.message}`,
            );
            failed++;
          }
        }

        lastId = userBatch[userBatch.length - 1]._id;
      }

      this.logger.log(
        `Unregistered user engagement: sent=${sent}, failed=${failed}, skipped=${skipped}`,
      );
    } catch (error: any) {
      this.logger.error(`Non-registered user engagement failed: ${error.message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getStats(): Promise<{
    total: number;
    engaged: number;
    blocked: number;
    byStatus: Record<string, number>;
  }> {
    try {
      const [total, blocked, notStarted, phoneEntered, otpSent, otpFailed] = await Promise.all([
        this.unregisteredUserModel.countDocuments({}),
        this.unregisteredUserModel.countDocuments({ isBotBlocked: true }),
        this.unregisteredUserModel.countDocuments({ registrationStatus: 'not_started' }),
        this.unregisteredUserModel.countDocuments({ registrationStatus: 'phone_entered' }),
        this.unregisteredUserModel.countDocuments({ registrationStatus: 'otp_sent' }),
        this.unregisteredUserModel.countDocuments({ registrationStatus: 'otp_failed' }),
      ]);

      return {
        total,
        engaged: total,
        blocked,
        byStatus: {
          not_started: notStarted,
          phone_entered: phoneEntered,
          otp_sent: otpSent,
          otp_failed: otpFailed,
        },
      };
    } catch (error: any) {
      this.logger.error(`Failed to get stats: ${error.message}`);
      return { total: 0, engaged: 0, blocked: 0, byStatus: {} };
    }
  }
}
