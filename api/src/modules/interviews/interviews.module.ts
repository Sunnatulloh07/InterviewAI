import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { InterviewsFeedbackService } from './interviews-feedback.service';
import { InterviewsRepository } from './interviews.repository';
import { InterviewsController } from './interviews.controller';
import { InterviewSession, InterviewSessionSchema } from './schemas/interview-session.schema';
import { InterviewQuestion, InterviewQuestionSchema } from './schemas/interview-question.schema';
import { InterviewAnswer, InterviewAnswerSchema } from './schemas/interview-answer.schema';
import { AiModule } from '../ai/ai.module';
import { UsersModule } from '../users/users.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { QUEUE_INTERVIEW_FEEDBACK } from '@common/constants';
import { InterviewsService } from './interviews.service';
import { InterviewsProcessor } from './interviews.processor';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InterviewSession.name, schema: InterviewSessionSchema },
      { name: InterviewQuestion.name, schema: InterviewQuestionSchema },
      { name: InterviewAnswer.name, schema: InterviewAnswerSchema },
    ]),
    BullModule.registerQueue({
      name: QUEUE_INTERVIEW_FEEDBACK,
    }),
    ConfigModule,
    forwardRef(() => AiModule),
    UsersModule,
    AnalyticsModule,
  ],
  controllers: [InterviewsController],
  providers: [
    InterviewsService,
    InterviewsFeedbackService,
    InterviewsRepository,
    InterviewsProcessor,
  ],
  exports: [InterviewsService, InterviewsFeedbackService, InterviewsRepository],
})
export class InterviewsModule {}
