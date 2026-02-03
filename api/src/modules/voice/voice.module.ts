import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VoiceQuotaService } from './voice-quota.service';
import { VoiceQuotaGuardService } from './voice-quota-guard.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { VoiceUsage, VoiceUsageSchema } from './schemas/voice-usage.schema';
import { VoiceReservation, VoiceReservationSchema } from './schemas/voice-reservation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: VoiceUsage.name, schema: VoiceUsageSchema },
      { name: VoiceReservation.name, schema: VoiceReservationSchema },
    ]),
  ],
  providers: [VoiceQuotaService, VoiceQuotaGuardService],
  exports: [VoiceQuotaService, VoiceQuotaGuardService],
})
export class VoiceModule { }
