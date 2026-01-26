import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramVoiceService } from './telegram-voice.service';
import { TelegramLiveService } from './telegram-live.service';
import { TelegramSubscriptionService } from './telegram-subscription.service';
import { TrialNotificationService } from './trial-notification.service';
import { TelegramController } from './telegram.controller';
import { TelegramSession, TelegramSessionSchema } from './schemas/telegram-session.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { OtpModule } from '../otp/otp.module';
import { CvModule } from '../cv/cv.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelegramSession.name, schema: TelegramSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
    UsersModule,
    AiModule,
    InterviewsModule,
    OtpModule,
    CvModule,
    AnalyticsModule,
    PaymentsModule, // For SubscriptionService
  ],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramCommandsService,
    TelegramVoiceService,
    TelegramLiveService,
    TelegramSubscriptionService,
    TrialNotificationService,
  ],
  exports: [TelegramService, TelegramSubscriptionService, TrialNotificationService],
})
export class TelegramModule {}

