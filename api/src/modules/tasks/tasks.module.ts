import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
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
    RedisModule, // ✅ CRITICAL: Redis module for @InjectRedis() decorator
    forwardRef(() => TelegramModule),
    forwardRef(() => EngagementModule), // Required for FailedNotificationRetryService
  ],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class TasksModule {}
