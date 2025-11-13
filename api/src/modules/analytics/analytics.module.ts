import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEvent, AnalyticsEventSchema } from './schemas/analytics-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AnalyticsEvent.name, schema: AnalyticsEventSchema }]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
