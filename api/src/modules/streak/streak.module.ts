import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { StreakService } from './streak.service';
import { StreakController } from './streak.controller';
import { StreakCronService } from './streak-cron.service';
import { StreakMigrationService } from './streak-migration.service';
import {
  UserStreak,
  UserStreakSchema,
} from './schemas/user-streak.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

/**
 * StreakModule — streak tracking and management
 *
 * Provides:
 *   - StreakController: REST API (GET /api/streak/me, POST /api/streak/freeze)
 *   - StreakService: core streak engine (state machine, freeze, milestones)
 *   - StreakCronService: scheduled jobs (midnight check, notifications)
 *
 * Exports:
 *   - StreakService: for use by other modules (telegram, leaderboard, gamification)
 *
 * Dependencies:
 *   - MongooseModule (UserStreak schema)
 *   - ConfigModule (feature flags)
 *   - EventEmitterModule (global, already registered in app.module)
 *   - Redis (global, already registered in app.module)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserStreak.name, schema: UserStreakSchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
  ],
  controllers: [StreakController],
  providers: [StreakService, StreakCronService, StreakMigrationService],
  exports: [StreakService],
})
export class StreakModule {}
