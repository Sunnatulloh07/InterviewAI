import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { DailyTasksService } from './modules/tasks/daily-tasks.service';

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly dailyTasksService: DailyTasksService,
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
   * 
   * Security: Public for testing (remove in production!)
   */
  @Public()
  @Post('debug/trigger-daily-tasks')
  @ApiOperation({ summary: 'Manually trigger daily tasks delivery (DEBUG)' })
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
}
