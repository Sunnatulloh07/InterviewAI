import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import { type LeaderboardPeriod, LB_PERIODS } from './schemas/leaderboard-entry.schema';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';

/**
 * Leaderboard REST API Controller
 *
 * Protected endpoints (JWT required):
 * - GET /api/leaderboard/:period   — Get top users for a period (weekly/monthly/alltime)
 * - GET /api/leaderboard/me        — Get current user's rank across all periods
 */
@ApiTags('Leaderboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/leaderboard')
export class LeaderboardController {
  private readonly logger = new Logger(LeaderboardController.name);

  constructor(private readonly leaderboardService: LeaderboardService) {}

  /**
   * Get current user's rank and points across all active periods.
   * NOTE: This route must be registered BEFORE /:period to avoid "me" being treated as a period param.
   */
  @Get('me')
  @ApiOperation({
    summary: 'Get my leaderboard rank',
    description:
      'Returns the authenticated user\'s rank, points, and breakdown across all active periods (weekly, monthly, alltime).',
  })
  @ApiResponse({
    status: 200,
    description: 'User leaderboard info',
    schema: {
      type: 'object',
      properties: {
        weekly: {
          type: 'object',
          nullable: true,
          properties: {
            rank: { type: 'number', example: 5 },
            points: { type: 'number', example: 45 },
            periodKey: { type: 'string', example: '2025-W10' },
            breakdown: { type: 'object' },
          },
        },
        monthly: {
          type: 'object',
          nullable: true,
          properties: {
            rank: { type: 'number', example: 12 },
            points: { type: 'number', example: 180 },
            periodKey: { type: 'string', example: '2025-03' },
            breakdown: { type: 'object' },
          },
        },
        alltime: {
          type: 'object',
          nullable: true,
          properties: {
            rank: { type: 'number', example: 28 },
            points: { type: 'number', example: 1250 },
            periodKey: { type: 'string', example: 'alltime' },
            breakdown: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRank(@CurrentUser() user: RequestUser) {
    const periods = this.leaderboardService.getActivePeriods();
    const result: Record<string, any> = {};

    for (const { period, periodKey } of periods) {
      const entry = await this.leaderboardService.getUserRank(
        user.id,
        period,
        periodKey,
      );

      result[period] = entry
        ? {
            rank: entry.rank || null,
            points: entry.points,
            periodKey: entry.periodKey,
            currentStreak: entry.currentStreak,
            breakdown: entry.breakdown,
            lastPointsAt: entry.lastPointsAt,
          }
        : null;
    }

    return result;
  }

  /**
   * Get top users for a specific leaderboard period.
   */
  @Get(':period')
  @ApiOperation({
    summary: 'Get leaderboard for a period',
    description:
      'Returns the top users for the specified period. Optionally filter by position (junior/middle/senior/lead).',
  })
  @ApiParam({
    name: 'period',
    enum: ['weekly', 'monthly', 'alltime'],
    description: 'Leaderboard period',
  })
  @ApiQuery({
    name: 'position',
    required: false,
    enum: ['junior', 'middle', 'senior', 'lead'],
    description: 'Filter by position category',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of results (default 10, max 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Leaderboard entries',
    schema: {
      type: 'object',
      properties: {
        period: { type: 'string', example: 'weekly' },
        periodKey: { type: 'string', example: '2025-W10' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rank: { type: 'number', example: 1 },
              displayName: { type: 'string', example: 'John D.' },
              points: { type: 'number', example: 95 },
              currentStreak: { type: 'number', example: 14 },
              position: { type: 'string', example: 'middle' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid period' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getLeaderboard(
    @Param('period') period: string,
    @Query('position') position?: string,
    @Query('limit') limitStr?: string,
  ) {
    // Validate period
    if (!LB_PERIODS.includes(period as LeaderboardPeriod)) {
      throw new BadRequestException(
        `Invalid period "${period}". Must be one of: ${LB_PERIODS.join(', ')}`,
      );
    }

    const typedPeriod = period as LeaderboardPeriod;
    const limit = Math.min(Math.max(parseInt(limitStr || '10', 10) || 10, 1), 50);

    // Get the current period key for this period type
    const activePeriods = this.leaderboardService.getActivePeriods();
    const matched = activePeriods.find((p) => p.period === typedPeriod);

    if (!matched) {
      throw new BadRequestException(`Could not determine period key for "${period}"`);
    }

    const entries = await this.leaderboardService.getTopN(
      typedPeriod,
      matched.periodKey,
      position,
      limit,
    );

    return {
      period: typedPeriod,
      periodKey: matched.periodKey,
      entries: entries.map((e) => ({
        rank: e.rank,
        displayName: e.displayName,
        points: e.points,
        currentStreak: e.currentStreak,
        position: e.position,
        breakdown: e.breakdown,
      })),
    };
  }
}
