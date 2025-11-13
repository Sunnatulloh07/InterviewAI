import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InterviewSession, InterviewSessionDocument } from './schemas/interview-session.schema';
import { InterviewQuestion, InterviewQuestionDocument } from './schemas/interview-question.schema';
import { InterviewAnswer, InterviewAnswerDocument } from './schemas/interview-answer.schema';

@Injectable()
export class InterviewsRepository {
  private readonly logger = new Logger(InterviewsRepository.name);

  constructor(
    @InjectModel(InterviewSession.name)
    private readonly sessionModel: Model<InterviewSessionDocument>,
    @InjectModel(InterviewQuestion.name)
    private readonly questionModel: Model<InterviewQuestionDocument>,
    @InjectModel(InterviewAnswer.name)
    private readonly answerModel: Model<InterviewAnswerDocument>,
  ) {}

  // Session operations
  async createSession(data: Partial<InterviewSession>): Promise<InterviewSessionDocument> {
    try {
      const session = new this.sessionModel(data as any);
      return (await session.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create interview session: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findSessionById(id: string): Promise<InterviewSessionDocument | null> {
    try {
      return (await this.sessionModel
        .findById(id)
        .populate('questions')
        .populate('answers')
        .exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find interview session by ID ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findSessionsByUserId(
    userId: string,
    limit = 10,
    skip = 0,
  ): Promise<InterviewSessionDocument[]> {
    try {
      return (await this.sessionModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find interview sessions by user ID ${userId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateSession(
    id: string,
    data: Partial<InterviewSession>,
  ): Promise<InterviewSessionDocument | null> {
    try {
      return (await this.sessionModel
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update interview session ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async addQuestionToSession(sessionId: string, questionId: string): Promise<void> {
    try {
      await this.sessionModel
        .findByIdAndUpdate(sessionId, {
          $push: { questions: questionId },
        })
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to add question to session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async addAnswerToSession(sessionId: string, answerId: string): Promise<void> {
    try {
      await this.sessionModel
        .findByIdAndUpdate(sessionId, {
          $push: { answers: answerId },
        })
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to add answer to session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Question operations
  async createQuestion(data: Partial<InterviewQuestion>): Promise<InterviewQuestionDocument> {
    try {
      const question = new this.questionModel(data as any);
      return (await question.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create interview question: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findQuestionById(id: string): Promise<InterviewQuestionDocument | null> {
    try {
      return (await this.questionModel.findById(id).exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find interview question by ID ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateQuestion(
    id: string,
    data: Partial<InterviewQuestion>,
  ): Promise<InterviewQuestionDocument | null> {
    try {
      return (await this.questionModel
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update interview question ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findRandomQuestions(
    category: string,
    difficulty: string,
    limit: number,
    domain?: string,
    technology?: string[],
  ): Promise<InterviewQuestionDocument[]> {
    try {
      const query: any = { category, difficulty };

      if (domain) {
        query.domain = domain;
      }

      if (technology && technology.length > 0) {
        query.technology = { $in: technology };
      }

      return (await this.questionModel
        .aggregate([{ $match: query }, { $sample: { size: limit } }])
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to find random questions: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Answer operations
  async createAnswer(data: Partial<InterviewAnswer>): Promise<InterviewAnswerDocument> {
    try {
      const answer = new this.answerModel(data as any);
      return (await answer.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create interview answer: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findAnswerById(id: string): Promise<InterviewAnswerDocument | null> {
    try {
      return (await this.answerModel.findById(id).populate('questionId').exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find interview answer by ID ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findAnswersBySessionId(sessionId: string): Promise<InterviewAnswerDocument[]> {
    try {
      return (await this.answerModel.find({ sessionId }).populate('questionId').exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find answers by session ID ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findAnswersByQuestionId(questionId: string): Promise<InterviewAnswerDocument[]> {
    try {
      return (await this.answerModel.find({ questionId }).exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find answers by question ID ${questionId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateAnswer(
    id: string,
    data: Partial<InterviewAnswer>,
  ): Promise<InterviewAnswerDocument | null> {
    try {
      return (await this.answerModel
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update interview answer ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Analytics
  async countSessionsByUserId(userId: string, status?: string): Promise<number> {
    try {
      const query: any = { userId };
      if (status) {
        query.status = status;
      }
      return await this.sessionModel.countDocuments(query).exec();
    } catch (error) {
      this.logger.error(
        `Failed to count sessions by user ID ${userId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async getAverageScore(userId: string): Promise<number> {
    try {
      const result = await this.sessionModel.aggregate([
        { $match: { userId, overallScore: { $exists: true } } },
        { $group: { _id: null, avgScore: { $avg: '$overallScore' } } },
      ]);
      return result.length > 0 ? result[0].avgScore : 0;
    } catch (error) {
      this.logger.error(
        `Failed to get average score for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }
}
