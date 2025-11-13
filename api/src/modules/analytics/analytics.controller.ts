import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('track')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Track analytics event (internal)' })
  async trackEvent(
    @CurrentUser() user: RequestUser,
    @Body() data: { eventType: string; properties?: any },
  ) {
    await this.analyticsService.trackEvent({
      userId: user.id as any,
      eventType: data.eventType,
      properties: data.properties || {},
      timestamp: new Date(),
    });
    return { success: true };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  async getDashboard(@CurrentUser() user: RequestUser) {
    return await this.analyticsService.getDashboard(user.id);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get usage statistics' })
  @ApiResponse({ status: 200, description: 'Usage statistics retrieved' })
  async getUsage(@CurrentUser() user: RequestUser, @Query('days') days?: number) {
    return await this.analyticsService.getUsageStats(user.id, days);
  }
}
