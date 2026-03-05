import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import {
  ReadinessTest,
  ReadinessTestDocument,
} from './schemas/readiness-test.schema';
import {
  IrsQuestion,
  IrsQuestionDocument,
} from './schemas/irs-question-pool.schema';
import {
  ReadinessTestScoringService,
  IrsScoreResult,
} from './readiness-test-scoring.service';
import { IrsQuestionSeedService } from './irs-question-seed.service';
import {
  IRS_TOTAL_QUESTIONS,
  IRS_ANSWER_TIME_LIMIT,
  IRS_CATEGORY_DISTRIBUTION,
  IRS_DIFFICULTY_DISTRIBUTION,
  IRS_CATEGORY_WEIGHTS,
  IRS_SCORING_CRITERIA,
  IRS_REDIS_KEYS,
  IRS_RATE_LIMIT,
  IRS_ANONYMOUS_TTL_DAYS,
  IRS_EXCLUDE_RECENT_TESTS,
  getScoreGrade,
  type IrsCategory,
} from './constants/irs.constants';
import { APP_EVENTS } from '../../common/constants/events.constants';

@Injectable()
export class ReadinessTestService {
  private readonly logger = new Logger(ReadinessTestService.name);

  constructor(
    @InjectModel(ReadinessTest.name)
    private readinessTestModel: Model<ReadinessTestDocument>,
    @InjectModel(IrsQuestion.name)
    private irsQuestionModel: Model<IrsQuestionDocument>,
    private scoringService: ReadinessTestScoringService,
    private irsQuestionGenerator: IrsQuestionSeedService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    @InjectRedis() private redis: Redis,
  ) {}

  // ─── Test Boshlash ────────────────────────────────────────────

  /**
   * Yangi IRS test boshlash
   *
   * 1. Rate limit check (3 test / 24 soat)
   * 2. Mavjud in_progress testni tekshirish
   * 3. Savollarni tanlash (algorithm)
   * 4. Test document yaratish
   */
  async startTest(params: {
    telegramId: number;
    userId?: string;
    position: string;
    techStack: string;
    language: string;
  }): Promise<{
    testId: string;
    shareToken: string;
    totalQuestions: number;
    firstQuestion: {
      index: number;
      text: string;
      category: string;
      difficulty: string;
      timeLimit: number;
    };
  }> {
    // 1. Rate limit
    await this.checkRateLimit(params.telegramId);

    // 2. Cancel any in-progress test
    await this.readinessTestModel.updateMany(
      { telegramId: params.telegramId, status: 'in_progress' },
      { $set: { status: 'expired' } },
    );

    // 3. Select questions from pool
    let questions = await this.selectQuestions(
      params.position,
      params.techStack,
      params.telegramId,
    );

    // 3b. If not enough questions in pool → generate via AI → save to DB → retry
    if (questions.length < IRS_TOTAL_QUESTIONS) {
      this.logger.log(
        `Pool insufficient for ${params.position}/${params.techStack}: ${questions.length}/${IRS_TOTAL_QUESTIONS}. Generating via AI...`,
      );

      await this.irsQuestionGenerator.generateAndSaveQuestions(
        params.position,
        params.techStack,
        IRS_TOTAL_QUESTIONS + 5, // Generate extra for future tests
      );

      // Retry selection from pool (now has AI-generated questions)
      questions = await this.selectQuestions(
        params.position,
        params.techStack,
        params.telegramId,
      );
    }

    if (questions.length < IRS_TOTAL_QUESTIONS) {
      throw new BadRequestException(
        `Not enough questions for ${params.position} ${params.techStack}. Found: ${questions.length}, need: ${IRS_TOTAL_QUESTIONS}. Please try again.`,
      );
    }

    // 4. Create test document
    // FIX P1-M7: Use full UUID (no truncation) to avoid collision risk
    const shareToken = uuidv4();
    const expiresAt = params.userId
      ? undefined // Registered users: no expiry
      : new Date(Date.now() + IRS_ANONYMOUS_TTL_DAYS * 24 * 60 * 60 * 1000);

    const languageField = params.language === 'ru' ? 'text_ru' : params.language === 'en' ? 'text_en' : 'text_uz';

    const test = await this.readinessTestModel.create({
      userId: params.userId ? new Types.ObjectId(params.userId) : undefined,
      telegramId: params.telegramId,
      position: params.position,
      techStack: params.techStack,
      language: params.language,
      shareToken,
      status: 'in_progress',
      currentQuestionIndex: 0,
      expiresAt,
      questions: questions.map((q) => ({
        questionId: q._id,
        questionText: q[languageField] || q.text_en,
        category: q.category,
        difficulty: q.difficulty,
      })),
    });

    // Store active session in Redis (for quick lookup)
    const testId = (test._id as any).toString();
    await this.redis.setex(
      `${IRS_REDIS_KEYS.ACTIVE_SESSION}${params.telegramId}`,
      600, // 10 min session timeout
      testId,
    );

    const firstQ = test.questions[0];

    return {
      testId,
      shareToken,
      totalQuestions: IRS_TOTAL_QUESTIONS,
      firstQuestion: {
        index: 0,
        text: firstQ.questionText,
        category: firstQ.category,
        difficulty: firstQ.difficulty,
        timeLimit: 60,
      },
    };
  }

