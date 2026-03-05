import {
  Controller,
  Get,
  Post,
  UseGuards,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { StreakService } from './streak.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';

/**
 * Streak REST API Controller
 *
 * Protected endpoints (JWT required):
 * - GET  /api/streak/me     — Get current user's streak info
 * - POST /api/streak/freeze — Manually freeze streak (Pro/Elite only)
 */
@ApiTags('Streak')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/streak')
export class StreakController {
  private readonly logger = new Logger(StreakController.name);

  constructor(
    private readonly streakService: StreakService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Get current user's streak information.
   */
  @Get('me')
  @ApiOperation({
    summary: 'Get my streak info',
    description:
      'Returns the authenticated user\'s current streak, longest streak, state, milestones, and freeze info.',
  })
  @ApiResponse({
    status: 200,
    description: 'Streak info retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        currentStreak: { type: 'number', example: 7 },
        longestStreak: { type: 'number', example: 14 },
        state: {
          type: 'string',
          enum: ['inactive', 'active', 'at_risk', 'frozen', 'broken'],
          example: 'active',
        },
        totalActiveDays: { type: 'number', example: 21 },
        freezesRemaining: { type: 'number', example: 2 },
        milestones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              days: { type: 'number', example: 7 },
              achievedAt: { type: 'string', format: 'date-time' },
              rewardClaimed: { type: 'boolean', example: false },
            },
          },
        },
        badges: {
          type: 'array',
          items: { type: 'string' },
          example: ['first_flame', 'week_warrior'],
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyStreak(@CurrentUser() user: RequestUser) {
    return this.streakService.getStreakInfo(user.id);
  }

  /**
   * Manually freeze the user's streak (Pro/Elite plans only).
   * Uses one of the monthly freeze allowance.
   */
  @Post('freeze')
  @ApiOperation({
    summary: 'Freeze my streak',
    description:
      'Manually freeze your active streak to prevent it from breaking. Available for Pro (2/month) and Elite (3/month) plans only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Streak freeze result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        freezesRemaining: { type: 'number', example: 1 },
        message: { type: 'string', example: 'Streak frozen! 1 freeze(s) remaining this month.' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Plan does not support streak freeze' })
  async freezeStreak(@CurrentUser() user: RequestUser) {
    const plan = await this.getUserPlan(user.id);
    const result = await this.streakService.manualFreeze(user.id, plan);

    if (!result.success && result.message.includes('Pro and Elite')) {
      throw new ForbiddenException(result.message);
    }

    return result;
  }

  /**
   * Read user plan from Redis cache (same key StreakService uses).
   * Falls back to 'free_trial' if not cached.
   */
  private async getUserPlan(userId: string): Promise<string> {
    const cached = await this.redis.get(`user:plan:${userId}`);
    return cached || 'free_trial';
  }
}
