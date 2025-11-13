import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
// Note: Password authentication removed - using Telegram bot with OTP
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieve the profile information of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  async getProfile(@CurrentUser() user: RequestUser): Promise<UserResponseDto> {
    const userDoc = await this.usersService.findById(user.id);
    return this.usersService.sanitizeUser(userDoc);
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update user profile',
    description: 'Update profile information such as name, avatar, and bio',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid input data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async updateProfile(
    @CurrentUser() user: RequestUser,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const updatedUser = await this.usersService.updateProfile(user.id, updateUserDto);
    return this.usersService.sanitizeUser(updatedUser);
  }

  // Password update endpoint removed - using Telegram bot with OTP authentication

  @Patch('preferences')
  @ApiOperation({
    summary: 'Update user preferences',
    description:
      'Update user preferences including language, notifications, and interview settings',
  })
  @ApiBody({ type: UpdatePreferencesDto })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid preferences data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async updatePreferences(
    @CurrentUser() user: RequestUser,
    @Body() updatePreferencesDto: UpdatePreferencesDto,
  ): Promise<UserResponseDto> {
    const updatedUser = await this.usersService.updatePreferences(user.id, updatePreferencesDto);
    return this.usersService.sanitizeUser(updatedUser);
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Get usage statistics',
    description: 'Retrieve current usage statistics and limits based on subscription plan',
  })
  @ApiResponse({
    status: 200,
    description: 'Usage statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        usage: {
          type: 'object',
          properties: {
            mockInterviewsThisMonth: { type: 'number', example: 2 },
            cvAnalysesThisMonth: { type: 'number', example: 1 },
            chromeQuestionsThisMonth: { type: 'number', example: 25 },
            lastResetDate: { type: 'string', format: 'date-time' },
          },
        },
        limits: {
          type: 'object',
          properties: {
            mockInterviews: { type: 'number', example: 3 },
            cvAnalyses: { type: 'number', example: 1 },
            chromeQuestions: { type: 'number', example: 50 },
          },
        },
        plan: { type: 'string', example: 'free' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getUsageStats(@CurrentUser() user: RequestUser) {
    return await this.usersService.getUsageStats(user.id);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete user account',
    description: 'Soft delete user account (can be restored within 30 days)',
  })
  @ApiResponse({
    status: 200,
    description: 'Account deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: {
          type: 'string',
          example: 'Account deleted successfully. You can restore it within 30 days.',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async deleteAccount(
    @CurrentUser() user: RequestUser,
  ): Promise<{ success: boolean; message: string }> {
    await this.usersService.deleteAccount(user.id);
    return {
      success: true,
      message: 'Account deleted successfully. You can restore it within 30 days.',
    };
  }
}
