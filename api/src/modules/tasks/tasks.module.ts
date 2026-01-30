import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTask, DailyTaskSchema } from './schemas/daily-task.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyTask.name, schema: DailyTaskSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class TasksModule {}
