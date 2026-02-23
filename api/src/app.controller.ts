import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { Roles } from './common/decorators/roles.decorator';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserRole } from './common/enums/user-role.enum';
import { DailyTasksService } from './modules/tasks/daily-tasks.service';
import { QuestionPoolManagerService } from './modules/tasks/question-pool-manager.service';

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dailyTasksService: DailyTasksService,
    private readonly questionPoolManager: QuestionPoolManagerService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get API info' })
  @ApiResponse({ status: 200, description: 'API information' })
  getInfo() {
    return this.appService.getInfo();
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  async getHealth() {
    return await this.appService.getHealth();
  }

  /**
   * 🔧 DEBUG ENDPOINT: Manually trigger daily tasks delivery
   * Use this to test cron job without waiting for 09:00
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('debug/trigger-daily-tasks')
  @ApiOperation({ summary: 'Manually trigger daily tasks delivery (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Task delivery triggered' })
  async triggerDailyTasks() {
    try {
      await this.dailyTasksService.deliverDailyTasks();
      return {
        success: true,
        message: 'Daily tasks delivery triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to trigger daily tasks delivery',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🔍 DEBUG ENDPOINT: Check question pool status
   * Shows count of questions for each position/type/domain combination
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('debug/question-pool-status')
  @ApiOperation({ summary: 'Check question pool status (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Pool status retrieved' })
  async getQuestionPoolStatus() {
    try {
      const stats = await this.questionPoolManager.getPoolStatus();
      return {
        success: true,
        stats: stats,
        timestamp: new Date().toISOString(),
        summary: {
          total: stats.reduce((sum: number, s: any) => sum + s.count, 0),
          healthy: stats.filter((s: any) => s.count >= s.min).length,
          warning: stats.filter((s: any) => s.count < s.min).length,
          byPriority: {
            high: stats.filter((s: any) => s.priority === 'high').reduce((sum: number, s: any) => sum + s.count, 0),
            medium: stats.filter((s: any) => s.priority === 'medium').reduce((sum: number, s: any) => sum + s.count, 0),
            low: stats.filter((s: any) => s.priority === 'low').reduce((sum: number, s: any) => sum + s.count, 0),
          },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to get pool status',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🔧 DEBUG ENDPOINT: Manually trigger pool refill
   * Runs the background question generation process
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('debug/trigger-pool-refill')
  @ApiOperation({ summary: 'Manually trigger question pool refill (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Pool refill triggered' })
  async triggerPoolRefill() {
    try {
      await this.questionPoolManager.refillQuestionPool();
      return {
        success: true,
        message: 'Question pool refill triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to trigger pool refill',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
