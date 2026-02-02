import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [MongooseModule, UsersModule, PaymentsModule, AnalyticsModule, VoiceModule],
  controllers: [AdminController],
  exports: [],
})
export class AdminModule {}
