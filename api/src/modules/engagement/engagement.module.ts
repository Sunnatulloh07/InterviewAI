import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';
import { NotificationLogRepository } from './notification-log.repository';
import { EngagementAiService } from './engagement-ai.service';
import { EngagementService } from './engagement.service';
import { EngagementSchedulerService } from './engagement-scheduler.service';
import { SurveyHandlerService } from './survey-handler.service';
import { TaskReminderService } from './task-reminder.service';
import { UserActivationService } from './user-activation.service';
import { UsersModule } from '../users/users.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { TelegramModule } from '../telegram/telegram.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DailyTask, DailyTaskSchema } from '../tasks/schemas/daily-task.schema';

/**
 * ...
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: User.name, schema: UserSchema },
      { name: DailyTask.name, schema: DailyTaskSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => InterviewsModule),
    forwardRef(() => TelegramModule),
  ],
  providers: [
    NotificationLogRepository,
    EngagementAiService,
    EngagementService,
    EngagementSchedulerService,
    SurveyHandlerService,
    TaskReminderService,
    UserActivationService,
  ],
  exports: [
    NotificationLogRepository,
    EngagementAiService,
    EngagementService,
    EngagementSchedulerService,
    SurveyHandlerService,
    TaskReminderService,
    UserActivationService,
  ],
})
export class EngagementModule {}

