import { Module } from '@nestjs/common';
import { InactivityTrackerService } from './inactivity-tracker.service';

@Module({
  providers: [InactivityTrackerService],
  exports: [InactivityTrackerService],
})
export class InactivityModule {}
