import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';
import { NotificationLogRepository } from './notification-log.repository';
import { EngagementAiService } from './engagement-ai.service';
import { EngagementService } from './engagement.service';
import { EngagementSchedulerService } from './engagement-scheduler.service';
import { UsersModule } from '../users/users.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { TelegramModule } from '../telegram/telegram.module';
import { User, UserSchema } from '../users/schemas/user.schema';

/**
 * ...
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: NotificationLog.name, schema: NotificationLogSchema },
      { name: User.name, schema: UserSchema },
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
  ],
  exports: [
    NotificationLogRepository,
    EngagementAiService,
    EngagementService,
    EngagementSchedulerService,
  ],
})
export class EngagementModule {}

