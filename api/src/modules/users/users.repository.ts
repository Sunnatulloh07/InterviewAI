import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersRepository {
  private readonly logger = new Logger(UsersRepository.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    try {
      const user = new this.userModel(createUserDto);
      return (await user.save()) as any;
    } catch (error) {
      this.logger.error(`Failed to create user: ${error.message}`, error.stack);
      if (error.code === 11000) {
        throw new Error('Duplicate key error - user already exists');
      }
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findById(id: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel.findById(id).exec();
      return result as UserDocument | null;
    } catch (error) {
      this.logger.error(`Failed to find user by ID ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Password-related methods removed - using OTP authentication

  // Email-based methods removed - using phone number authentication

  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    try {
      const result = await this.userModel.findOne({ telegramId, deletedAt: null }).lean().exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to find user by Telegram ID ${telegramId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findByPhoneNumber(phoneNumber: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel.findOne({ phoneNumber, deletedAt: null }).lean().exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findByPhoneNumberWithOtp(phoneNumber: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findOne({ phoneNumber, deletedAt: null })
        .select('+otpCode')
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number with OTP ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateOtp(
    id: string,
    otpData: { otpCode: string; otpExpires: Date; otpAttempts: number },
  ): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(id, { $set: otpData }).exec();
    } catch (error) {
      this.logger.error(`Failed to update OTP for user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(id, { $inc: { otpAttempts: 1 } }).exec();
    } catch (error) {
      this.logger.error(
        `Failed to increment OTP attempts for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async clearOtp(id: string): Promise<void> {
    try {
      await this.userModel
        .findByIdAndUpdate(id, {
          $unset: { otpCode: 1 },
          $set: { otpAttempts: 0 },
        })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to clear OTP for user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updatePhoneVerified(id: string, verified: boolean): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(id, { $set: { phoneVerified: verified } }).exec();
    } catch (error) {
      this.logger.error(
        `Failed to update phone verified status for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Email verification and password reset methods removed - using OTP authentication

  async update(id: string, updateData: any): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(`Failed to update user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updatePreferences(id: string, preferences: any): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(id, { $set: { preferences } }, { new: true, runValidators: true })
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to update preferences for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  // Password update method removed - using OTP-based authentication

  async incrementUsage(
    id: string,
    field: 'mockInterviewsThisMonth' | 'cvAnalysesThisMonth' | 'chromeQuestionsThisMonth',
  ): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(id, { $inc: { [`usage.${field}`]: 1 } }, { new: true })
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to increment usage for user ${id}, field ${field}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async resetMonthlyUsage(id: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(
          id,
          {
            $set: {
              'usage.mockInterviewsThisMonth': 0,
              'usage.cvAnalysesThisMonth': 0,
              'usage.chromeQuestionsThisMonth': 0,
              'usage.lastResetDate': new Date(),
            },
          },
          { new: true, runValidators: true },
        )
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(
        `Failed to reset monthly usage for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async resetAllMonthlyUsage(): Promise<void> {
    try {
      const firstDayOfMonth = new Date();
      firstDayOfMonth.setDate(1);
      firstDayOfMonth.setHours(0, 0, 0, 0);

      await this.userModel
        .updateMany(
          {
            'usage.lastResetDate': { $lt: firstDayOfMonth },
            deletedAt: null,
          },
          {
            $set: {
              'usage.mockInterviewsThisMonth': 0,
              'usage.cvAnalysesThisMonth': 0,
              'usage.chromeQuestionsThisMonth': 0,
              'usage.aiTokensThisMonth': 0, // TZ compliance
              'usage.lastResetDate': new Date(),
            },
          },
        )
        .exec();

      this.logger.log('Monthly usage reset completed for all users');
    } catch (error) {
      this.logger.error(`Failed to reset all monthly usage: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async softDelete(id: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(id, { $set: { deletedAt: new Date() } }, { new: true })
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(`Failed to soft delete user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async restore(id: string): Promise<UserDocument | null> {
    try {
      const result = await this.userModel
        .findByIdAndUpdate(id, { $unset: { deletedAt: 1 } }, { new: true })
        .lean()
        .exec();
      return result as unknown as UserDocument;
    } catch (error) {
      this.logger.error(`Failed to restore user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async hardDelete(id: string): Promise<boolean> {
    try {
      const result = await this.userModel.findByIdAndDelete(id).exec();
      return !!result;
    } catch (error) {
      this.logger.error(`Failed to hard delete user ${id}: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async updateLastLogin(id: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(id, { $set: { lastLoginAt: new Date() } }).exec();
    } catch (error) {
      this.logger.error(
        `Failed to update last login for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async findAll(filter: FilterQuery<UserDocument> = {}): Promise<UserDocument[]> {
    try {
      const result = await this.userModel
        .find({ ...filter, deletedAt: null })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
      return result as unknown as UserDocument[];
    } catch (error) {
      this.logger.error(`Failed to find all users: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }

  async count(filter: FilterQuery<UserDocument> = {}): Promise<number> {
    try {
      return await this.userModel.countDocuments({ ...filter, deletedAt: null }).exec();
    } catch (error) {
      this.logger.error(`Failed to count users: ${error.message}`, error.stack);
      throw new Error(`Database operation failed: ${error.message}`);
    }
  }
}
