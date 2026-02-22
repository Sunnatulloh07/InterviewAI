import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { User, UserDocument } from '../users/schemas/user.schema';
import { VoiceUsage, VoiceUsageDocument } from './schemas/voice-usage.schema';

@Injectable()
export class VoiceQuotaService {
  private readonly logger = new Logger(VoiceQuotaService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(VoiceUsage.name) private readonly voiceUsageModel: Model<VoiceUsageDocument>,
  ) {}

  /**
   * Get voice quota for a user
   */
  async getQuota(userId: string) {
    const user = await this.userModel.findById(userId).select('voiceQuota subscription').lean();

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Initialize default quota if not exists (for existing users)
    // FIX #59: Use plan-based defaults instead of hardcoded mock:5
    if (!user.voiceQuota) {
      const defaultQuota = this.getDefaultQuotaForPlan(user.subscription?.plan || 'free_trial');
      await this.userModel.findByIdAndUpdate(userId, {
        voiceQuota: defaultQuota,
      });

      return defaultQuota;
    }

    return user.voiceQuota;
  }

  /**
   * Check if user has enough quota and deduct if yes
   * CRITICAL: Logs usage to voice_usage_history for transparency
   *
   * @param userId - User ID
   * @param type - 'mock' or 'real'
   * @param durationSeconds - ACTUAL duration in seconds from transcription
   * @param interviewSessionId - Optional interview session ID
   * @param transcriptionText - Optional first 500 chars of transcription
   */
  async checkAndUseVoice(
    userId: string,
    type: 'mock' | 'real',
    durationSeconds: number,
    interviewSessionId?: string,
    transcriptionText?: string,
  ): Promise<VoiceUsageDocument> {
    const user = await this.userModel.findById(userId).select('voiceQuota subscription').lean();

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Initialize if not exists
    if (!user.voiceQuota) {
      const defaultQuota = this.getDefaultQuotaForPlan(user.subscription?.plan || 'free_trial');
      await this.userModel.findByIdAndUpdate(userId, {
        voiceQuota: defaultQuota,
      });
      user.voiceQuota = defaultQuota;
    }

    // CRITICAL BUSINESS RULE: Round UP to nearest minute
    // 0-60 seconds = 1 minute
    // 61-120 seconds = 2 minutes, etc.
    const durationMinutes = Math.ceil(durationSeconds / 60);

    const quota = type === 'mock' ? user.voiceQuota.mockVoice : user.voiceQuota.realVoice;

    if (quota.remaining < durationMinutes) {
      throw new BadRequestException(
        `Not enough voice minutes. Need ${durationMinutes} min, have ${quota.remaining} min`,
      );
    }

    // Deduct from user quota
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: {
        [`voiceQuota.${type}Voice.used`]: durationMinutes,
        [`voiceQuota.${type}Voice.remaining`]: -durationMinutes,
      },
    });

    // CRITICAL: Log usage to history (for transparency and analytics)
    const usageRecord = await this.voiceUsageModel.create({
      userId,
      type,
      durationSeconds,
      durationMinutes,
      interviewSessionId: interviewSessionId || undefined,
      transcriptionText: transcriptionText ? transcriptionText.substring(0, 500) : undefined,
      usedAt: new Date(),
    });

    this.logger.log(
      `Voice usage logged: user=${userId}, type=${type}, duration=${durationSeconds}s (${durationMinutes}min)`,
    );

    return usageRecord;
  }

  /**
   * Get default quota based on subscription plan
   * FIX #59: Use COMPLETE_PLAN_LIMITS instead of hardcoded values.
   * free_trial was hardcoded as mock:2 but should be 0 (text only).
   */
  private getDefaultQuotaForPlan(plan: string) {
    // Import from single source of truth to prevent drift
    const { getPlanLimits } = require('@common/constants/plan-limits.constant');
    const limits = getPlanLimits(plan);

    const quota = { mock: limits.voice.mockVoice, real: limits.voice.realVoice };
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      mockVoice: {
        total: quota.mock,
        used: 0,
        remaining: quota.mock,
        resetDate: nextMonth,
      },
      realVoice: {
        total: quota.real,
        used: 0,
        remaining: quota.real,
        resetDate: nextMonth,
      },
    };
  }

  /**
   * Check if user has enough quota without deducting
   */
  async hasEnoughQuota(userId: string, type: 'mock' | 'real', minutes: number): Promise<boolean> {
    const quota = await this.getQuota(userId);
    const voiceQuota = type === 'mock' ? quota.mockVoice : quota.realVoice;
    return voiceQuota.remaining >= minutes;
  }

  /**
   * Log voice usage to history (for VoiceQuotaGuardService)
   *
   * This is a public method to avoid private property access anti-pattern
   * Called by VoiceQuotaGuardService after committing a reservation
   */
  async logUsage(data: {
    userId: any; // Can be ObjectId or string
    type: 'mock' | 'real';
    durationSeconds: number;
    durationMinutes: number;
    interviewSessionId?: string;
    transcriptionText?: string;
  }): Promise<any> {
    return await this.voiceUsageModel.create({
      ...data,
      usedAt: new Date(),
    });
  }

  /**
   * CRITICAL CRON JOB: Reset voice quotas on 1st of each month
   * Runs at 00:01 on the 1st of every month
   * BUSINESS RULE: Reset used=0, remaining=total based on user's plan
   */
  @Cron('1 0 1 * *', {
    name: 'monthly_voice_quota_reset',
    timeZone: 'UTC',
  })
  async resetMonthlyQuotas() {
    try {
      this.logger.log('🔄 Starting monthly voice quota reset...');

      // Get all users with voice quota
      const users = await this.userModel
        .find({
          voiceQuota: { $exists: true },
        })
        .select('_id voiceQuota subscription')
        .lean();

      let successCount = 0;
      let errorCount = 0;

      for (const user of users) {
        try {
          const plan = user.subscription?.plan || 'free_trial';
          const newQuota = this.getDefaultQuotaForPlan(plan);

          // Reset quota: used=0, remaining=total, update resetDate to next month
          await this.userModel.findByIdAndUpdate(user._id, {
            $set: {
              'voiceQuota.mockVoice.used': 0,
              'voiceQuota.mockVoice.remaining': newQuota.mockVoice.total,
              'voiceQuota.mockVoice.total': newQuota.mockVoice.total, // Update total in case plan changed
              'voiceQuota.mockVoice.resetDate': newQuota.mockVoice.resetDate,
              'voiceQuota.realVoice.used': 0,
              'voiceQuota.realVoice.remaining': newQuota.realVoice.total,
              'voiceQuota.realVoice.total': newQuota.realVoice.total,
              'voiceQuota.realVoice.resetDate': newQuota.realVoice.resetDate,
            },
          });

          successCount++;
        } catch (userError: any) {
          this.logger.error(`Failed to reset quota for user ${user._id}: ${userError.message}`);
          errorCount++;
        }
      }

      this.logger.log(
        `✅ Monthly quota reset completed. Success: ${successCount}, Errors: ${errorCount}`,
      );
    } catch (error: any) {
      this.logger.error(`❌ Monthly quota reset failed: ${error.message}`, error.stack);
    }
  }

  /**
   * CLEANUP CRON JOB: Delete voice usage history older than 90 days
   * Runs daily at 2 AM UTC
   * BUSINESS RULE: Keep 90 days of history for analytics
   */
  @Cron('0 2 * * *', {
    name: 'cleanup_old_voice_usage',
    timeZone: 'UTC',
  })
  async cleanupOldUsageHistory() {
    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const result = await this.voiceUsageModel.deleteMany({
        usedAt: { $lt: ninetyDaysAgo },
      });

      this.logger.log(
        `🗑️ Cleaned up ${result.deletedCount} voice usage records older than 90 days`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to cleanup old usage history: ${error.message}`, error.stack);
    }
  }
}
