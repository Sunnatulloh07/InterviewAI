import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AiSttService } from './ai-stt.service';
import { AiAnswerService } from './ai-answer.service';
import { AiContextService } from './ai-context.service';
import { AiRepository } from './ai.repository';
import { AiController } from './ai.controller';
import { AiSession, AiSessionSchema } from './schemas/ai-session.schema';
import { UsersModule } from '../users/users.module';
import { CvModule } from '../cv/cv.module';
import { InterviewsModule } from '../interviews/interviews.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AiSession.name, schema: AiSessionSchema }]),
    ConfigModule,
    CacheModule.register(),
    UsersModule,
    CvModule,
    forwardRef(() => InterviewsModule),
  ],
  controllers: [AiController],
  providers: [AiSttService, AiAnswerService, AiContextService, AiRepository],
  exports: [AiSttService, AiAnswerService, AiContextService, AiRepository],
})
export class AiModule {}
