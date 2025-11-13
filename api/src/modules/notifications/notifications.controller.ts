import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '@common/pipes/parse-objectid.pipe';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiResponse({ status: 200, description: 'Notifications retrieved' })
  async getNotifications(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: number,
    @Query('skip') skip?: number,
  ) {
    return await this.notificationsService.findByUserId(user.id, limit, skip);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread count' })
  @ApiResponse({ status: 200, description: 'Count retrieved' })
  async getUnreadCount(@CurrentUser() user: RequestUser) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 204, description: 'Marked as read' })
  async markAsRead(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    await this.notificationsService.markAsRead(id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 204, description: 'All marked as read' })
  async markAllAsRead(@CurrentUser() user: RequestUser) {
    await this.notificationsService.markAllAsRead(user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete notification' })
  @ApiResponse({ status: 204, description: 'Notification deleted' })
  async deleteNotification(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.notificationsService.delete(id);
  }
}
