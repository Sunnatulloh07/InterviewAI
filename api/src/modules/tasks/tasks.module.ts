import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTask, DailyTaskSchema } from './schemas/daily-task.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TelegramModule } from '../telegram/telegram.module';
import { EngagementModule } from '../engagement/engagement.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyTask.name, schema: DailyTaskSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
    // ✅ RedisModule is GLOBAL - imported in AppModule, no need to re-import
    forwardRef(() => TelegramModule),
    forwardRef(() => EngagementModule), // Required for FailedNotificationRetryService
  ],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class TasksModule {}
