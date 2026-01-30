import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceQuotaService } from './voice-quota.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { VoiceUsage, VoiceUsageSchema } from './schemas/voice-usage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: VoiceUsage.name, schema: VoiceUsageSchema },
    ]),
  ],
  providers: [VoiceQuotaService],
  exports: [VoiceQuotaService],
})
export class VoiceModule {}
