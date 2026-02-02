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
import { createOpenAIClient, OPENROUTER_MODELS } from '@common/utils/openai-client.factory';
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
    // Initialize OpenAI/OpenRouter client
    this.openai = createOpenAIClient(this.configService);

    if (this.openai) {
      this.logger.log('OpenAI/OpenRouter client initialized for daily tasks');
    } else {
      this.logger.warn(
        'No OpenAI/OpenRouter API key found. Daily task scoring will use basic scoring only.',
      );
    }
  }

  /**
   * Deliver daily tasks at 9 AM Tashkent time (UTC+5)
   * 9 AM Tashkent = 4 AM UTC
   * Cron: 0 4 * * * (every day at 4 AM UTC)
   * 🛡 FIX #10: Remove timeZone to use UTC correctly
   *
   * SCALABILITY FIX: Batch processing for 1M+ users
   * - Process users in batches of 100
   * - Cursor-based pagination to avoid memory overflow
   * - Progress tracking in Redis
   */
  @Cron('0 4 * * *', {
    // 4 AM UTC = 9 AM Tashkent
    name: 'deliver_daily_tasks',
  })
  async deliverDailyTasks() {
    // CRITICAL FIX: Distributed lock to prevent duplicate task delivery
    // in multi-instance deployments (horizontal scaling)
    const lockKey = 'cron:daily-tasks:delivery';
    const lockTTL = 3600; // 1 hour max execution time (for 1M+ users)

    try {
      // Acquire lock (NX = only set if not exists)
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

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
          `Processing batch: ${userBatch.length} users (progress: ${successCount + errorCount + skippedCount}/${totalUsers})`,
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

              this.logger.warn(`Failed to send notification to user ${user._id}: ${errorMessage}`);

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
      this.logger.error(`Failed to deliver daily tasks: ${error.message}`, error.stack);
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
   * PUBLIC METHOD: Get Tashkent midnight
   * Exposed for other services to use consistent timezone handling
   * 
   * SENIOR PATTERN: Centralize timezone logic in one place
   */
  public getTashkentMidnightPublic(): Date {
    return this.getTashkentMidnight();
  }

  /**
   * Get today's tasks for a user
   * 
   * CRITICAL FIX: Remove broken date conversion logic
   * Expect caller to provide proper Tashkent midnight date
   */
  async getTodayTasks(userId: string, date?: Date): Promise<DailyTaskDocument | null> {
    // Use provided date or get Tashkent midnight
    const today = date || this.getTashkentMidnight();

    this.logger.debug(
      `getTodayTasks - userId: ${userId}, date: ${today.toISOString()}, UTC: ${today.toUTCString()}`,
    );

    // CRITICAL FIX: Convert string userId to ObjectId for MongoDB
    const mongoose = require('mongoose');
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const result = await this.dailyTaskModel.findOne({
      userId: userObjectId, // ✅ ObjectId matching
      date: today,
    });

    if (!result) {
      this.logger.warn(
        `No tasks found for user ${userId} on date ${today.toISOString()} (Tashkent midnight)`,
      );
    } else {
      this.logger.debug(
        `Found tasks for user ${userId}: ${result.tasks.length} tasks, ${result.tasks.filter((t) => !t.completed).length} incomplete`,
      );
    }

    return result;
  }

  /**
   * Get monthly statistics for user's daily tasks
   * Aggregates completed, failed, AI-answered, and skipped tasks for current month
   * Returns streak information from user document
   * 
   * CRITICAL FIX: Convert string userId to ObjectId for MongoDB matching
   * SENIOR PATTERN: Proper error handling with fallback values
   */
  async getMonthlyStats(
    userId: string,
    month?: number,
    year?: number,
  ): Promise<{
    totalTasks: number;
    completed: number;
    failed: number;
    aiAnswered: number;
    skipped: number;
    averageScore: number;
    currentStreak: number;
    longestStreak: number;
    completionRate: number;
  }> {
    try {
      // CRITICAL FIX: Convert string to ObjectId for MongoDB
      const mongoose = require('mongoose');
      const userObjectId = new mongoose.Types.ObjectId(userId);

      // Default to current month/year
      const now = new Date();
      const targetMonth = month !== undefined ? month : now.getMonth();
      const targetYear = year !== undefined ? year : now.getFullYear();

      // Calculate start and end dates for the month (Tashkent timezone)
      const startDate = new Date(Date.UTC(targetYear, targetMonth, 1));
      startDate.setUTCHours(startDate.getUTCHours() - 5); // Tashkent offset

      const endDate = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999));
      endDate.setUTCHours(endDate.getUTCHours() - 5); // Tashkent offset

      this.logger.debug(
        `Getting monthly stats for user ${userId}: ${targetMonth + 1}/${targetYear} (${startDate.toISOString()} - ${endDate.toISOString()})`,
      );

      // CRITICAL FIX: Use ObjectId in $match, not string
      const stats = await this.dailyTaskModel.aggregate([
        {
          $match: {
            userId: userObjectId, // ✅ ObjectId matching
            date: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $unwind: '$tasks',
        },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            completed: {
              $sum: {
                $cond: [{ $eq: ['$tasks.completed', true] }, 1, 0],
              },
            },
            totalScore: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$tasks.completed', true] }, { $ifNull: ['$tasks.score', false] }] },
                  '$tasks.score',
                  0,
                ],
              },
            },
            scoredTasks: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$tasks.completed', true] }, { $ifNull: ['$tasks.score', false] }] },
                  1,
                  0,
                ],
              },
            },
            // Count different answer types
            voiceAnswers: {
              $sum: {
                $cond: [{ $eq: ['$tasks.answerType', 'voice'] }, 1, 0],
              },
            },
            imageAnswers: {
              $sum: {
                $cond: [{ $eq: ['$tasks.answerType', 'image'] }, 1, 0],
              },
            },
          },
        },
      ]);

      const aggregatedStats = stats[0] || {
        totalTasks: 0,
        completed: 0,
        totalScore: 0,
        scoredTasks: 0,
        voiceAnswers: 0,
        imageAnswers: 0,
      };

      this.logger.debug(
        `Aggregation result for user ${userId}: totalTasks=${aggregatedStats.totalTasks}, completed=${aggregatedStats.completed}`,
      );

      // SENIOR PATTERN: Fetch user with proper ObjectId
      const user = await this.userModel.findById(userObjectId).select('dailyTasks').lean();
      
      if (!user) {
        this.logger.warn(`User ${userId} not found in getMonthlyStats - using zero streaks`);
      }
      
      const currentStreak = user?.dailyTasks?.currentStreak || 0;
      const longestStreak = user?.dailyTasks?.longestStreak || 0;

      // Calculate derived stats
      const completed = aggregatedStats.completed;
      const totalTasks = aggregatedStats.totalTasks;
      const failed = totalTasks - completed; // Tasks exist but not completed
      const skipped = 0; // Can be calculated if we track skipped status separately
      const aiAnswered = aggregatedStats.voiceAnswers + aggregatedStats.imageAnswers; // AI-processed answers

      // SENIOR PATTERN: Safe division with proper rounding
      const averageScore =
        aggregatedStats.scoredTasks > 0
          ? Math.round((aggregatedStats.totalScore / aggregatedStats.scoredTasks) * 10) / 10
          : 0;

      const completionRate = totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;

      const result = {
        totalTasks,
        completed,
        failed,
        aiAnswered,
        skipped,
        averageScore,
        currentStreak,
        longestStreak,
        completionRate,
      };

      this.logger.log(
        `Monthly stats computed for user ${userId}: ${completed}/${totalTasks} (${completionRate}%), streak: ${currentStreak}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(
        `Failed to get monthly stats for user ${userId}: ${error.message}`,
        error.stack,
      );
      
      // SENIOR PATTERN: Return empty stats on error, don't crash the user flow
      return {
        totalTasks: 0,
        completed: 0,
        failed: 0,
        aiAnswered: 0,
        skipped: 0,
        averageScore: 0,
        currentStreak: 0,
        longestStreak: 0,
        completionRate: 0,
      };
    }
  }

  /**
   * Complete a task with AI scoring
   * ✅ Supports multimodal answers (voice/image) with plan enforcement
   * ❌ VIDEO NOT SUPPORTED - Too expensive for AI processing
   * 🛡 FIXED: TRUE atomic completion with versioning to prevent race conditions
   */
  async completeTask(
    userId: string,
    taskDate: Date,
    taskIndex: number,
    answer:
      | string
      | {
          type: 'text' | 'voice' | 'image'; // ❌ NO VIDEO
          content: string; // Text content or transcript
          audioUrl?: string; // For voice
          imageUrl?: string; // For image
          transcript?: string; // STT result for voice
        },
  ): Promise<{ score: number; feedback: string; allCompleted: boolean }> {
    // 🛡 FIX #11: Use UTC timezone for consistency
    const today = new Date(taskDate);
    today.setUTCHours(0, 0, 0, 0);

    // 🛡 FIX #15: Validate answer input (Security - prevent DOS attacks)
    const MAX_ANSWER_LENGTH = 10000;

    // ✅ Handle both string (legacy) and object (multimodal) answer formats
    let answerText: string;
    let answerType: 'text' | 'voice' | 'image' = 'text'; // ❌ NO VIDEO
    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    let transcript: string | undefined;

    // 🛡 FIX #14: Fetch user once (avoid duplicate queries)
    const user = await this.userModel.findById(userId).select('subscription');
    const userPlan: string = user?.subscription?.plan || 'free_trial';

    if (typeof answer === 'string') {
      // Legacy format: plain text
      answerText = answer.trim();
    } else {
      // New multimodal format
      answerType = answer.type;
      answerText = (answer.content || answer.transcript || '').trim();
      audioUrl = answer.audioUrl;
      imageUrl = answer.imageUrl;
      transcript = answer.transcript;

      // ❌ VIDEO IS NEVER ALLOWED - Reject if user tries to send video via any means
      if ((answer as any).videoUrl || (answer as any).type === 'video') {
        throw new ForbiddenException(
          `Video answers are not supported. ` +
            `AI video processing is too expensive. ` +
            `Please use text, voice, or image answers instead.`,
        );
      }

      if (answerType === 'voice' && !canUseDailyTaskVoiceAnswer(userPlan)) {
        throw new ForbiddenException(
          `Voice answers for daily tasks require Starter plan or higher. ` +
            `Current plan: ${userPlan}. Upgrade to use voice answers.`,
        );
      }

      if (answerType === 'image' && !canUseDailyTaskImageAnswer(userPlan)) {
        throw new ForbiddenException(
          `Image answers for daily tasks require Starter plan or higher. ` +
            `Current plan: ${userPlan}. Upgrade to use image answers.`,
        );
      }

      this.logger.log(
        `Processing ${answerType} answer for task ${taskIndex}, user ${userId}, plan ${userPlan}`,
      );
    }

    // 🛡 FIX #15: Validate answer length
    if (!answerText || answerText.length === 0) {
      throw new Error('Answer cannot be empty');
    }
    if (answerText.length > MAX_ANSWER_LENGTH) {
      throw new Error(`Answer too long. Maximum ${MAX_ANSWER_LENGTH} characters allowed.`);
    }
    if (answerText.length < 10) {
      throw new Error(
        'Answer too short. Please provide a meaningful response (at least 10 characters).',
      );
    }

    // 🛡 FIX #1: ATOMIC operation - fetch task to get question for scoring
    const taskDoc = await this.dailyTaskModel.findOne({
      userId,
      date: today,
      [`tasks.${taskIndex}.completed`]: false, // Only if not completed
    });

    if (!taskDoc) {
      throw new Error('Daily task not found or already completed');
    }

    if (taskIndex < 0 || taskIndex >= taskDoc.tasks.length) {
      throw new Error('Invalid task index');
    }

    const task = taskDoc.tasks[taskIndex];

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

    // 🛡 FIX #1: TRUE ATOMIC UPDATE using findOneAndUpdate
    const updateFields: any = {
      [`tasks.${taskIndex}.completed`]: true,
      [`tasks.${taskIndex}.answer`]: answerText,
      [`tasks.${taskIndex}.answerType`]: answerType,
      [`tasks.${taskIndex}.score`]: score,
      [`tasks.${taskIndex}.feedback`]: feedback,
      [`tasks.${taskIndex}.completedAt`]: new Date(),
    };

    if (audioUrl) updateFields[`tasks.${taskIndex}.audioUrl`] = audioUrl;
    if (imageUrl) updateFields[`tasks.${taskIndex}.imageUrl`] = imageUrl;
    if (transcript) updateFields[`tasks.${taskIndex}.transcript`] = transcript;

    const updatedTask = await this.dailyTaskModel.findOneAndUpdate(
      {
        userId,
        date: today,
        [`tasks.${taskIndex}.completed`]: false, // 🛡 Only update if not completed
      },
      {
        $set: updateFields,
      },
      { new: true },
    );

    if (!updatedTask) {
      throw new Error('Task was already completed by another request');
    }

    // Check if all tasks completed
    const allCompleted = updatedTask.tasks.every((t) => t.completed);

    if (allCompleted) {
      // Mark as completed
      await this.dailyTaskModel.findOneAndUpdate(
        { _id: updatedTask._id },
        { $set: { status: 'completed' } },
      );

      // 🛡 FIX #2: ATOMIC streak update using $inc
      await this.userModel.findByIdAndUpdate(userId, {
        $inc: {
          'dailyTasks.currentStreak': 1,
          'dailyTasks.totalCompleted': 1,
        },
      });

      // Update longest streak separately (need to read current value)
      const updatedUser = await this.userModel.findById(userId).select('dailyTasks');
      if (updatedUser) {
        const currentStreak = updatedUser.dailyTasks?.currentStreak || 0;
        const currentLongest = updatedUser.dailyTasks?.longestStreak || 0;

        if (currentStreak > currentLongest) {
          await this.userModel.findByIdAndUpdate(userId, {
            $set: { 'dailyTasks.longestStreak': currentStreak },
          });
        }
      }
    }

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
  private scoreAnswerBasic(question: string, answer: string): { score: number; feedback: string } {
    const answerLower = answer.toLowerCase();
    const questionLower = question.toLowerCase();

    // Extract key terms from question (simple approach)
    const keywords = this.extractKeywords(questionLower);
    const matchedKeywords = keywords.filter((kw) => answerLower.includes(kw));
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
      feedback =
        'Answer needs improvement. Review the question and provide a more complete response.';
    }

    return { score, feedback };
  }

  /**
   * Extract simple keywords from a question
   */
  private extractKeywords(text: string): string[] {
    const stopWords = [
      'what',
      'is',
      'the',
      'a',
      'an',
      'how',
      'do',
      'you',
      'are',
      'can',
      'could',
      'would',
      'should',
      'when',
      'why',
      'where',
      'which',
      'tell',
      'me',
      'about',
      'and',
      'or',
      'to',
      'in',
      'of',
      'for',
      'with',
      'on',
      'at',
      'by',
      'your',
      'that',
      'this',
    ];
    return text
      .split(/\s+/)
      .filter((word) => word.length > 3 && !stopWords.includes(word))
      .slice(0, 10); // Max 10 keywords
  }

  /**
   * Advanced scoring (STARTER plan) - Gemini 2.5 Flash Lite with concise prompt
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
      const response = await this.openai.chat.completions.create({
        model: OPENROUTER_MODELS['gemini-2.5-flash-lite'],
        messages: [
          {
            role: 'system',
            content: 'You are an expert interview coach. Always respond with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 150,
      });

      const responseText =
        response.choices[0]?.message?.content || '{"score": 5, "feedback": "Reviewed."}';
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[^}]+\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : '{"score": 5, "feedback": "Reviewed."}');

      return {
        score: Math.min(10, Math.max(0, result.score || 5)),
        feedback: result.feedback || 'Keep practicing!',
      };
    } catch (error: any) {
      this.logger.error(`Advanced scoring with OpenRouter failed: ${error.message}`);
      return this.scoreAnswerBasic(question, answer);
    }
  }

  /**
   * AI-Powered scoring (PRO/ELITE) - Gemini 2.5 Flash with detailed analysis
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
      const response = await this.openai.chat.completions.create({
        model: OPENROUTER_MODELS['gemini-2.5-flash'],
        messages: [
          {
            role: 'system',
            content: 'You are an expert interview coach. Always respond with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const responseText = response.choices[0]?.message?.content || '{}';
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

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
      this.logger.error(`AI-powered scoring with OpenRouter failed: ${error.message}`);
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
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

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

      const paidUserIds = paidUsers.map((u) => u._id);

      // Find users who already have tasks today
      const usersWithTasks = await this.dailyTaskModel
        .find({
          userId: { $in: paidUserIds },
          date: today,
        })
        .distinct('userId');

      // 🛡 FIX #8: Optimize O(n*m) to O(n) using Set for O(1) lookup
      const usersWithTasksSet = new Set(usersWithTasks.map((id) => id.toString()));
      const missedUserIds = paidUserIds.filter((id) => !usersWithTasksSet.has(id.toString()));

      this.logger.log(
        `Verification: ${paidUserIds.length} total, ${usersWithTasks.length} delivered, ${missedUserIds.length} missed`,
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
            this.logger.error(
              `Failed to fix missed delivery for user ${user._id}: ${error.message}`,
            );
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
   * 🛡 FIX #13: Optimized N+1 query with batch processing
   * 🛡 FIX #17: Fixed date comparison logic ($lte instead of $lt)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'mark_expired_tasks',
    timeZone: 'Asia/Tashkent',
  })
  async markExpiredTasks() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setUTCHours(0, 0, 0, 0);

      // 🛡 FIX #17: Use $lte to include yesterday's tasks
      const result = await this.dailyTaskModel.updateMany(
        {
          date: { $lte: yesterday },
          status: 'pending',
        },
        {
          $set: { status: 'expired' },
        },
      );

      this.logger.log(`Marked ${result.modifiedCount} tasks as expired`);

      // 🛡 FIX #13: Optimized streak reset - batch query instead of N+1
      const users = await this.userModel
        .find({
          'dailyTasks.currentStreak': { $gt: 0 },
        })
        .select('_id dailyTasks');

      if (users.length === 0) {
        this.logger.log('No users with active streaks to check');
        return;
      }

      // Batch fetch all yesterday's completed tasks
      const userIds = users.map((u) => u._id);
      const completedTasks = await this.dailyTaskModel
        .find({
          userId: { $in: userIds },
          date: yesterday,
          status: 'completed',
        })
        .select('userId');

      // Create Set for O(1) lookup
      const completedUserIds = new Set(completedTasks.map((t) => t.userId.toString()));

      // Find users who missed yesterday
      const usersToReset = users.filter((u: any) => !completedUserIds.has(u._id.toString()));

      if (usersToReset.length > 0) {
        // Batch reset streaks
        await this.userModel.updateMany(
          { _id: { $in: usersToReset.map((u) => u._id) } },
          { $set: { 'dailyTasks.currentStreak': 0 } },
        );

        this.logger.log(
          `Reset streaks for ${usersToReset.length} users who missed yesterday's tasks`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to mark expired tasks: ${error.message}`, error.stack);
    }
  }

  /**
   * Get midnight in Tashkent timezone as UTC date
   * Tashkent is UTC+5, so today 00:00 Tashkent = yesterday 19:00 UTC
   *
   * CRITICAL: This ensures date field matches across all services
   * 🛡 FIX #12: Correct logic for Tashkent midnight calculation
   */
  private getTashkentMidnight(): Date {
    const now = new Date();
    // Convert to Tashkent time (UTC+5)
    const tashkentTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    // Set to midnight in Tashkent
    tashkentTime.setUTCHours(0, 0, 0, 0);
    // Convert back to UTC (subtract 5 hours)
    return new Date(tashkentTime.getTime() - 5 * 60 * 60 * 1000);
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

  /**
   * Helper method to introduce a delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
