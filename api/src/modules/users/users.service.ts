import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
// bcrypt removed - using OTP-based authentication
import { USAGE_LIMITS } from '@common/constants';
import { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
// Note: Password authentication removed - using Telegram bot with OTP
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserDocument } from './schemas/user.schema';
import { UserRole } from '@common/enums/user-role.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly usersRepository: UsersRepository) {}

  /**
   * Create a new user (via Telegram bot)
   */
  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    try {
      // Check if user already exists by phone number
      const existingUser = await this.usersRepository.findByPhoneNumber(createUserDto.phoneNumber);
      if (existingUser) {
        throw new ConflictException('User with this phone number already exists');
      }

      // Create user
      const user = await this.usersRepository.create(createUserDto);

      this.logger.log(`User created: ${user.phoneNumber}`);
      return user;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(`Failed to create user: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to create user. Please try again.');
    }
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<UserDocument> {
    try {
      const user = await this.usersRepository.findById(id);
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find user by ID ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve user. Please try again.');
    }
  }

  // Email-based authentication methods removed - using phone number + OTP

  /**
   * Find user by Telegram ID
   */
  async findByTelegramId(telegramId: number): Promise<UserDocument | null> {
    try {
      return await this.usersRepository.findByTelegramId(telegramId);
    } catch (error) {
      this.logger.error(
        `Failed to find user by Telegram ID ${telegramId}: ${error.message}`,
        error.stack,
      );
      return null; // Graceful degradation - return null instead of throwing
    }
  }

  /**
   * Find user by phone number
   */
  async findByPhoneNumber(phoneNumber: string): Promise<UserDocument | null> {
    try {
      return await this.usersRepository.findByPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      return null; // Graceful degradation - return null instead of throwing
    }
  }

  /**
   * Find user by phone number with OTP data
   */
  async findByPhoneNumberWithOtp(phoneNumber: string): Promise<UserDocument | null> {
    try {
      return await this.usersRepository.findByPhoneNumberWithOtp(phoneNumber);
    } catch (error) {
      this.logger.error(
        `Failed to find user by phone number with OTP ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      return null; // Graceful degradation - return null instead of throwing
    }
  }

  /**
   * Update user OTP
   */
  async updateOtp(
    id: string,
    otpData: { otpCode: string; otpExpires: Date; otpAttempts: number },
  ): Promise<void> {
    try {
      await this.usersRepository.updateOtp(id, otpData);
    } catch (error) {
      this.logger.error(`Failed to update OTP for user ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update OTP. Please try again.');
    }
  }

  /**
   * Increment OTP attempts
   */
  async incrementOtpAttempts(id: string): Promise<void> {
    try {
      await this.usersRepository.incrementOtpAttempts(id);
    } catch (error) {
      this.logger.error(
        `Failed to increment OTP attempts for user ${id}: ${error.message}`,
        error.stack,
      );
      // Don't throw - OTP attempt tracking is not critical
    }
  }

  /**
   * Clear OTP data
   */
  async clearOtp(id: string): Promise<void> {
    try {
      await this.usersRepository.clearOtp(id);
    } catch (error) {
      this.logger.error(`Failed to clear OTP for user ${id}: ${error.message}`, error.stack);
      // Don't throw - OTP clearing is not critical
    }
  }

  /**
   * Update phone verified status
   */
  async updatePhoneVerified(id: string, verified: boolean): Promise<void> {
    try {
      await this.usersRepository.updatePhoneVerified(id, verified);
    } catch (error) {
      this.logger.error(
        `Failed to update phone verified status for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        'Failed to update phone verification status. Please try again.',
      );
    }
  }

  /**
   * Update user language
   */
  async updateLanguage(id: string, language: string): Promise<void> {
    try {
      await this.usersRepository.update(id, { language });
    } catch (error) {
      this.logger.error(`Failed to update language for user ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update language. Please try again.');
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    try {
      const user = await this.usersRepository.update(id, updateUserDto);
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(`User profile updated: ${user.email || user.phoneNumber}`);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update profile for user ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update profile. Please try again.');
    }
  }

  // Password update method removed - using Telegram bot with OTP authentication

  /**
   * Update user preferences
   */
  async updatePreferences(
    id: string,
    updatePreferencesDto: UpdatePreferencesDto,
  ): Promise<UserDocument> {
    try {
      const user = await this.findById(id);

      // Merge with existing preferences
      const updatedPreferences = {
        ...user.preferences,
        ...updatePreferencesDto,
        notifications: {
          ...user.preferences?.notifications,
          ...updatePreferencesDto.notifications,
        },
        interviewSettings: {
          ...user.preferences?.interviewSettings,
          ...updatePreferencesDto.interviewSettings,
        },
        privacy: {
          ...user.preferences?.privacy,
          ...updatePreferencesDto.privacy,
        },
      };

      const updatedUser = await this.usersRepository.updatePreferences(id, updatedPreferences);
      if (!updatedUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(
        `Preferences updated for user: ${updatedUser.email || updatedUser.phoneNumber}`,
      );
      return updatedUser;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to update preferences for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to update preferences. Please try again.');
    }
  }

  /**
   * Soft delete user account
   */
  async deleteAccount(id: string): Promise<void> {
    try {
      const user = await this.usersRepository.softDelete(id);
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(`User account deleted: ${user.email || user.phoneNumber}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete account for user ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to delete account. Please try again.');
    }
  }

  /**
   * Check if user can perform action based on usage limits
   */
  async canPerformAction(
    userId: string,
    action: 'mockInterview' | 'cvAnalysis' | 'chromeQuestion',
  ): Promise<{ allowed: boolean; message?: string; remaining?: number }> {
    try {
      const user = await this.findById(userId);
      const plan = user.subscription?.plan || 'free';
      const limits = USAGE_LIMITS[plan];

      if (!limits) {
        return { allowed: false, message: 'Invalid subscription plan' };
      }

      let currentUsage = 0;
      let limit = 0;

      switch (action) {
        case 'mockInterview':
          currentUsage = user.usage?.mockInterviewsThisMonth || 0;
          limit = limits.mockInterviews;
          break;
        case 'cvAnalysis':
          currentUsage = user.usage?.cvAnalysesThisMonth || 0;
          limit = limits.cvAnalyses;
          break;
        case 'chromeQuestion':
          currentUsage = user.usage?.chromeQuestionsThisMonth || 0;
          limit = limits.chromeQuestions;
          break;
      }

      // -1 means unlimited
      if (limit === -1) {
        return { allowed: true, remaining: -1 };
      }

      if (currentUsage >= limit) {
        return {
          allowed: false,
          message: `Monthly limit reached for ${action}. Please upgrade your plan.`,
          remaining: 0,
        };
      }

      return {
        allowed: true,
        remaining: limit - currentUsage,
      };
    } catch (error) {
      this.logger.error(
        `Failed to check usage limits for user ${userId}: ${error.message}`,
        error.stack,
      );
      // Graceful degradation - allow action if check fails
      return { allowed: true, remaining: -1 };
    }
  }

  /**
   * Increment usage counter
   */
  async incrementUsage(
    userId: string,
    type: 'mockInterview' | 'cvAnalysis' | 'chromeQuestion',
  ): Promise<void> {
    try {
      const fieldMap = {
        mockInterview: 'mockInterviewsThisMonth' as const,
        cvAnalysis: 'cvAnalysesThisMonth' as const,
        chromeQuestion: 'chromeQuestionsThisMonth' as const,
      };

      await this.usersRepository.incrementUsage(userId, fieldMap[type]);
    } catch (error) {
      this.logger.error(
        `Failed to increment usage for user ${userId}, type ${type}: ${error.message}`,
        error.stack,
      );
      // Don't throw - usage tracking is not critical for core functionality
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(userId: string): Promise<{
    usage: UserDocument['usage'];
    limits: (typeof USAGE_LIMITS)[keyof typeof USAGE_LIMITS];
    plan: string;
  }> {
    try {
      const user = await this.findById(userId);
      const plan = user.subscription?.plan || 'free';
      const limits = USAGE_LIMITS[plan];

      return {
        usage: user.usage,
        limits,
        plan,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get usage stats for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to retrieve usage statistics. Please try again.');
    }
  }

  /**
   * Sanitize user object for response
   */
  sanitizeUser(user: UserDocument): UserResponseDto {
    const plainUser = user.toObject();
    return new UserResponseDto(plainUser);
  }

  // Password hashing/comparison methods removed - using Telegram bot with OTP

  /**
   * Update user role (admin only)
   */
  async updateRole(id: string, role: UserRole): Promise<UserDocument> {
    try {
      const user = await this.usersRepository.update(id, { role });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(`User role updated: ${user.email || user.phoneNumber} -> ${role}`);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update role for user ${id}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update role. Please try again.');
    }
  }

  /**
   * Update last login time
   */
  async updateLastLogin(id: string): Promise<void> {
    try {
      await this.usersRepository.updateLastLogin(id);
    } catch (error) {
      this.logger.error(
        `Failed to update last login for user ${id}: ${error.message}`,
        error.stack,
      );
      // Don't throw - last login tracking is not critical
    }
  }

  /**
   * Link Telegram account
   */
  async linkTelegramAccount(id: string, telegramId: number): Promise<UserDocument> {
    try {
      // Check if Telegram ID is already linked to another user
      const existingUser = await this.usersRepository.findByTelegramId(telegramId);
      if (existingUser && existingUser.id !== id) {
        throw new ConflictException('This Telegram account is already linked to another user');
      }

      const user = await this.usersRepository.update(id, { telegramId });
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(`Telegram account linked for user: ${user.email || user.phoneNumber}`);
      return user;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to link Telegram account for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to link Telegram account. Please try again.');
    }
  }

  /**
   * Unlink Telegram account
   */
  async unlinkTelegramAccount(id: string): Promise<UserDocument> {
    try {
      const user = await this.usersRepository.update(id, { telegramId: null } as any);
      if (!user) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      this.logger.log(`Telegram account unlinked for user: ${user.email || user.phoneNumber}`);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to unlink Telegram account for user ${id}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to unlink Telegram account. Please try again.');
    }
  }

  /**
   * Get all users (admin only)
   */
  async findAll(): Promise<UserDocument[]> {
    try {
      return await this.usersRepository.findAll();
    } catch (error) {
      this.logger.error(`Failed to find all users: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve users. Please try again.');
    }
  }

  /**
   * Count total users
   */
  async count(): Promise<number> {
    try {
      return await this.usersRepository.count();
    } catch (error) {
      this.logger.error(`Failed to count users: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to count users. Please try again.');
    }
  }
}
