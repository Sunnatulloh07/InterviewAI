import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { BadgeService } from './badge.service';
import {
  BadgeDefinition,
  BadgeDefinitionSchema,
} from './schemas/badge-definition.schema';
import {
  UserStreak,
  UserStreakSchema,
} from '../streak/schemas/user-streak.schema';

/**
 * GamificationModule — badges and gamification elements
 *
 * Provides:
 *   - BadgeService: badge awarding, seeding, event listeners
 *
 * Exports:
 *   - BadgeService: for use by telegram integration
 *
 * Dependencies:
 *   - MongooseModule (BadgeDefinition, UserStreak schemas)
 *   - ConfigModule (feature flags)
 *   - EventEmitterModule (global)
 *   - Redis (global)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BadgeDefinition.name, schema: BadgeDefinitionSchema },
      { name: UserStreak.name, schema: UserStreakSchema },
    ]),
    ConfigModule,
  ],
  providers: [BadgeService],
  exports: [BadgeService],
})
export class GamificationModule {}
