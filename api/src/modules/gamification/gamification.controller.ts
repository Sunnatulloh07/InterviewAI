import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { BadgeService } from './badge.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';

/**
 * Gamification (Badges) REST API Controller
 *
 * Protected endpoints (JWT required):
 * - GET  /api/badges/all       — Get all available badge definitions
 * - GET  /api/badges/me        — Get current user's earned badges + progress
 * - POST /api/badges/:id/claim — Claim a badge reward (future: streak milestone rewards)
 */
@ApiTags('Badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/badges')
export class GamificationController {
  private readonly logger = new Logger(GamificationController.name);

  constructor(private readonly badgeService: BadgeService) {}

  /**
   * Get all available badge definitions.
   */
  @Get('all')
  @ApiOperation({
    summary: 'Get all badges',
    description: 'Returns all available badge definitions with their conditions and rarity.',
  })
  @ApiResponse({
    status: 200,
    description: 'All badge definitions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          badgeId: { type: 'string', example: 'week_warrior' },
          name: { type: 'string', example: 'Week Warrior' },
          emoji: { type: 'string', example: '⚡' },
          description: { type: 'string', example: 'Maintain a 7-day streak' },
          rarity: {
            type: 'string',
            enum: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
            example: 'common',
          },
          condition: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'streak' },
              threshold: { type: 'number', example: 7 },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllBadges() {
    const badges = await this.badgeService.getAllBadges();
    return badges.map((b) => ({
      badgeId: b.badgeId,
      name: b.name,
      emoji: b.emoji,
      description: b.description,
      rarity: b.rarity,
      condition: b.condition,
      sortOrder: b.sortOrder,
    }));
  }

  /**
   * Get current user's badge progress (earned + total).
   */
  @Get('me')
  @ApiOperation({
    summary: 'Get my badges',
    description:
      'Returns the authenticated user\'s badge progress — which badges are earned and the total available.',
  })
  @ApiResponse({
    status: 200,
    description: 'User badge progress',
    schema: {
      type: 'object',
      properties: {
        earned: { type: 'number', example: 3 },
        total: { type: 'number', example: 15 },
        badges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              badgeId: { type: 'string', example: 'first_flame' },
              name: { type: 'string', example: 'First Flame' },
              emoji: { type: 'string', example: '🔥' },
              rarity: { type: 'string', example: 'common' },
              earned: { type: 'boolean', example: true },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyBadges(@CurrentUser() user: RequestUser) {
    return this.badgeService.getBadgeProgress(user.id);
  }

  /**
   * Claim a badge reward.
   *
   * Currently a placeholder — the reward system is not yet implemented.
   * This endpoint acknowledges the claim and returns the badge info.
   * Future: will integrate with a RewardService for actual reward distribution.
   */
  @Post(':id/claim')
  @ApiOperation({
    summary: 'Claim badge reward',
    description:
      'Claim the reward for an earned badge. Currently acknowledges the badge; reward distribution is planned for a future release.',
  })
  @ApiParam({
    name: 'id',
    description: 'Badge ID (e.g. "week_warrior")',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Badge claim result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        badgeId: { type: 'string', example: 'week_warrior' },
        message: { type: 'string', example: 'Badge reward acknowledged.' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Badge not found or not earned' })
  async claimBadgeReward(
    @CurrentUser() user: RequestUser,
    @Param('id') badgeId: string,
  ) {
    // Verify the user has earned this badge
    const userBadges = await this.badgeService.getUserBadges(user.id);
    const earned = userBadges.find((b) => b.badgeId === badgeId);

    if (!earned) {
      throw new NotFoundException(
        `Badge "${badgeId}" not found or not yet earned.`,
      );
    }

    // TODO: Integrate with RewardService when implemented
    // For now, acknowledge the claim
    return {
      success: true,
      badgeId: earned.badgeId,
      name: earned.name,
      emoji: earned.emoji,
      rarity: earned.rarity,
      message: 'Badge reward acknowledged. Reward distribution coming soon.',
    };
  }
}
