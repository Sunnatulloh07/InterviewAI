import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramVoiceService } from './telegram-voice.service';
import { TelegramLiveService } from './telegram-live.service';
import { TelegramController } from './telegram.controller';
import { TelegramSession, TelegramSessionSchema } from './schemas/telegram-session.schema';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';
import { InterviewsModule } from '../interviews/interviews.module';
import { OtpModule } from '../otp/otp.module';
import { CvModule } from '../cv/cv.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TelegramSession.name, schema: TelegramSessionSchema }]),
    ConfigModule,
    UsersModule,
    AiModule,
    InterviewsModule,
    OtpModule,
    CvModule,
    AnalyticsModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramCommandsService, TelegramVoiceService, TelegramLiveService],
  exports: [TelegramService],
})
export class TelegramModule {}