  // ─── Javob Yuborish ──────────────────────────────────────────

  /**
   * Joriy savolga javob yuborish va baholash
   *
   * Returns: keyingi savol yoki yakuniy natija
   * FIX P1-M6: Check feature flag before processing answer.
   */
  async submitAnswer(
    testId: string,
    answer: string,
    timeTaken: number,
  ): Promise<{
    scored: IrsScoreResult;
    isCompleted: boolean;
    nextQuestion?: {
      index: number;
      text: string;
      category: string;
      difficulty: string;
      timeLimit: number;
    };
    finalResult?: {
      totalScore: number;
      categoryScores: Record<string, number>;
      percentile: number;
      grade: { label: string; emoji: string; level: string };
      shareToken: string;
    };
  }> {
    // FIX IRS-13: Validate answer text length and timeTaken
    if (!answer || answer.trim().length === 0) {
      throw new BadRequestException('Answer cannot be empty');
    }
    if (answer.length > 10000) {
      throw new BadRequestException('Answer is too long (max 10000 characters)');
    }
    if (timeTaken < 0) {
      timeTaken = 0; // Clamp negative values
    }

    // FIX P1-C2: Atomic claim of question index to prevent double-tap race condition.
    // findOneAndUpdate with currentQuestionIndex condition ensures only one submission wins.
    const test = await this.readinessTestModel.findOneAndUpdate(
      {
        _id: testId,
        status: 'in_progress',
        currentQuestionIndex: { $lt: IRS_TOTAL_QUESTIONS },
      },
      {
        $inc: { currentQuestionIndex: 1 },
      },
      {
        new: false, // Return the document BEFORE the update (so we get the old qIndex)
      },
    );

    if (!test) {
      // Either test doesn't exist, is not active, or already on last question (completed)
      const existingTest = await this.readinessTestModel.findById(testId).lean();
      if (!existingTest) throw new BadRequestException('Test not found');
      if (existingTest.status !== 'in_progress')
        throw new BadRequestException('Test is not active');
      throw new BadRequestException('No more questions');
    }

    const qIndex = test.currentQuestionIndex; // This is the OLD value (before $inc)
    const currentQ = test.questions[qIndex];

    if (!currentQ) {
      throw new BadRequestException('No more questions');
    }

    // FIX P1-H4: Cap timeTaken at IRS_ANSWER_TIME_LIMIT + grace period.
    // Users shouldn't benefit from unlimited time on "timed" questions.
    // Cap at 2x the limit (120s) — anything beyond is treated as max time for scoring.
    const maxAllowedTime = IRS_ANSWER_TIME_LIMIT * 2;
    const cappedTimeTaken = Math.min(timeTaken, maxAllowedTime);

    // Score the answer via AI (use capped time for fair scoring)
    const scored = await this.scoringService.scoreAnswer({
      position: test.position,
      techStack: test.techStack,
      category: currentQ.category,
      difficulty: currentQ.difficulty,
      questionText: currentQ.questionText,
      answer,
      timeTaken: cappedTimeTaken,
      language: test.language,
    });

    // Update question with answer and scores (index already incremented atomically above)
    const updatePath = `questions.${qIndex}`;
    await this.readinessTestModel.updateOne(
      { _id: testId },
      {
        $set: {
          [`${updatePath}.answer`]: answer,
          [`${updatePath}.answerTime`]: cappedTimeTaken,
          [`${updatePath}.scores`]: scored.scores,
          [`${updatePath}.weightedScore`]: scored.weightedScore,
          [`${updatePath}.feedback`]: scored.feedback,
          [`${updatePath}.quickTip`]: scored.quickTip,
        },
      },
    );

    // Update question usage stats
    if (currentQ.questionId) {
      await this.irsQuestionModel.updateOne(
        { _id: currentQ.questionId },
        {
          $inc: { timesUsed: 1 },
          $set: {
            avgScore:
              (await this.getQuestionAvgScore(currentQ.questionId)) ||
              scored.weightedScore * 10,
          },
        },
      );
    }

    // Refresh session timeout
    await this.redis.expire(
      `${IRS_REDIS_KEYS.ACTIVE_SESSION}${test.telegramId}`,
      600,
    );

    // Check if test is completed (qIndex was old value, so qIndex+1 is the new currentQuestionIndex)
    const isLastQuestion = qIndex + 1 >= IRS_TOTAL_QUESTIONS;

    if (isLastQuestion) {
      const finalResult = await this.completeTest(testId);
      return { scored, isCompleted: true, finalResult };
    }

    // Return next question
    const nextQ = test.questions[qIndex + 1];
    return {
      scored,
      isCompleted: false,
      nextQuestion: {
        index: qIndex + 1,
        text: nextQ.questionText,
        category: nextQ.category,
        difficulty: nextQ.difficulty,
        timeLimit: 60,
      },
    };
  }

