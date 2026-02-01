import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';
import { FailedNotification, FailedNotificationSchema } from './schemas/failed-notification.schema';
import { NotificationLogRepository } from './notification-log.repository';
import { EngagementAiService } from './engagement-ai.service';
import { EngagementService } from './engagement.service';
import { EngagementSchedulerService } from './engagement-scheduler.service';
import { SurveyHandlerService } from './survey-handler.service';
import { TaskReminderService } from './task-reminder.service';
import { UserActivationService } from './user-activation.service';
import { InactivityTrackerService } from './inactivity-tracker.service';
import { UnregisteredUserService } from './unregistered-user.service';
import { FailedNotificationRetryService } from './failed-notification-retry.service';
import { NotificationConsistencyChecker } from './notification-consistency-checker.service';
import { TrialExpiredUserService } from './trial-expired-user.service';
import { LimitExhaustedUserService } from './limit-exhausted-user.service';
import { UsersModule } from '../users/users.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AiModule } from '../ai/ai.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DailyTask, DailyTaskSchema } from '../tasks/schemas/daily-task.schema';
import { UnregisteredUser, UnregisteredUserSchema } from '../telegram/schemas/unregistered-user.schema';

/**
 * ...
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: FailedNotification.name, schema: FailedNotificationSchema },
      { name: UnregisteredUser.name, schema: UnregisteredUserSchema },
      { name: User.name, schema: UserSchema },
      { name: DailyTask.name, schema: DailyTaskSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => InterviewsModule),
    forwardRef(() => TelegramModule),
    AiModule,
  ],
  providers: [
    NotificationLogRepository,
    EngagementAiService,
    EngagementService,
    EngagementSchedulerService,
    SurveyHandlerService,
    TaskReminderService,
    UserActivationService,
    InactivityTrackerService,
    UnregisteredUserService,
    FailedNotificationRetryService,
    NotificationConsistencyChecker,
    TrialExpiredUserService,
    LimitExhaustedUserService,
  ],
  exports: [
    NotificationLogRepository,
    EngagementAiService,
    EngagementService,
    EngagementSchedulerService,
    SurveyHandlerService,
    TaskReminderService,
    UserActivationService,
    InactivityTrackerService,
    UnregisteredUserService,
    FailedNotificationRetryService,
    NotificationConsistencyChecker,
    TrialExpiredUserService,
    LimitExhaustedUserService,
  ],
})
export class EngagementModule {}

