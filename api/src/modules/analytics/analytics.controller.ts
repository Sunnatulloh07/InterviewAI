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

  @Get('overview')
  @ApiOperation({ summary: 'Get analytics overview (admin)' })
  @ApiResponse({ status: 200, description: 'Analytics overview retrieved' })
  async getOverview() {
    return await this.analyticsService.getAnalyticsOverview();
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get plan distribution (admin)' })
  @ApiResponse({ status: 200, description: 'Plan distribution retrieved' })
  async getPlanDistribution() {
    return await this.analyticsService.getPlanDistribution();
  }

  @Get('features')
  @ApiOperation({ summary: 'Get feature usage (admin)' })
  @ApiResponse({ status: 200, description: 'Feature usage retrieved' })
  async getFeatureUsage(@Query('days') days?: number) {
    return await this.analyticsService.getFeatureUsage(days);
  }

  @Get('voice-quota')
  @ApiOperation({ summary: 'Get voice quota usage (admin)' })
  @ApiResponse({ status: 200, description: 'Voice quota usage retrieved' })
  async getVoiceQuotaUsage(@Query('days') days?: number) {
    return await this.analyticsService.getVoiceQuotaUsage(days);
  }

  @Get('daily-tasks')
  @ApiOperation({ summary: 'Get daily task completion (admin)' })
  @ApiResponse({ status: 200, description: 'Daily task completion retrieved' })
  async getDailyTaskCompletion(@Query('days') days?: number) {
    return await this.analyticsService.getDailyTaskCompletion(days);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue metrics (admin)' })
  @ApiResponse({ status: 200, description: 'Revenue metrics retrieved' })
  async getRevenueMetrics(@Query('days') days?: number) {
    return await this.analyticsService.getRevenueMetrics(days);
  }
}

