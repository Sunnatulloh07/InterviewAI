import { Injectable, Logger, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { OpenAI } from 'openai';
import { DailyTask, DailyTaskDocument } from './schemas/daily-task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { FailedNotificationRetryService } from '../engagement/failed-notification-retry.service';
import { createOpenAIClient } from '@common/utils/openai-client.factory';
import {
  getPlanLimits,
  canUseDailyTaskVoiceAnswer,
  canUseDailyTaskImageAnswer,
  canUseDailyTaskVideoAnswer,
} from '@common/constants';

@Injectable()
export class DailyTasksService {
  private readonly logger = new Logger(DailyTasksService.name);
  private readonly openai: OpenAI | null;

  constructor(
    @InjectModel(DailyTask.name)
    private readonly dailyTaskModel: Model<DailyTaskDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => FailedNotificationRetryService))
    private readonly retryService: FailedNotificationRetryService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Deliver daily tasks at 9 AM Tashkent time (UTC+5)
   * 9 AM Tashkent = 4 AM UTC
   * Cron: 0 4 * * * (every day at 4 AM UTC)
   * 
   * SCALABILITY FIX: Batch processing for 1M+ users
   * - Process users in batches of 100
   * - Cursor-based pagination to avoid memory overflow
   * - Progress tracking in Redis
   */
  @Cron('0 4 * * *', {
    name: 'deliver_daily_tasks',
    timeZone: 'Asia/Tashkent',
  })
  async deliverDailyTasks() {
    // CRITICAL FIX: Distributed lock to prevent duplicate task delivery
    // in multi-instance deployments (horizontal scaling)
    const lockKey = 'cron:daily-tasks:delivery';
    const lockTTL = 3600; // 1 hour max execution time (for 1M+ users)
    
    try {
      // Acquire lock (NX = only set if not exists)
      const lockAcquired = await this.redis.set(lockKey, Date.now().toString(), 'EX', lockTTL, 'NX');
      
      if (!lockAcquired) {
        this.logger.warn('Daily tasks cron already running on another instance, skipping');
        return;
      }
      
      this.logger.log('Starting daily tasks delivery...');

      // CRITICAL FIX: Get ONLY PAID users with active subscription
      // Daily tasks are ONLY for paid plans (starter, pro, elite)
      const now = new Date();
      const today = this.getTashkentMidnight();
      
      // SCALABILITY FIX: Count total users first
      const totalUsers = await this.userModel.countDocuments({
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

      this.logger.log(`Found ${totalUsers} eligible PAID users for daily tasks`);

      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;
      const BATCH_SIZE = 100;
      let lastId: any = null;

      // SCALABILITY FIX: Cursor-based batch processing
      while (true) {
        const query: any = {
          'subscription.status': 'active',
          'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
          $or: [
            { 'subscription.endDate': { $exists: false } },
            { 'subscription.endDate': null },
            { 'subscription.endDate': { $gt: now } },
          ],
          isBlocked: false,
          'engagement.isBotBlocked': { $ne: true },
        };

        // Cursor: start from last processed user ID
        if (lastId) {
          query._id = { $gt: lastId };
        }

        const userBatch = await this.userModel
          .find(query)
          .sort({ _id: 1 }) // Important: consistent ordering
          .limit(BATCH_SIZE)
          .select('_id telegramId profile subscription')
          .lean();

        if (userBatch.length === 0) {
          break; // No more users to process
        }

        this.logger.log(
          `Processing batch: ${userBatch.length} users (progress: ${successCount + errorCount + skippedCount}/${totalUsers})`
        );

        for (const user of userBatch) {
          try {
            // Check if tasks already delivered today
            const existingTask = await this.dailyTaskModel.findOne({
              userId: user._id,
              date: today,
            });

            if (existingTask) {
              this.logger.debug(`Tasks already delivered for user ${user._id}`);
              skippedCount++;
              continue;
            }

            // Generate 3 questions for the day
            const position = user.profile?.position || 'junior';
            const tasks = [
              {
                question: this.generateQuestion(position, 'technical'),
                completed: false,
              },
              {
                question: this.generateQuestion(position, 'behavioral'),
                completed: false,
              },
              {
                question: this.generateQuestion(position, 'system_design'),
                completed: false,
              },
            ];

            // Create daily task document
            await this.dailyTaskModel.create({
              userId: user._id,
              date: today,
              tasks,
              status: 'pending',
            });

            // Send Telegram notification
            try {
              const bot = this.telegramService.getBot();
              if (bot && user.telegramId) {
                await bot.api.sendMessage(
                  user.telegramId,
                  '🎯 Your daily tasks are ready! Use /tasks to see them.',
                );
              }
            } catch (sendError: any) {
              const errorMessage = sendError.description || sendError.message;
              const isBlockedError =
                errorMessage?.includes('bot was blocked') ||
                errorMessage?.includes('user is deactivated') ||
                errorMessage?.includes('chat not found');

              this.logger.warn(
                `Failed to send notification to user ${user._id}: ${errorMessage}`,
              );

              if (!isBlockedError) {
                await this.retryService.trackFailedNotification(
                  user._id.toString(),
                  user.telegramId,
                  'daily_task_delivery',
                  errorMessage,
                  sendError.error_code,
                );
              }
            }

            successCount++;
            
            // Rate limiting: 200ms between messages
            await this.delay(200);
          } catch (userError: any) {
            this.logger.error(
              `Failed to deliver tasks for user ${user._id}: ${userError.message}`,
              userError.stack,
            );
            errorCount++;
          }
        }

        // Update cursor to last processed user ID
        lastId = userBatch[userBatch.length - 1]._id;

        // Store progress in Redis for monitoring
        await this.redis.set(
          'cron:daily-tasks:progress',
          JSON.stringify({
            total: totalUsers,
            success: successCount,
            error: errorCount,
            skipped: skippedCount,
            lastId: lastId ? lastId.toString() : null,
            timestamp: new Date().toISOString(),
          }),
          'EX',
          3600,
        );
      }

      this.logger.log(
        `Daily tasks delivery completed. Total: ${totalUsers}, Success: ${successCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to deliver daily tasks: ${error.message}`,
        error.stack,
      );
    } finally {
      // CRITICAL: Always release lock, even if job fails
      try {
        await this.redis.del(lockKey);
        await this.redis.del('cron:daily-tasks:progress');
        this.logger.debug('Daily tasks lock released');
      } catch (lockError: any) {
        this.logger.error(`Failed to release daily tasks lock: ${lockError.message}`);
        // Lock will auto-expire after 1 hour
      }
    }
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get today's tasks for a user
   */
  async getTodayTasks(userId: string, date?: Date): Promise<DailyTaskDocument | null> {
    // CRITICAL FIX: Use Tashkent midnight
    const today = date ? new Date(date) : this.getTashkentMidnight();
    
    // If date provided, normalize to midnight
    if (date) {
      today.setUTCHours(0, 0, 0, 0);
      today.setUTCHours(today.getUTCHours() - 5); // Convert to Tashkent
    }

    return this.dailyTaskModel.findOne({
      userId,
      date: today,
    });
  }

  /**
   * Complete a task with AI scoring
   * ✅ Supports multimodal answers (voice/image) with plan enforcement
   * ❌ VIDEO NOT SUPPORTED - Too expensive for AI processing
   */
  async completeTask(
    userId: string,
    taskDate: Date,
    taskIndex: number,
    answer: string | {
      type: 'text' | 'voice' | 'image';  // ❌ NO VIDEO
      content: string;           // Text content or transcript
      audioUrl?: string;         // For voice
      imageUrl?: string;         // For image
      transcript?: string;       // STT result for voice
    },
  ): Promise<{ score: number; feedback: string; allCompleted: boolean }> {
    const today = new Date(taskDate);
    today.setHours(0, 0, 0, 0);

    const dailyTask = await this.dailyTaskModel.findOne({
      userId,
      date: today,
    });

    if (!dailyTask) {
      throw new Error('Daily task not found');
    }

    if (taskIndex < 0 || taskIndex >= dailyTask.tasks.length) {
      throw new Error('Invalid task index');
    }

    const task = dailyTask.tasks[taskIndex];
    
    // ✅ Handle both string (legacy) and object (multimodal) answer formats
    let answerText: string;
    let answerType: 'text' | 'voice' | 'image' = 'text';  // ❌ NO VIDEO
    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    let transcript: string | undefined;
    let userPlan: string = 'free_trial';  // For plan-aware scoring
    
    if (typeof answer === 'string') {
      // Legacy format: plain text
      answerText = answer;
      answerType = 'text';
      // Fetch user plan for scoring
      const user = await this.userModel.findById(userId).select('subscription');
      userPlan = user?.subscription?.plan || 'free_trial';
    } else {
      // New multimodal format
      answerType = answer.type;
      answerText = answer.content || answer.transcript || '';
      audioUrl = answer.audioUrl;
      imageUrl = answer.imageUrl;
      transcript = answer.transcript;
      
      // ✅ CRITICAL: Check plan permissions for non-text answers
      const user = await this.userModel.findById(userId).select('subscription');
      userPlan = user?.subscription?.plan || 'free_trial';
      
      // ❌ VIDEO IS NEVER ALLOWED - Reject if user tries to send video via any means
      if ((answer as any).videoUrl || (answer as any).type === 'video') {
        throw new ForbiddenException(
          `Video answers are not supported. ` +
          `AI video processing is too expensive. ` +
          `Please use text, voice, or image answers instead.`
        );
      }
      
      if (answerType === 'voice' && !canUseDailyTaskVoiceAnswer(userPlan)) {
        throw new ForbiddenException(
          `Voice answers for daily tasks require Starter plan or higher. ` +
          `Current plan: ${userPlan}. Upgrade to use voice answers.`
        );
      }
      
      if (answerType === 'image' && !canUseDailyTaskImageAnswer(userPlan)) {
        throw new ForbiddenException(
          `Image answers for daily tasks require Starter plan or higher. ` +
          `Current plan: ${userPlan}. Upgrade to use image answers.`
        );
      }
      
      this.logger.log(
        `Processing ${answerType} answer for task ${taskIndex}, user ${userId}, plan ${userPlan}`
      );
    }
    
    let score = 0;
    let feedback = 'Answer recorded.';

    try {
      const result = await this.scoreAnswer(task.question, answerText, userPlan);
      score = result.score;
      feedback = result.feedback;
    } catch (error: any) {
      this.logger.error(`Failed to score answer: ${error.message}`);
      score = 5; // Default score if scoring fails
      feedback = 'Answer received but scoring unavailable. Keep practicing!';
    }

    // ✅ Mark task as completed with multimodal fields
    dailyTask.tasks[taskIndex].completed = true;
    dailyTask.tasks[taskIndex].answer = answerText;
    dailyTask.tasks[taskIndex].answerType = answerType;
    dailyTask.tasks[taskIndex].score = score;
    dailyTask.tasks[taskIndex].feedback = feedback;
    dailyTask.tasks[taskIndex].completedAt = new Date();
    
    // Store media URLs if provided (NO VIDEO)
    if (audioUrl) dailyTask.tasks[taskIndex].audioUrl = audioUrl;
    if (imageUrl) dailyTask.tasks[taskIndex].imageUrl = imageUrl;
    if (transcript) dailyTask.tasks[taskIndex].transcript = transcript;

    // Check if all tasks completed
    const allCompleted = dailyTask.tasks.every((t) => t.completed);
    if (allCompleted) {
      dailyTask.status = 'completed';

      // Update user streak
      const user = await this.userModel.findById(userId);
      if (user) {
        const newStreak = (user.dailyTasks?.currentStreak || 0) + 1;
        const longestStreak = Math.max(
          user.dailyTasks?.longestStreak || 0,
          newStreak,
        );

        await this.userModel.findByIdAndUpdate(userId, {
          $set: {
            'dailyTasks.currentStreak': newStreak,
            'dailyTasks.longestStreak': longestStreak,
          },
          $inc: {
            'dailyTasks.totalCompleted': 1,
          },
        });
      }
    }

    await dailyTask.save();

    return { score, feedback, allCompleted };
  }

  /**
   * Score an answer using plan-appropriate method
   * ✅ STEP 6: Plan-aware AI scoring
   * - FREE: 'basic' - simple keyword matching, no AI call
   * - STARTER: 'advanced' - GPT-3.5 with shorter prompt
   * - PRO/ELITE: 'ai-powered' - Full GPT-4 analysis with detailed feedback
   */
  private async scoreAnswer(
    question: string,
    answer: string,
    plan: string = 'free_trial',
  ): Promise<{ score: number; feedback: string }> {
    const planLimits = getPlanLimits(plan);
    const scoringLevel = planLimits.aiFeatures.taskCompletionCheck;
    
    this.logger.debug(`Scoring answer with level: ${scoringLevel} for plan: ${plan}`);
    
    switch (scoringLevel) {
      case 'basic':
        return this.scoreAnswerBasic(question, answer);
      case 'advanced':
        return this.scoreAnswerAdvanced(question, answer);
      case 'ai-powered':
        return this.scoreAnswerAIPowered(question, answer);
      default:
        return this.scoreAnswerBasic(question, answer);
    }
  }

  /**
   * Basic scoring (FREE plan) - keyword matching, no AI
   * Fast and cost-free, but less accurate
   */
  private scoreAnswerBasic(
    question: string,
    answer: string,
  ): { score: number; feedback: string } {
    const answerLower = answer.toLowerCase();
    const questionLower = question.toLowerCase();
    
    // Extract key terms from question (simple approach)
    const keywords = this.extractKeywords(questionLower);
    const matchedKeywords = keywords.filter(kw => answerLower.includes(kw));
    const keywordRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;
    
    // Length check
    const wordCount = answer.split(/\s+/).length;
    const lengthScore = Math.min(1, wordCount / 50); // Good answer ~50+ words
    
    // Calculate score (0-10)
    const rawScore = (keywordRatio * 0.6 + lengthScore * 0.4) * 10;
    const score = Math.round(Math.min(10, Math.max(0, rawScore)));
    
    // Generate feedback
    let feedback = '';
    if (score >= 7) {
      feedback = 'Good answer! You covered the key points.';
    } else if (score >= 5) {
      feedback = 'Decent attempt. Try to be more specific and cover key concepts.';
    } else if (score >= 3) {
      feedback = 'More detail needed. Consider elaborating on your answer.';
    } else {
      feedback = 'Answer needs improvement. Review the question and provide a more complete response.';
    }
    
    return { score, feedback };
  }

  /**
   * Extract simple keywords from a question
   */
  private extractKeywords(text: string): string[] {
    const stopWords = ['what', 'is', 'the', 'a', 'an', 'how', 'do', 'you', 'are', 'can', 'could', 'would', 'should', 'when', 'why', 'where', 'which', 'tell', 'me', 'about', 'and', 'or', 'to', 'in', 'of', 'for', 'with', 'on', 'at', 'by', 'your', 'that', 'this'];
    return text
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.includes(word))
      .slice(0, 10); // Max 10 keywords
  }

  /**
   * Advanced scoring (STARTER plan) - GPT-3.5 with concise prompt
   */
  private async scoreAnswerAdvanced(
    question: string,
    answer: string,
  ): Promise<{ score: number; feedback: string }> {
    if (!this.openai) {
      return this.scoreAnswerBasic(question, answer);
    }

    const prompt = `Score this interview answer (0-10) and give brief feedback (50 words max).
Question: ${question}
Answer: ${answer}

JSON response: {"score": <0-10>, "feedback": "<brief feedback>"}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Score interview answers briefly. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 150,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(completion.choices[0]?.message?.content || '{"score": 5, "feedback": "Reviewed."}');
      return {
        score: Math.min(10, Math.max(0, result.score || 5)),
        feedback: result.feedback || 'Keep practicing!',
      };
    } catch (error: any) {
      this.logger.error(`Advanced scoring failed: ${error.message}`);
      return this.scoreAnswerBasic(question, answer);
    }
  }

  /**
   * AI-Powered scoring (PRO/ELITE) - Full analysis with detailed feedback
   */
  private async scoreAnswerAIPowered(
    question: string,
    answer: string,
  ): Promise<{ score: number; feedback: string }> {
    if (!this.openai) {
      return this.scoreAnswerAdvanced(question, answer);
    }

    const prompt = `You are an expert interview coach. Provide a comprehensive evaluation of this interview answer.

Question: ${question}

Candidate's Answer: ${answer}

Evaluate based on:
1. Completeness - Does it fully address the question?
2. Structure - Is it well-organized (STAR method for behavioral, etc.)?
3. Specificity - Are there concrete examples and metrics?
4. Communication - Is it clear and professional?
5. Technical accuracy - For tech questions, is it correct?

Provide your response in JSON format:
{
  "score": <number 0-10>,
  "feedback": "<detailed constructive feedback with specific improvement suggestions, 100-150 words>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"]
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'You are an expert interview coach who provides detailed, actionable feedback. Return valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
      
      // Build enhanced feedback
      let feedback = result.feedback || 'Good effort!';
      if (result.strengths?.length) {
        feedback += ` Strengths: ${result.strengths.join(', ')}.`;
      }
      if (result.improvements?.length) {
        feedback += ` Areas to improve: ${result.improvements.join(', ')}.`;
      }

      return {
        score: Math.min(10, Math.max(0, result.score || 5)),
        feedback,
      };
    } catch (error: any) {
      this.logger.error(`AI-powered scoring failed: ${error.message}`);
      return this.scoreAnswerAdvanced(question, answer);
    }
  }

  /**
   * Verify and fix missed task deliveries (SCALABILITY FIX)
   * Runs 2 hours after delivery (11:00 Tashkent time)
   * Checks if all paid users received tasks and creates missing ones
   */
  @Cron('0 6 * * *', {
    name: 'verify_daily_tasks_delivery',
    timeZone: 'Asia/Tashkent',
  })
  async verifyAndFixMissedDeliveries() {
    const lockKey = 'cron:daily-tasks:verification';
    const lockTTL = 1800; // 30 minutes max
    
    try {
      const lockAcquired = await this.redis.set(lockKey, Date.now().toString(), 'EX', lockTTL, 'NX');
      
      if (!lockAcquired) {
        this.logger.warn('Task verification already running, skipping');
        return;
      }

      this.logger.log('Starting daily tasks verification...');

      const now = new Date();
      const today = this.getTashkentMidnight();

      // Find all paid users who should have tasks
      const paidUsers = await this.userModel
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
        })
        .select('_id')
        .lean();

      const paidUserIds = paidUsers.map(u => u._id);

      // Find users who already have tasks today
      const usersWithTasks = await this.dailyTaskModel
        .find({
          userId: { $in: paidUserIds },
          date: today,
        })
        .distinct('userId');

      // Find users WITHOUT tasks (missed deliveries)
      const missedUserIds = paidUserIds.filter(
        id => !usersWithTasks.some(taskUserId => taskUserId.toString() === id.toString())
      );

      this.logger.log(
        `Verification: ${paidUserIds.length} total, ${usersWithTasks.length} delivered, ${missedUserIds.length} missed`
      );

      if (missedUserIds.length === 0) {
        this.logger.log('No missed deliveries found');
        return;
      }

      // Process missed users in batches
      let fixed = 0;
      let failed = 0;
      const BATCH_SIZE = 50;

      for (let i = 0; i < missedUserIds.length; i += BATCH_SIZE) {
        const batch = missedUserIds.slice(i, i + BATCH_SIZE);
        
        const missedUsers = await this.userModel
          .find({ _id: { $in: batch } })
          .select('_id telegramId profile')
          .lean();

        for (const user of missedUsers) {
          try {
            const position = user.profile?.position || 'junior';
            const tasks = [
              { question: this.generateQuestion(position, 'technical'), completed: false },
              { question: this.generateQuestion(position, 'behavioral'), completed: false },
              { question: this.generateQuestion(position, 'system_design'), completed: false },
            ];

            await this.dailyTaskModel.create({
              userId: user._id,
              date: today,
              tasks,
              status: 'pending',
            });

            // Send notification
            try {
              const bot = this.telegramService.getBot();
              if (bot && user.telegramId) {
                await bot.api.sendMessage(
                  user.telegramId,
                  '🎯 Your daily tasks are ready! Use /tasks to see them.',
                );
              }
            } catch (sendError: any) {
              this.logger.warn(`Failed to notify user ${user._id} during verification`);
            }

            fixed++;
            await this.delay(200);
          } catch (error: any) {
            this.logger.error(`Failed to fix missed delivery for user ${user._id}: ${error.message}`);
            failed++;
          }
        }
      }

      this.logger.log(`Verification completed: ${fixed} fixed, ${failed} failed`);
    } catch (error: any) {
      this.logger.error(`Verification job failed: ${error.message}`);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release verification lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Mark expired tasks
   * Runs daily to mark tasks from previous days as expired
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'mark_expired_tasks',
    timeZone: 'Asia/Tashkent',
  })
  async markExpiredTasks() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const result = await this.dailyTaskModel.updateMany(
        {
          date: { $lt: yesterday },
          status: 'pending',
        },
        {
          $set: { status: 'expired' },
        },
      );

      this.logger.log(`Marked ${result.modifiedCount} tasks as expired`);

      // Reset streak for users who missed yesterday's tasks
      const users = await this.userModel
        .find({
          'dailyTasks.currentStreak': { $gt: 0 },
        })
        .select('_id dailyTasks');

      for (const user of users) {
        const yesterdayTask = await this.dailyTaskModel.findOne({
          userId: user._id,
          date: yesterday,
          status: 'completed',
        });

        if (!yesterdayTask) {
          // User missed yesterday's tasks - reset streak
          await this.userModel.findByIdAndUpdate(user._id, {
            $set: { 'dailyTasks.currentStreak': 0 },
          });
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to mark expired tasks: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Get midnight in Tashkent timezone as UTC date
   * Tashkent is UTC+5, so today 00:00 Tashkent = yesterday 19:00 UTC
   * 
   * CRITICAL: This ensures date field matches across all services
   */
  private getTashkentMidnight(): Date {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);
    // Subtract 5 hours to convert Tashkent midnight to UTC
    midnight.setUTCHours(midnight.getUTCHours() - 5);
    return midnight;
  }

  /**
   * Generate a question based on position and type
   * TODO: Enhance with AI generation or database lookup
   */
  private generateQuestion(
    position: string,
    type: 'technical' | 'behavioral' | 'system_design',
  ): string {
    const questions: Record<string, Record<string, string[]>> = {
      technical: {
        junior: [
          'What is the difference between let, const, and var in JavaScript?',
          'Explain what a REST API is and give an example.',
          'What is the purpose of Git and how do you use branches?',
        ],
        middle: [
          'Explain the Event Loop in Node.js and how it handles asynchronous operations.',
          'What are React Hooks and why are they useful?',
          'Describe the SOLID principles in software development.',
        ],
        senior: [
          'How would you design a scalable microservices architecture?',
          'Explain database sharding and when you would use it.',
          'Describe your approach to implementing CI/CD pipelines.',
        ],
        lead: [
          'How do you balance technical debt with feature delivery?',
          'Describe your approach to mentoring junior developers.',
          'How do you evaluate and introduce new technologies to a team?',
        ],
      },
      behavioral: {
        junior: [
          'Tell me about a time you learned a new technology quickly.',
          'How do you handle feedback on your code?',
          'Describe a challenging bug you fixed recently.',
        ],
        middle: [
          'Tell me about a time you had to make a difficult technical decision.',
          'How do you prioritize tasks when you have multiple deadlines?',
          'Describe a situation where you helped a teammate solve a problem.',
        ],
        senior: [
          'Tell me about a time you led a technical project from start to finish.',
          'How do you handle disagreements with other senior engineers?',
          'Describe your approach to technical documentation and knowledge sharing.',
        ],
        lead: [
          'How do you build and maintain a high-performing engineering team?',
          'Describe a time you had to make a strategic technical decision.',
          'How do you balance hands-on coding with leadership responsibilities?',
        ],
      },
      system_design: {
        junior: [
          'How would you design a simple TODO list application?',
          'Explain how you would structure a basic e-commerce website.',
          'What considerations would you have for building a blog platform?',
        ],
        middle: [
          'Design a URL shortener service like bit.ly.',
          'How would you build a real-time chat application?',
          'Design a notification system for a mobile app.',
        ],
        senior: [
          'Design a distributed caching system.',
          'How would you build a video streaming platform like Netflix?',
          'Design a rate limiting system for an API.',
        ],
        lead: [
          'Design the architecture for a global-scale social media platform.',
          'How would you architect a multi-region deployment with zero downtime?',
          'Design a monitoring and alerting system for a large-scale distributed system.',
        ],
      },
    };

    const positionQuestions = questions[type][position] || questions[type]['junior'];
    return positionQuestions[Math.floor(Math.random() * positionQuestions.length)];
  }
}
