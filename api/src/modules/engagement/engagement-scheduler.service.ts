import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EngagementService } from './engagement.service';

/**
 * Scheduler configuration
 */
const SCHEDULER_CONFIG = {
  /** Maximum users to process per batch */
  BATCH_SIZE: 50,
  /** Delay between processing each user (ms) - prevents rate limiting */
  USER_DELAY_MS: 200,
  /** Maximum concurrent notifications */
  MAX_CONCURRENT: 5,
  /** Maximum users to process per single run (safety limit) */
  MAX_USERS_PER_RUN: 500,
} as const;

/**
 * Job run statistics
 */
interface JobRunStats {
  lastRunAt: Date | null;
  lastRunDurationMs: number;
  lastRunResults: { sent: number; failed: number; skipped: number };
  totalRunsToday: number;
  totalSentToday: number;
}

/**
 * EngagementSchedulerService
 * 
 * Handles scheduled tasks for the engagement system:
 * - Daily notification processing (09:00 UTC+5 = 04:00 UTC)
 * - Expired notification cleanup
 * - Batch processing with rate limiting
 * 
 * Features:
 * - Environment-based enable/disable
 * - Graceful shutdown support
 * - Run statistics for monitoring
 * - Duplicate processing prevention
 */
@Injectable()
export class EngagementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngagementSchedulerService.name);
  private isProcessing = false;
  private isEnabled = true;
  private shouldStop = false;
  
  private stats: JobRunStats = {
    lastRunAt: null,
    lastRunDurationMs: 0,
    lastRunResults: { sent: 0, failed: 0, skipped: 0 },
    totalRunsToday: 0,
    totalSentToday: 0,
  };

  constructor(
    private readonly engagementService: EngagementService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    // Check if scheduler is enabled via environment
    const disabled = this.configService.get<string>('ENGAGEMENT_SCHEDULER_DISABLED');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    
    // Disable in test environment by default
    if (disabled === 'true' || nodeEnv === 'test') {
      this.isEnabled = false;
      this.logger.warn('EngagementSchedulerService DISABLED (set ENGAGEMENT_SCHEDULER_DISABLED=false to enable)');
      return;
    }

    this.logger.log('EngagementSchedulerService initialized and enabled');
  }

  onModuleDestroy(): void {
    // Signal jobs to stop gracefully
    this.shouldStop = true;
    this.logger.log('EngagementSchedulerService shutting down gracefully');
  }

  /**
   * Daily notification job - runs at 09:00 Tashkent time (UTC+5)
   * 09:00 UTC+5 = 04:00 UTC
   */
  @Cron('0 4 * * *', { name: 'daily-engagement-notifications' })
  async handleDailyNotifications(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug('Scheduler disabled, skipping daily notifications');
      return;
    }

    if (this.isProcessing) {
      this.logger.warn('Daily notification job already running, skipping');
      return;
    }

    this.isProcessing = true;
    this.shouldStop = false;
    const startTime = Date.now();
    this.logger.log('Starting daily engagement notification job');

    try {
      const results = await this.processNotificationBatches();
      
      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      
      // Update stats
      this.updateStats(durationMs, results);
      
      this.logger.log(
        `Daily notification job completed in ${durationSec}s: ` +
        `sent=${results.sent}, failed=${results.failed}, skipped=${results.skipped}`
      );
    } catch (error) {
      this.logger.error(`Daily notification job failed: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Expired notifications job - runs every 6 hours
   * Marks notifications as ignored if 24h response window expired
   */
  @Cron('0 */6 * * *', { name: 'process-expired-notifications' })
  async handleExpiredNotifications(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.logger.debug('Processing expired notifications');

    try {
      const result = await this.engagementService.processExpiredNotifications();
      
      if (result.processed > 0) {
        this.logger.log(
          `Processed ${result.processed} expired notifications, ${result.errors} errors`
        );
      }
    } catch (error) {
      this.logger.error(`Expired notifications job failed: ${error.message}`);
    }
  }

  /**
   * Process notifications in batches with rate limiting
   * Uses a Set to prevent processing the same user twice in one run
   */
  private async processNotificationBatches(): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    let totalSent = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const processedUserIds = new Set<string>();

    // Single batch approach - get all eligible users once and process
    // This prevents infinite loop if users remain eligible after processing
    const allEligibleUsers = await this.engagementService.getEligibleUsers(
      SCHEDULER_CONFIG.MAX_USERS_PER_RUN
    );

    if (allEligibleUsers.length === 0) {
      this.logger.debug('No eligible users found');
      return { sent: 0, failed: 0, skipped: 0 };
    }

    this.logger.log(`Found ${allEligibleUsers.length} eligible users to process`);

    // Process in batches
    for (let i = 0; i < allEligibleUsers.length; i += SCHEDULER_CONFIG.BATCH_SIZE) {
      // Check for graceful shutdown
      if (this.shouldStop) {
        this.logger.warn('Received shutdown signal, stopping batch processing');
        break;
      }

      const batch = allEligibleUsers.slice(i, i + SCHEDULER_CONFIG.BATCH_SIZE);
      
      // Filter out already processed users (safety check)
      const unprocessed = batch.filter(id => !processedUserIds.has(id));
      
      if (unprocessed.length === 0) continue;

      this.logger.debug(`Processing batch ${Math.floor(i / SCHEDULER_CONFIG.BATCH_SIZE) + 1}: ${unprocessed.length} users`);

      const batchResults = await this.processBatch(unprocessed);
      
      // Mark as processed
      unprocessed.forEach(id => processedUserIds.add(id));
      
      totalSent += batchResults.sent;
      totalFailed += batchResults.failed;
      totalSkipped += batchResults.skipped;

      // Add delay between batches
      if (i + SCHEDULER_CONFIG.BATCH_SIZE < allEligibleUsers.length) {
        await this.delay(SCHEDULER_CONFIG.USER_DELAY_MS * 2);
      }
    }

    return { sent: totalSent, failed: totalFailed, skipped: totalSkipped };
  }

  /**
   * Process a batch of users with controlled concurrency
   */
  private async processBatch(userIds: string[]): Promise<{
    sent: number;
    failed: number;
    skipped: number;
  }> {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Process in chunks for controlled concurrency
    for (let i = 0; i < userIds.length; i += SCHEDULER_CONFIG.MAX_CONCURRENT) {
      // Check for graceful shutdown
      if (this.shouldStop) break;

      const chunk = userIds.slice(i, i + SCHEDULER_CONFIG.MAX_CONCURRENT);
      
      const results = await Promise.allSettled(
        chunk.map(userId => this.processUser(userId))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value === 'sent') sent++;
          else if (result.value === 'skipped') skipped++;
          else if (result.value === 'failed') failed++;
        } else {
          failed++;
        }
      }

      // Add delay between chunks to prevent rate limiting
      if (i + SCHEDULER_CONFIG.MAX_CONCURRENT < userIds.length) {
        await this.delay(SCHEDULER_CONFIG.USER_DELAY_MS);
      }
    }

    return { sent, failed, skipped };
  }

  /**
   * Process a single user for notification
   */
  private async processUser(userId: string): Promise<'sent' | 'failed' | 'skipped'> {
    try {
      const result = await this.engagementService.processUserForEngagement(userId);
      
      if (!result) {
        return 'skipped'; // No trigger or not eligible
      }
      
      return result.success ? 'sent' : 'failed';
    } catch (error) {
      this.logger.debug(`Failed to process user ${userId}: ${error.message}`);
      return 'failed';
    }
  }

  /**
   * Update run statistics
   */
  private updateStats(durationMs: number, results: { sent: number; failed: number; skipped: number }): void {
    const now = new Date();
    const lastRunDate = this.stats.lastRunAt;
    
    // Reset daily counts if it's a new day
    if (!lastRunDate || lastRunDate.toDateString() !== now.toDateString()) {
      this.stats.totalRunsToday = 0;
      this.stats.totalSentToday = 0;
    }

    this.stats.lastRunAt = now;
    this.stats.lastRunDurationMs = durationMs;
    this.stats.lastRunResults = results;
    this.stats.totalRunsToday++;
    this.stats.totalSentToday += results.sent;
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Manual trigger for testing (can be called via admin endpoint)
   */
  async triggerManualRun(): Promise<{ sent: number; failed: number; skipped: number }> {
    if (!this.isEnabled) {
      throw new Error('Scheduler is disabled');
    }

    if (this.isProcessing) {
      throw new Error('Job already running');
    }

    this.logger.log('Manual engagement run triggered');
    this.isProcessing = true;
    this.shouldStop = false;
    const startTime = Date.now();

    try {
      const results = await this.processNotificationBatches();
      this.updateStats(Date.now() - startTime, results);
      return results;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get scheduler status and statistics (for monitoring)
   */
  getStatus(): {
    isEnabled: boolean;
    isProcessing: boolean;
    stats: JobRunStats;
  } {
    return {
      isEnabled: this.isEnabled,
      isProcessing: this.isProcessing,
      stats: { ...this.stats },
    };
  }

  /**
   * Enable/disable scheduler dynamically
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.logger.log(`Scheduler ${enabled ? 'enabled' : 'disabled'}`);
  }
}
