import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cv, CvDocument } from './schemas/cv.schema';

@Injectable()
export class CvRepository {
  private readonly logger = new Logger(CvRepository.name);

  constructor(@InjectModel(Cv.name) private readonly cvModel: Model<CvDocument>) {}

  async create(data: Partial<Cv>): Promise<CvDocument> {
    try {
      const cv = new this.cvModel(data as any);
      return (await cv.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create CV: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findById(id: string): Promise<CvDocument | null> {
    try {
      return (await this.cvModel.findById(id).exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to find CV by ID ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findByUserId(userId: string, limit = 10, skip = 0): Promise<CvDocument[]> {
    try {
      return (await this.cvModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to find CVs by user ID ${userId}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async update(id: string, data: Partial<Cv>): Promise<CvDocument | null> {
    try {
      return (await this.cvModel
        .findByIdAndUpdate(id, { $set: data }, { new: true })
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update CV ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateAnalysis(id: string, analysis: any, status: string): Promise<CvDocument | null> {
    try {
      return (await this.cvModel
        .findByIdAndUpdate(
          id,
          {
            $set: {
              analysis,
              analysisStatus: status,
              'analysis.analyzedAt': new Date(),
            },
          },
          { new: true },
        )
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to update CV analysis ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.cvModel.findByIdAndDelete(id).exec();
      return !!result as any;
    } catch (error) {
      this.logger.error(`Failed to delete CV ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findPendingAnalysis(limit = 10): Promise<CvDocument[]> {
    try {
      return (await this.cvModel
        .find({ analysisStatus: 'pending' })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to find pending CV analysis: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async countByUserId(userId: string): Promise<number> {
    try {
      return (await this.cvModel.countDocuments({ userId }).exec()) as any;
    } catch (error) {
      this.logger.error(`Failed to count CVs by user ID ${userId}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }
}
