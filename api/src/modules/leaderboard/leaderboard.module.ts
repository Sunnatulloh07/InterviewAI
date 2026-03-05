import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { LeaderboardService } from './leaderboard.service';
import { LeaderboardController } from './leaderboard.controller';
import { TelegramLeaderboardService } from './telegram-leaderboard.service';
import {
  LeaderboardEntry,
  LeaderboardEntrySchema,
} from './schemas/leaderboard-entry.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

/**
 * LeaderboardModule — competitive ranking system
 *
 * Provides:
 *   - LeaderboardController: REST API (GET /api/leaderboard/:period, GET /api/leaderboard/me)
 *   - LeaderboardService: point awarding, rank calculation, period management
 *   - TelegramLeaderboardService: bot UI for /leaderboard command
 *
 * Exports:
 *   - LeaderboardService: for use by telegram integration
 *   - TelegramLeaderboardService: for telegram command routing
 *
 * Dependencies:
 *   - MongooseModule (LeaderboardEntry, User schemas)
 *   - ConfigModule (feature flags, daily point cap)
 *   - EventEmitterModule (global)
 *   - Redis (global)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeaderboardEntry.name, schema: LeaderboardEntrySchema },
      { name: User.name, schema: UserSchema },
    ]),
    ConfigModule,
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, TelegramLeaderboardService],
  exports: [LeaderboardService, TelegramLeaderboardService],
})
export class LeaderboardModule {}
