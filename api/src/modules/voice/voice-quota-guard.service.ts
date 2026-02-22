import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { User, UserDocument } from '../users/schemas/user.schema';
import { VoiceReservation, VoiceReservationDocument } from './schemas/voice-reservation.schema';
import { VoiceQuotaService } from './voice-quota.service';

/**
 * PRE-FLIGHT CHECK RESULT
 */
export interface PreFlightResult {
  allowed: boolean;
  estimatedMinutes: number;
  quotaInfo: {
    total: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  rejectionReason?: 'insufficient_quota' | 'plan_not_allowed' | 'user_not_found';
}

/**
 * RESERVATION CONTEXT
 */
export interface ReservationContext {
  flow: 'mock_interview' | 'live_session' | 'daily_task';
  sessionId?: string;
  estimatedDurationSeconds: number;
  actualDurationSeconds?: number;
}

/**
 * Voice Quota Guard Service
 *
 * Implements transaction-safe quota management with reservation pattern:
 *
 * 1. PRE-FLIGHT CHECK: Validate quota before downloading
 * 2. RESERVE: Soft-lock quota before processing
 * 3. COMMIT: Convert reserved → used after AI success
 * 4. ROLLBACK: Return reserved → available if AI fails
 *
 * This prevents:
 * - Charging users for failed services (user protection)
 * - Revenue loss from successful services (business protection)
 * - Race conditions (technical correctness)
 *
 * @example
 * ```typescript
 * // 1. Pre-flight check
 * const check = await guard.preFlightCheck(userId, 'mock', 45);
 * if (!check.allowed) return;
 *
 * // 2. Reserve quota
 * const resId = await guard.reserveQuota(userId, 'mock', check.estimatedMinutes, {...});
 *
 * try {
 *   // 3. Process AI
 *   const result = await aiService.process(...);
 *
 *   // 4. Commit on success
 *   await guard.commitReservation(resId);
 * } catch (error) {
 *   // 5. Rollback on failure
 *   await guard.rollbackReservation(resId);
 *   throw error;
 * }
 * ```
 */
@Injectable()
export class VoiceQuotaGuardService {
  private readonly logger = new Logger(VoiceQuotaGuardService.name);

  // Reservation expiry time (5 minutes)
  private readonly RESERVATION_EXPIRY_MS = 5 * 60 * 1000;