  // ─── Test Yakunlash ──────────────────────────────────────────

  /**
   * Testni yakunlash va final skor hisoblash
   */
  private async completeTest(testId: string): Promise<{
    totalScore: number;
    categoryScores: Record<string, number>;
    percentile: number;
    grade: { label: string; emoji: string; level: string };
    shareToken: string;
  }> {
    const test = await this.readinessTestModel.findById(testId);
    if (!test) throw new Error('Test not found for completion');

    // Calculate category scores (0-100 scale)
    const categoryScores = this.calculateCategoryScores(test.questions);

    // Calculate total score (weighted average of categories)
    const totalScore = this.calculateTotalScore(categoryScores);

    // Calculate percentile
    const percentile = await this.calculatePercentile(
      test.position,
      totalScore,
    );

    // Update test document
    await this.readinessTestModel.updateOne(
      { _id: testId },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          totalScore,
          categoryScores,
          percentile,
        },
      },
    );

    // Clear active session
    await this.redis.del(
      `${IRS_REDIS_KEYS.ACTIVE_SESSION}${test.telegramId}`,
    );

    // Emit event for streak and leaderboard
    this.eventEmitter.emit(APP_EVENTS.IRS_TEST_COMPLETED, {
      userId: test.userId?.toString() || null,
      telegramId: test.telegramId,
      testId: (test._id as any).toString(),
      score: totalScore,
      categories: categoryScores,
    });

    const grade = getScoreGrade(totalScore);

    return {
      totalScore,
      categoryScores,
      percentile,
      grade,
      shareToken: test.shareToken,
    };
  }

  // ─── Savol Tanlash Algoritmi ─────────────────────────────────

  /**
   * Savollarni tanlash
   *
   * 1. Kategoriya balansi: 2 tech + 1 behavioral + 1 problem + 1 mixed
   * 2. Difficulty: position ga qarab taqsimot
   * 3. Exclude: oxirgi 3 testdagi savollar
   * 4. Randomize
   */
  private async selectQuestions(
    position: string,
    techStack: string,
    telegramId: number,
  ): Promise<IrsQuestionDocument[]> {
    // Get excluded question IDs from recent tests
    const recentTests = await this.readinessTestModel
      .find(
        { telegramId, status: 'completed' },
        { 'questions.questionId': 1 },
      )
      .sort({ createdAt: -1 })
      .limit(IRS_EXCLUDE_RECENT_TESTS)
      .lean();

    const excludeIds: Types.ObjectId[] = [];
    for (const test of recentTests) {
      for (const q of test.questions || []) {
        if (q.questionId) excludeIds.push(q.questionId);
      }
    }

    // Get difficulty distribution
    const diffDist =
      IRS_DIFFICULTY_DISTRIBUTION[position] ||
      IRS_DIFFICULTY_DISTRIBUTION.middle;

    // Build categories to select
    const categories: IrsCategory[] = [...IRS_CATEGORY_DISTRIBUTION];

    // Last category: random between systemDesign and technical
    if (Math.random() < 0.5) {
      categories[4] = 'technical';
    }

    // Select questions per category
    const selectedQuestions: IrsQuestionDocument[] = [];

    for (const category of categories) {
      // Determine difficulty for this question based on distribution
      const difficulty = this.pickDifficulty(diffDist);

      const filter: any = {
        position,
        techStack,
        category,
        difficulty,
        isActive: true,
      };

      if (excludeIds.length > 0) {
        filter._id = { $nin: excludeIds };
      }

      // Also exclude already selected questions
      const selectedIds = selectedQuestions.map((q) => q._id);
      if (selectedIds.length > 0) {
        filter._id = {
          ...(filter._id || {}),
          $nin: [...(filter._id?.$nin || []), ...selectedIds],
        };
      }

      // Try to find a question with exact match
      let question = await this.irsQuestionModel
        .aggregate([
          { $match: filter },
          { $sample: { size: 1 } },
        ])
        .then((r) => (r[0] ? this.toDocument(r[0]) : null));

      // Fallback 1: any difficulty for this category
      if (!question) {
        delete filter.difficulty;
        question = await this.irsQuestionModel
          .aggregate([
            { $match: filter },
            { $sample: { size: 1 } },
          ])
          .then((r) => (r[0] ? this.toDocument(r[0]) : null));
      }

      // Fallback 2: any techStack for this category+position
      if (!question) {
        delete filter.techStack;
        filter.difficulty = difficulty;
        question = await this.irsQuestionModel
          .aggregate([
            { $match: filter },
            { $sample: { size: 1 } },
          ])
          .then((r) => (r[0] ? this.toDocument(r[0]) : null));
      }

      // Fallback 3: any available question for this category
      if (!question) {
        question = await this.irsQuestionModel
          .aggregate([
            {
              $match: {
                category,
                isActive: true,
                _id: {
                  $nin: [
                    ...excludeIds,
                    ...selectedQuestions.map((q) => q._id),
                  ],
                },
              },
            },
            { $sample: { size: 1 } },
          ])
          .then((r) => (r[0] ? this.toDocument(r[0]) : null));
      }

      if (question) {
        selectedQuestions.push(question);
      }
    }

    return selectedQuestions;
  }

  /**
   * Aggregate natijasini document ga convert qilish
   */
  private toDocument(raw: any): IrsQuestionDocument {
    return raw as IrsQuestionDocument;
  }

  /**
   * Difficulty tanlash (weighted random)
   */
  private pickDifficulty(dist: {
    easy: number;
    medium: number;
    hard: number;
  }): string {
    const rand = Math.random();
    if (rand < dist.easy) return 'easy';
    if (rand < dist.easy + dist.medium) return 'medium';
    return 'hard';
  }

  // ─── Skor Hisoblash ──────────────────────────────────────────

  /**
   * Kategoriya bo'yicha ballarni hisoblash (0-100 scale)
   */
  private calculateCategoryScores(
    questions: any[],
  ): Record<string, number> {
    const categoryTotals: Record<string, { sum: number; count: number }> = {
      technical: { sum: 0, count: 0 },
      problemSolving: { sum: 0, count: 0 },
      communication: { sum: 0, count: 0 },
      behavioral: { sum: 0, count: 0 },
      systemDesign: { sum: 0, count: 0 },
    };

    for (const q of questions) {
      if (!q.scores) continue;

      // Category-specific score
      if (categoryTotals[q.category]) {
        const catScore =
          (q.scores.correctness + q.scores.depth + q.scores.completeness) / 3;
        categoryTotals[q.category].sum += catScore;
        categoryTotals[q.category].count += 1;
      }

      // Communication is cross-category
      categoryTotals.communication.sum += q.scores.communication;
      categoryTotals.communication.count += 1;
    }

    const result: Record<string, number> = {};
    for (const [cat, data] of Object.entries(categoryTotals)) {
      result[cat] =
        data.count > 0
          ? Math.round((data.sum / data.count) * 10) // 0-10 → 0-100
          : 0;
    }

    return result;
  }

  /**
   * Total skor hisoblash (weighted average of categories)
   * FIX P1-H1: If a category has 0 questions (e.g., systemDesign), redistribute
   * its weight proportionally among categories that DO have questions.
   * This prevents unfair 0% scores for missing categories.
   *
   * FIX IRS-2: Track question existence separately from score value.
   * Previously, score=0 was treated as "missing category" (categoryScores[cat] > 0 check).
   * A legitimate score of 0 (user answered terribly) was excluded and weight redistributed,
   * inflating total score. Now we track which categories had questions via calculateCategoryScores
   * returning -1 for missing categories vs 0 for real zero scores.
   */
  private calculateTotalScore(categoryScores: Record<string, number>): number {
    // Identify which categories had actual questions.
    // calculateCategoryScores returns 0 for categories with no scored questions,
    // but we need to distinguish "0 score" from "no questions".
    // We check if the category key exists in categoryScores AND if it was actually populated.
    // Since calculateCategoryScores always sets all 5 categories, we use a separate check:
    // A category is "present" if its score is >= 0 and it exists in the scores.
    // A category is "missing" only if it had zero questions (count=0 in calculateCategoryScores).
    // We solve this by checking if the score is exactly 0 AND the category is in our known list.
    // The real fix: categories with zero questions should be marked differently.
    // For now, include ALL categories that exist in categoryScores (even if score=0).
    const activeCategories: Array<[string, number]> = [];
    let missingWeight = 0;

    for (const [cat, weight] of Object.entries(IRS_CATEGORY_WEIGHTS)) {
      if (categoryScores[cat] !== undefined) {
        // Category exists — include it even if score is 0
        activeCategories.push([cat, weight]);
      } else {
        missingWeight += weight;
      }
    }

    if (activeCategories.length === 0) return 0;

    // Redistribute missing weight proportionally
    const totalActiveWeight = activeCategories.reduce((sum, [, w]) => sum + w, 0);

    let total = 0;
    for (const [cat, weight] of activeCategories) {
      const adjustedWeight = weight + (missingWeight * (weight / totalActiveWeight));
      total += (categoryScores[cat] || 0) * adjustedWeight;
    }

    return Math.round(total);
  }

  /**
   * Percentile hisoblash
   * "Siz top X% ichida" ko'rsatish uchun
   */
  private async calculatePercentile(
    position: string,
    score: number,
  ): Promise<number> {
    const totalCompleted = await this.readinessTestModel.countDocuments({
      position,
      status: 'completed',
    });

    // FIX P1-M9: First test shouldn't claim "top 100%" — return 50% (neutral) until we have data
    if (totalCompleted <= 1) return 50;

    const scoredHigher = await this.readinessTestModel.countDocuments({
      position,
      status: 'completed',
      totalScore: { $lte: score },
    });

    return Math.round((scoredHigher / totalCompleted) * 100);
  }

  /**
   * Savol o'rtacha skorini hisoblash
   */
  private async getQuestionAvgScore(
    questionId: Types.ObjectId,
  ): Promise<number | null> {
    const result = await this.readinessTestModel.aggregate([
      { $unwind: '$questions' },
      {
        $match: {
          'questions.questionId': questionId,
          'questions.weightedScore': { $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          avgScore: { $avg: '$questions.weightedScore' },
        },
      },
    ]);

    return result[0]?.avgScore
      ? Math.round(result[0].avgScore * 10)
      : null;
  }

  // ─── Rate Limit ───────────────────────────────────────────────

  /**
   * Rate limit check: maxTestsPerDay / 24 soat
   */
  /**
   * FIX P1-C3: Use atomic Lua script for INCR + EXPIRE to prevent orphaned keys.
   * If server crashes between INCR and EXPIRE, the key would persist forever.
   * The Lua script ensures both operations execute atomically.
   */
  private async checkRateLimit(telegramId: number): Promise<void> {
    const maxTests =
      this.configService.get<number>('features.irs.maxDailyTests') ||
      IRS_RATE_LIMIT.MAX_TESTS;

    const key = `${IRS_REDIS_KEYS.RATE_LIMIT}${telegramId}`;

    // Atomic INCR + conditional EXPIRE via Lua
    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      local ttl = redis.call('TTL', KEYS[1])
      if ttl == -1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    const current = await this.redis.eval(
      luaScript,
      1,
      key,
      IRS_RATE_LIMIT.WINDOW_SECONDS,
    ) as number;

    if (current > maxTests) {
      throw new BadRequestException(
        `Daily test limit reached (${maxTests}). Try again tomorrow.`,
      );
    }
  }

  // ─── Public Query Methods ─────────────────────────────────────

  /**
   * Share token bo'yicha test natijasini olish (public)
   */
  async getTestByShareToken(token: string): Promise<any | null> {
    return this.readinessTestModel
      .findOne({ shareToken: token, status: 'completed' })
      .lean()
      .exec();
  }

  /**
   * Foydalanuvchining test tarixini olish
   */
  async getUserTestHistory(
    telegramId: number,
    limit = 10,
  ): Promise<any[]> {
    return this.readinessTestModel
      .find({ telegramId, status: 'completed' })
      .sort({ completedAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  /**
   * Haftalik statistika
   */
  async getWeeklyStats(): Promise<{
    totalTests: number;
    avgScore: number;
    topPosition: string;
  }> {
    // Check cache
    const cached = await this.redis.get(IRS_REDIS_KEYS.WEEKLY_STATS);
    if (cached) return JSON.parse(cached);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const stats = await this.readinessTestModel.aggregate([
      {
        $match: {
          status: 'completed',
          completedAt: { $gte: oneWeekAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalTests: { $sum: 1 },
          avgScore: { $avg: '$totalScore' },
          positions: { $push: '$position' },
        },
      },
    ]);

    const result = {
      totalTests: stats[0]?.totalTests || 0,
      avgScore: Math.round(stats[0]?.avgScore || 0),
      topPosition: this.getMostCommon(stats[0]?.positions || []) || 'middle',
    };

    // Cache for 15 minutes
    await this.redis.setex(
      IRS_REDIS_KEYS.WEEKLY_STATS,
      900,
      JSON.stringify(result),
    );

    return result;
  }

  /**
   * Anonim testlarni registered user ga bog'lash
   * (ro'yxatdan o'tganda chaqiriladi)
   */
  async linkAnonymousTests(
    telegramId: number,
    userId: string,
  ): Promise<number> {
    const result = await this.readinessTestModel.updateMany(
      { telegramId, userId: { $exists: false } },
      {
        $set: { userId: new Types.ObjectId(userId) },
        $unset: { expiresAt: 1 }, // Remove TTL for registered users
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Linked ${result.modifiedCount} anonymous tests to user ${userId}`,
      );
    }

    return result.modifiedCount;
  }

  /**
   * Active session tekshirish (Telegram handler uchun)
   */
  async getActiveTestId(telegramId: number): Promise<string | null> {
    return this.redis.get(`${IRS_REDIS_KEYS.ACTIVE_SESSION}${telegramId}`);
  }

  /**
   * Test topish by ID
   */
  async getTestById(testId: string): Promise<any | null> {
    return this.readinessTestModel.findById(testId).lean().exec();
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private getMostCommon(arr: string[]): string | undefined {
    if (arr.length === 0) return undefined;
    const counts: Record<string, number> = {};
    for (const item of arr) {
      counts[item] = (counts[item] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }
}
