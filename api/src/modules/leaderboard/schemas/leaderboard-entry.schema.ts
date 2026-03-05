import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LeaderboardEntryDocument = LeaderboardEntry & Document;

/** Leaderboard period types */
export const LB_PERIODS = ['weekly', 'monthly', 'alltime'] as const;
export type LeaderboardPeriod = (typeof LB_PERIODS)[number];

/** Position categories for fair competition */
export const LB_POSITIONS = ['junior', 'middle', 'senior', 'lead'] as const;

/**
 * Point Breakdown sub-document
 */
@Schema({ _id: false })
export class PointBreakdown {
  /** Points from completing daily tasks (+10 each, max 30/day) */
  @Prop({ default: 0 })
  dailyTasks: number;

  /** Points from high-quality task answers (score >= 8, +5 each) */
  @Prop({ default: 0 })
  taskQuality: number;

  /** Points from streak continuation (+2/day) */
  @Prop({ default: 0 })
  streak: number;

  /** Points from completing mock interviews (+25 each) */
  @Prop({ default: 0 })
  mockInterview: number;

  /** Points from IRS test completion (+5, max 1/week) */
  @Prop({ default: 0 })
  irs: number;

  /** Points from confirmed referrals (+15 each, max 10/month) */
  @Prop({ default: 0 })
  referral: number;

  /** Bonus points (perfect score, etc.) */
  @Prop({ default: 0 })
  bonus: number;
}

export const PointBreakdownSchema =
  SchemaFactory.createForClass(PointBreakdown);

/**
 * LeaderboardEntry — one entry per user per period per position
 *
 * Examples:
 *   { userId: X, period: 'weekly', periodKey: '2025-W23', position: 'middle', points: 145 }
 *   { userId: X, period: 'alltime', periodKey: 'alltime', position: 'middle', points: 3200 }
 */
@Schema({ timestamps: true, collection: 'leaderboardentries' })
export class LeaderboardEntry {
  /** Reference to User */
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  /** Telegram ID for quick lookup (denormalized) */
  @Prop()
  telegramId?: number;

  /** Display name (denormalized for fast rendering) */
  @Prop()
  displayName?: string;

  /** Period type */
  @Prop({
    required: true,
    enum: LB_PERIODS,
  })
  period: LeaderboardPeriod;

  /** Period identifier: "2025-W23", "2025-06", "alltime" */
  @Prop({ required: true, index: true })
  periodKey: string;

  /** User's position category (juniors compete with juniors) */
  @Prop({
    required: true,
    enum: LB_POSITIONS,
  })
  position: string;

  /** Total points for this period */
  @Prop({ default: 0 })
  points: number;

  /** Detailed point breakdown */
  @Prop({ type: PointBreakdownSchema, default: () => ({}) })
  breakdown: PointBreakdown;

  /** Calculated rank in this period+position (1 = top) */
  @Prop()
  rank?: number;

  /** Current streak at time of last point update (for tiebreaking) */
  @Prop({ default: 0 })
  currentStreak: number;

  /** When points were last awarded (for tiebreaking) */
  @Prop({ type: Date, index: true })
  lastPointsAt?: Date;

  /** Points earned today (for daily cap enforcement: max 35/day) */
  @Prop({ default: 0 })
  pointsToday: number;

  /** Date key for daily cap reset (e.g. "2025-06-15") */
  @Prop()
  pointsTodayDate?: string;
}

export const LeaderboardEntrySchema =
  SchemaFactory.createForClass(LeaderboardEntry);

// Compound indexes for efficient queries
LeaderboardEntrySchema.index(
  { period: 1, periodKey: 1, position: 1, points: -1 },
  { name: 'leaderboard_ranking_idx' },
);
LeaderboardEntrySchema.index(
  { userId: 1, period: 1, periodKey: 1 },
  { name: 'user_period_lookup_idx', unique: true },
);
LeaderboardEntrySchema.index(
  { period: 1, periodKey: 1, position: 1, rank: 1 },
  { name: 'leaderboard_display_idx' },
);
