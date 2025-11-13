import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiSession, AiSessionDocument } from './schemas/ai-session.schema';

@Injectable()
export class AiRepository {
  private readonly logger = new Logger(AiRepository.name);

  constructor(
    @InjectModel(AiSession.name)
    private readonly aiSessionModel: Model<AiSessionDocument>,
  ) {}

  async create(data: Partial<AiSession>): Promise<AiSessionDocument> {
    try {
      const session = new this.aiSessionModel(data as any);
      return (await session.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create AI session: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findById(id: string): Promise<AiSessionDocument | null> {
    try {
      return (await this.aiSessionModel.findById(id).exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to find AI session by ID ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findByUserId(userId: string, limit = 10, skip = 0): Promise<AiSessionDocument[]> {
    try {
      return (await this.aiSessionModel
        .find({ userId, archived: false })
        .sort({ lastUpdated: -1 })
        .limit(limit)
        .skip(skip)
        .exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find AI sessions by user ID ${userId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findBySessionType(userId: string, sessionType: string): Promise<AiSessionDocument | null> {
    try {
      return (await this.aiSessionModel
        .findOne({ userId, sessionType, archived: false })
        .sort({ lastUpdated: -1 })
        .exec()) as any;
    } catch (error) {
      this.logger.error(
        `Failed to find AI session by type ${sessionType} for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async update(id: string, data: Partial<AiSession>): Promise<AiSessionDocument | null> {
    try {
      return (await this.aiSessionModel
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update AI session ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async addMessage(
    id: string,
    message: {
      role: 'user' | 'assistant';
      content: string;
      timestamp: Date;
      type: 'question' | 'answer';
      topics?: string[];
    },
  ): Promise<void> {
    try {
      await this.aiSessionModel
        .findByIdAndUpdate(id, {
          $push: { messages: message },
          $set: { lastUpdated: new Date() },
        })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to add message to AI session ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateContext(id: string, context: Record<string, any>): Promise<void> {
    try {
      await this.aiSessionModel
        .findByIdAndUpdate(id, { $set: { context, lastUpdated: new Date() } })
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to update context for AI session ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async incrementTokens(id: string, tokens: number): Promise<void> {
    try {
      await this.aiSessionModel
        .findByIdAndUpdate(id, {
          $inc: { tokensUsed: tokens },
          $set: { lastUpdated: new Date() },
        })
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to increment tokens for AI session ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async archive(id: string): Promise<void> {
    try {
      await this.aiSessionModel.findByIdAndUpdate(id, { $set: { archived: true } }).exec();
    } catch (error) {
      this.logger.error(`Failed to archive AI session ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.aiSessionModel.findByIdAndDelete(id).exec();
      return !!result;
    } catch (error) {
      this.logger.error(`Failed to delete AI session ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }
}
