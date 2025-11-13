import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { CvService } from './cv.service';
import { CvController } from './cv.controller';
import { CvRepository } from './cv.repository';
import { CvParserService } from './cv-parser.service';
import { CvProcessor } from './cv.processor';
import { Cv, CvSchema } from './schemas/cv.schema';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { QUEUE_CV_ANALYSIS } from '@common/constants';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Cv.name, schema: CvSchema }]),
    BullModule.registerQueue({
      name: QUEUE_CV_ANALYSIS,
    }),
    ConfigModule,
    StorageModule,
    UsersModule,
    AnalyticsModule,
  ],
  controllers: [CvController],
  providers: [CvService, CvRepository, CvParserService, CvProcessor],
  exports: [CvService, CvRepository],
})
export class CvModule {}
