import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { DailyTasksService } from './daily-tasks.service';
import { AIQuestionGeneratorService } from './ai-question-generator.service';
import { SegmentQuestionGeneratorService } from './segment-question-generator.service';
import { QuestionPoolManagerService } from './question-pool-manager.service';
import { UserAwarePoolManagerService } from './user-aware-pool-manager.service'; // 🎯 NEW: User-aware pool manager
import { SafeQuestionProviderService } from './safe-question-provider.service';
import { PriorityQuestionProviderService } from './priority-question-provider.service';
import { TasksDebugController } from './tasks-debug.controller'; // 🔍 Debug controller
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
  controllers: [TasksDebugController], // 🔍 Debug endpoints
  providers: [
    DailyTasksService,
    AIQuestionGeneratorService,
    SegmentQuestionGeneratorService,
    QuestionPoolManagerService, // 🏭 Background question pool manager (general pool)
    UserAwarePoolManagerService, // 🎯 User-aware pool manager (tracks consumption)
    SafeQuestionProviderService, // 🛡️ Safe 3-level question provider
    PriorityQuestionProviderService, // 🎯 Priority-based provider (premium vs free)
  ],
  exports: [
    DailyTasksService,
    AIQuestionGeneratorService,
    SegmentQuestionGeneratorService,
    QuestionPoolManagerService,
    UserAwarePoolManagerService, // 🎯 Export for other modules
    SafeQuestionProviderService,
    PriorityQuestionProviderService,
  ],
})
export class TasksModule {}
