import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DailyTasksService } from './daily-tasks.service';
import { AIQuestionGeneratorService } from './ai-question-generator.service';
import { SegmentQuestionGeneratorService } from './segment-question-generator.service';
import { DailyTask, DailyTaskSchema } from './schemas/daily-task.schema';
import { CareerPath, CareerPathSchema } from './schemas/career-path.schema';
import { SegmentQuestion, SegmentQuestionSchema } from './schemas/segment-question.schema';
import { QuestionPattern, QuestionPatternSchema } from './schemas/question-pattern.schema';
import { GeneratedQuestion, GeneratedQuestionSchema } from './schemas/generated-question.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { TelegramModule } from '../telegram/telegram.module';
import { EngagementModule } from '../engagement/engagement.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyTask.name, schema: DailyTaskSchema },
      { name: CareerPath.name, schema: CareerPathSchema },
      { name: SegmentQuestion.name, schema: SegmentQuestionSchema },
      { name: QuestionPattern.name, schema: QuestionPatternSchema },
      { name: User.name, schema: UserSchema },
      { name: GeneratedQuestion.name, schema: GeneratedQuestionSchema },
    ]),
    ConfigModule,
    // ✅ RedisModule is GLOBAL - imported in AppModule, no need to re-import
    forwardRef(() => TelegramModule),
    forwardRef(() => EngagementModule), // Required for FailedNotificationRetryService
  ],
  providers: [DailyTasksService, AIQuestionGeneratorService, SegmentQuestionGeneratorService],
  exports: [DailyTasksService, AIQuestionGeneratorService, SegmentQuestionGeneratorService],
})
export class TasksModule {}