  // 🛡 PHASE 1.2: Redis queue for failed rollbacks
  private readonly FAILED_ROLLBACK_QUEUE = 'voice-quota:failed-rollbacks';

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(VoiceReservation.name)
    private readonly reservationModel: Model<VoiceReservationDocument>,
    private readonly voiceQuotaService: VoiceQuotaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * PRE-FLIGHT CHECK
   *
   * Validates if user has enough quota BEFORE downloading/processing
   *
   * @param userId - User ID
   * @param type - 'mock' or 'real'
   * @param durationSeconds - Estimated duration
   * @returns PreFlightResult with allowed status and quota info
   */
  async preFlightCheck(
    userId: string,
    type: 'mock' | 'real',
    durationSeconds: number,
  ): Promise<PreFlightResult> {
    try {
      // Get user quota
      const user = await this.userModel.findById(userId).select('voiceQuota subscription').lean();

      if (!user) {
        return {
          allowed: false,
          estimatedMinutes: 0,
          quotaInfo: { total: 0, used: 0, reserved: 0, remaining: 0 },
          rejectionReason: 'user_not_found',
        };
      }

      // FIX #108: Check subscription validity before allowing voice usage
      const sub = user.subscription;
      if (sub) {
        const now = new Date();
        const plan = sub.plan || 'free_trial';

        if (plan === 'free_trial') {
          const trialEnd = sub.trialEndsAt;
          if (trialEnd && now > new Date(trialEnd)) {
            return {
              allowed: false,
              estimatedMinutes: 0,
              quotaInfo: { total: 0, used: 0, reserved: 0, remaining: 0 },
              rejectionReason: 'plan_not_allowed',
            };
          }
        } else if (
          sub.status === 'expired' ||
          sub.status === 'cancelled' ||
          (sub.endDate && now > new Date(sub.endDate))
        ) {
          return {
            allowed: false,
            estimatedMinutes: 0,
            quotaInfo: { total: 0, used: 0, reserved: 0, remaining: 0 },
            rejectionReason: 'plan_not_allowed',
          };
        }
      }

      // Initialize if not exists
      if (!user.voiceQuota) {
        const quota = await this.voiceQuotaService.getQuota(userId);
        user.voiceQuota = quota;
      }

      const quota = type === 'mock' ? user.voiceQuota.mockVoice : user.voiceQuota.realVoice;

      // Round up to nearest minute (business rule)
      const estimatedMinutes = Math.ceil(durationSeconds / 60);

      // Calculate total reserved quota (not yet committed)
      const activeReservations = await this.reservationModel
        .find({
          userId: new Types.ObjectId(userId),
          type,
          status: 'reserved',
          expiresAt: { $gt: new Date() }, // Not expired
        })
        .select('minutes')
        .lean();

      const totalReserved = activeReservations.reduce((sum, r) => sum + r.minutes, 0);

      // Calculate true remaining (subtract active reservations)
      const trueRemaining = quota.remaining - totalReserved;

      const allowed = trueRemaining >= estimatedMinutes;

      return {
        allowed,
        estimatedMinutes,
        quotaInfo: {
          total: quota.total,
          used: quota.used,
          reserved: totalReserved,
          remaining: trueRemaining,
        },
        rejectionReason: allowed ? undefined : 'insufficient_quota',
      };
    } catch (error: any) {
      this.logger.error(`Pre-flight check failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * RESERVE QUOTA
   *
   * Soft-locks quota before processing. This prevents:
   * - Other requests from using the same quota
   * - Charging user if AI processing fails
   *
   * @param userId - User ID
   * @param type - 'mock' or 'real'
   * @param minutes - Minutes to reserve
   * @param context - Reservation context
   * @returns Reservation ID for commit/rollback
   */
  async reserveQuota(
    userId: string,
    type: 'mock' | 'real',
    minutes: number,
    context: ReservationContext,
  ): Promise<string> {
    try {
      // Double-check quota (race condition protection)
      const preflight = await this.preFlightCheck(userId, type, minutes * 60);

      if (!preflight.allowed) {
        throw new BadRequestException(
          `Cannot reserve quota: ${preflight.rejectionReason}. ` +
            `Need ${minutes} min, have ${preflight.quotaInfo.remaining} min available`,
        );
      }

      // Create reservation
      const reservation = await this.reservationModel.create({
        userId: new Types.ObjectId(userId),
        type,
        minutes,
        status: 'reserved',
        context,
        reservedAt: new Date(),
        expiresAt: new Date(Date.now() + this.RESERVATION_EXPIRY_MS),
      });

      this.logger.log(
        `Quota reserved: user=${userId}, type=${type}, minutes=${minutes}, ` +
          `resId=${(reservation._id as Types.ObjectId).toString()}, flow=${context.flow}`,
      );

      return (reservation._id as Types.ObjectId).toString();
    } catch (error: any) {
      this.logger.error(`Failed to reserve quota: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * COMMIT RESERVATION
   *
   * Converts reserved quota to used quota after AI processing succeeds
   *
   * @param reservationId - Reservation ID from reserveQuota()
   */
  async commitReservation(reservationId: string): Promise<void> {
    try {
      const reservation = await this.reservationModel.findById(reservationId);

      if (!reservation) {
        this.logger.error(`CRITICAL: Reservation not found: ${reservationId}`);
        throw new BadRequestException('Reservation not found');
      }

      if (reservation.status !== 'reserved') {
        this.logger.warn(
          `Attempted to commit non-reserved reservation: ${reservationId}, status=${reservation.status}`,
        );
        return; // Already committed or rolled back
      }

      // Check if expired
      if (reservation.expiresAt < new Date()) {
        this.logger.error(
          `CRITICAL: Attempted to commit expired reservation: ${reservationId}. Auto-rolling back.`,
        );
        await this.rollbackReservation(reservationId, 'expired');
        throw new BadRequestException('Reservation expired');
      }

      // CRITICAL FIX: Update reservation status FIRST (before quota deduction)
      // This prevents rollback if quota deduction succeeds but status update fails
      await this.reservationModel.findByIdAndUpdate(reservationId, {
        status: 'committed',
        committedAt: new Date(),
      });

      // Now deduct from user quota (after status is committed)
      await this.userModel.findByIdAndUpdate(reservation.userId, {
        $inc: {
          [`voiceQuota.${reservation.type}Voice.used`]: reservation.minutes,
          [`voiceQuota.${reservation.type}Voice.remaining`]: -reservation.minutes,
        },
      });

      // Log to usage history (for transparency and analytics)
      // This is non-critical - if it fails, quota is already deducted
      try {
        await this.voiceQuotaService.logUsage({
          userId: reservation.userId.toString(),
          type: reservation.type,
          durationSeconds:
            reservation.context.actualDurationSeconds ||
            reservation.context.estimatedDurationSeconds,
          durationMinutes: reservation.minutes,
          interviewSessionId: reservation.context.sessionId,
        });
      } catch (logError: any) {
        this.logger.warn(
          `Failed to log usage for reservation ${reservationId}: ${logError.message}`,
        );
        // Continue - quota already deducted, logging is not critical
      }

      this.logger.log(
        `Quota committed: user=${reservation.userId}, type=${reservation.type}, ` +
          `minutes=${reservation.minutes}, resId=${reservationId}, flow=${reservation.context.flow}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to commit reservation ${reservationId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * ROLLBACK RESERVATION
   *
   * Returns reserved quota to available pool if AI processing fails
   *
   * 🛡 PHASE 1.2 FIX: Enhanced with retry queue fallback
   * - If rollback succeeds → ✅ Done
   * - If rollback fails → 📦 Add to Redis retry queue
   * - Cron job retries every 5 minutes
   *
   * @param reservationId - Reservation ID from reserveQuota()
   * @param reason - Reason for rollback
   */
  async rollbackReservation(
    reservationId: string,
    reason: 'expired' | 'ai_failed' | 'user_cancelled' = 'ai_failed',
  ): Promise<void> {
    try {
      const reservation = await this.reservationModel.findById(reservationId);

      if (!reservation) {
        this.logger.warn(`Rollback attempted for non-existent reservation: ${reservationId}`);
        return;
      }

      if (reservation.status !== 'reserved') {
        this.logger.debug(`Rollback skipped - already ${reservation.status}: ${reservationId}`);
        return; // Already committed or rolled back
      }

      // Update reservation status
      await this.reservationModel.findByIdAndUpdate(reservationId, {
        status: 'rolled_back',
        rolledBackAt: new Date(),
        rollbackReason: reason,
      });

      this.logger.log(
        `Quota rolled back: user=${reservation.userId}, type=${reservation.type}, ` +
          `minutes=${reservation.minutes}, resId=${reservationId}, reason=${reason}`,
      );
    } catch (error: any) {
      this.logger.error(
        `CRITICAL: Rollback failed for ${reservationId}: ${error.message}`,
        error.stack,
      );

      // 🛡 PHASE 1.2: Add to retry queue instead of throwing
      try {
        const failedRollback = {
          reservationId,
          reason,
          failedAt: new Date().toISOString(),
          error: error.message,
          retryCount: 0,
        };

        await this.redis.lpush(this.FAILED_ROLLBACK_QUEUE, JSON.stringify(failedRollback));

        this.logger.warn(`❌ Rollback failed, added to retry queue: ${reservationId}`);
      } catch (queueError: any) {
        this.logger.error(`💀 DOUBLE FAILURE: Could not add to retry queue: ${queueError.message}`);
        // At this point, we need manual intervention or monitoring alert
      }

      // 🛡 DON'T throw - let the calling code continue
      // The quota will be recovered by retry cron job
    }
  }

  /**
   * AUTO-CLEANUP CRON JOB
   *
   * Runs every 5 minutes to rollback expired reservations
   * Prevents quota leakage from crashed/abandoned requests
   */
  @Cron('*/5 * * * *', {
    name: 'cleanup_expired_reservations',
    timeZone: 'UTC',
  })
  async cleanupExpiredReservations(): Promise<void> {
    try {
      const now = new Date();

      // Find expired reservations
      const expiredReservations = await this.reservationModel.find({
        status: 'reserved',
        expiresAt: { $lt: now },
      });

      if (expiredReservations.length === 0) {
        return;
      }

      this.logger.log(`🧹 Cleaning up ${expiredReservations.length} expired voice reservations...`);

      let successCount = 0;
      let errorCount = 0;

      for (const reservation of expiredReservations) {
        try {
          await this.rollbackReservation((reservation._id as Types.ObjectId).toString(), 'expired');
          successCount++;
        } catch (error: any) {
          this.logger.error(
            `Failed to rollback expired reservation ${reservation._id}: ${error.message}`,
          );
          errorCount++;
        }
      }

      this.logger.log(
        `✅ Expired reservations cleanup complete. Success: ${successCount}, Errors: ${errorCount}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to cleanup expired reservations: ${error.message}`, error.stack);
    }
  }

  /**
   * 🛡 PHASE 1.2: RETRY FAILED ROLLBACKS CRON
   *
   * Runs every 5 minutes to retry failed rollback operations
   * Prevents permanent quota leakage from failed rollbacks
   *
   * Flow:
   * 1. Get all failed rollbacks from Redis queue
   * 2. Retry each rollback
   * 3. If success → remove from queue
   * 4. If fail again → increment retry count, keep in queue
   * 5. After 10 retries → move to dead letter queue for manual review
   */
  @Cron('*/5 * * * *', {
    name: 'retry_failed_rollbacks',
    timeZone: 'UTC',
  })
  async retryFailedRollbacks(): Promise<void> {
    try {
      // Get all failed rollbacks (max 100 at a time)
      const queueLength = await this.redis.llen(this.FAILED_ROLLBACK_QUEUE);

      if (queueLength === 0) {
        return; // Nothing to retry
      }

      this.logger.log(`🔄 Retrying ${queueLength} failed rollback operations...`);

      const failedRollbacks = await this.redis.lrange(this.FAILED_ROLLBACK_QUEUE, 0, 99);

      let successCount = 0;
      let permanentFailCount = 0;
      let retriedCount = 0;

      for (const item of failedRollbacks) {
        try {
          const failedRollback = JSON.parse(item);
          const { reservationId, reason, retryCount } = failedRollback;

          // Max 10 retries, then give up
          if (retryCount >= 10) {
            this.logger.error(
              `💀 Rollback failed 10 times, moving to dead letter: ${reservationId}`,
            );

            // Move to dead letter queue for manual review
            await this.redis.lpush(`${this.FAILED_ROLLBACK_QUEUE}:dead-letter`, item);

            // Remove from main queue
            await this.redis.lrem(this.FAILED_ROLLBACK_QUEUE, 1, item);

            permanentFailCount++;
            continue;
          }

          // Retry the rollback
          try {
            await this.rollbackReservation(reservationId, reason);

            // Success! Remove from queue
            await this.redis.lrem(this.FAILED_ROLLBACK_QUEUE, 1, item);

            this.logger.log(
              `✅ Retry succeeded for rollback: ${reservationId} (after ${retryCount} retries)`,
            );

            successCount++;
          } catch (retryError: any) {
            // Still failing, increment retry count and keep in queue
            failedRollback.retryCount = retryCount + 1;
            failedRollback.lastRetryAt = new Date().toISOString();
            failedRollback.lastRetryError = retryError.message;

            // Update in queue (remove old, add updated)
            await this.redis.lrem(this.FAILED_ROLLBACK_QUEUE, 1, item);
            await this.redis.lpush(this.FAILED_ROLLBACK_QUEUE, JSON.stringify(failedRollback));

            this.logger.warn(
              `❌ Retry failed for rollback: ${reservationId} (attempt ${retryCount + 1}/10)`,
            );

            retriedCount++;
          }
        } catch (parseError: any) {
          this.logger.error(`Failed to parse rollback item: ${parseError.message}`);
          // Remove corrupted item
          await this.redis.lrem(this.FAILED_ROLLBACK_QUEUE, 1, item);
        }
      }

      this.logger.log(
        `✅ Retry complete: ${successCount} recovered, ${retriedCount} retried, ${permanentFailCount} moved to dead letter`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to retry rollbacks: ${error.message}`, error.stack);
    }
  }

  /**
   * Get user's active reservations (for debugging/analytics)
   */
  async getActiveReservations(userId: string): Promise<any[]> {
    return await this.reservationModel
      .find({
        userId: new Types.ObjectId(userId),
        status: 'reserved',
        expiresAt: { $gt: new Date() },
      })
      .sort({ reservedAt: -1 })
      .lean();
  }
}
