import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
import { createOpenAIClient } from '@common/utils/openai-client.factory';

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
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Deliver daily tasks at 9 AM Tashkent time (UTC+5)
   * 9 AM Tashkent = 4 AM UTC
   * Cron: 0 4 * * * (every day at 4 AM UTC)
   */
  @Cron('0 4 * * *', {
    name: 'deliver_daily_tasks',
    timeZone: 'Asia/Tashkent',
  })
  async deliverDailyTasks() {
    // CRITICAL FIX: Distributed lock to prevent duplicate task delivery
    // in multi-instance deployments (horizontal scaling)
    const lockKey = 'cron:daily-tasks:delivery';
    const lockTTL = 600; // 10 minutes max execution time
    
    try {
      // Acquire lock (NX = only set if not exists)
      const lockAcquired = await this.redis.set(lockKey, Date.now().toString(), 'EX', lockTTL, 'NX');
      
      if (!lockAcquired) {
        this.logger.warn('Daily tasks cron already running on another instance, skipping');
        return;
      }
      
      this.logger.log('Starting daily tasks delivery...');

      // Get all active users (trialing or active subscription)
      const users = await this.userModel
        .find({
          'subscription.status': { $in: ['trialing', 'active'] },
          isBlocked: false,
        })
        .select('_id telegramId profile dailyTasks')
        .lean();

      this.logger.log(`Found ${users.length} eligible users for daily tasks`);

      let successCount = 0;
      let errorCount = 0;

      for (const user of users) {
        try {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          // Check if tasks already delivered today
          const existingTask = await this.dailyTaskModel.findOne({
            userId: user._id,
            date: today,
          });

          if (existingTask) {
            this.logger.debug(`Tasks already delivered for user ${user._id}`);
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
            this.logger.warn(
              `Failed to send notification to user ${user._id}: ${sendError.message}`,
            );
          }

          successCount++;
        } catch (userError: any) {
          this.logger.error(
            `Failed to deliver tasks for user ${user._id}: ${userError.message}`,
            userError.stack,
          );
          errorCount++;
        }
      }

      this.logger.log(
        `Daily tasks delivery completed. Success: ${successCount}, Errors: ${errorCount}`,
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
        this.logger.debug('Daily tasks lock released');
      } catch (lockError: any) {
        this.logger.error(`Failed to release daily tasks lock: ${lockError.message}`);
        // Lock will auto-expire after 10 minutes
      }
    }
  }

  /**
   * Get today's tasks for a user
   */
  async getTodayTasks(userId: string, date: Date): Promise<DailyTaskDocument | null> {
    const today = new Date(date);
    today.setHours(0, 0, 0, 0);

    return this.dailyTaskModel.findOne({
      userId,
      date: today,
    });
  }

  /**
   * Complete a task with AI scoring
   * Returns score and feedback
   */
  async completeTask(
    userId: string,
    taskDate: Date,
    taskIndex: number,
    answer: string,
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

    // Score answer with AI
    let score = 0;
    let feedback = 'Answer recorded.';

    if (this.openai) {
      try {
        const result = await this.scoreAnswer(task.question, answer);
        score = result.score;
        feedback = result.feedback;
      } catch (error: any) {
        this.logger.error(`Failed to score answer: ${error.message}`);
        score = 5; // Default score if AI fails
        feedback = 'Answer received but scoring unavailable. Keep practicing!';
      }
    }

    // Mark task as completed
    dailyTask.tasks[taskIndex].completed = true;
    dailyTask.tasks[taskIndex].answer = answer;
    dailyTask.tasks[taskIndex].score = score;
    dailyTask.tasks[taskIndex].completedAt = new Date();

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
   * Score an answer using AI (0-10 scale)
   */
  private async scoreAnswer(
    question: string,
    answer: string,
  ): Promise<{ score: number; feedback: string }> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const prompt = `You are an expert interview coach. Score this answer on a scale of 0-10 and provide brief feedback (max 100 words).

Question: ${question}

Candidate's Answer: ${answer}

Provide your response in JSON format:
{
  "score": <number 0-10>,
  "feedback": "<brief constructive feedback>"
}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert interview coach who provides fair, constructive feedback. Return valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{"score": 5, "feedback": "Answer received."}';
    const result = JSON.parse(responseText);

    return {
      score: Math.min(10, Math.max(0, result.score || 5)),
      feedback: result.feedback || 'Keep practicing!',
    };
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
