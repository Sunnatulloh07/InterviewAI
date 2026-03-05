import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { ReadinessTestController } from './readiness-test.controller';
import { ReadinessTestService } from './readiness-test.service';
import { ReadinessTestScoringService } from './readiness-test-scoring.service';
import { TelegramReadinessService } from './telegram-readiness.service';
import {
  ReadinessTest,
  ReadinessTestSchema,
} from './schemas/readiness-test.schema';
import {
  IrsQuestion,
  IrsQuestionSchema,
} from './schemas/irs-question-pool.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReadinessTest.name, schema: ReadinessTestSchema },
      { name: IrsQuestion.name, schema: IrsQuestionSchema },
    ]),
    ConfigModule,
  ],
  controllers: [ReadinessTestController],
  providers: [
    ReadinessTestService,
    ReadinessTestScoringService,
    TelegramReadinessService,
  ],
  exports: [
    ReadinessTestService,
    TelegramReadinessService,
  ],
})
export class ReadinessTestModule {}
