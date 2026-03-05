import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserStreakDocument = UserStreak & Document;

/**
 * Streak State Machine:
 *
 *   INACTIVE ──(first activity)──▶ ACTIVE(1)
 *   ACTIVE(N) ──(next day activity)──▶ ACTIVE(N+1)
 *   ACTIVE(N) ──(18:00 no activity)──▶ AT_RISK(N)
 *   AT_RISK(N) ──(activity same day)──▶ ACTIVE(N)   [streak preserved]
 *   AT_RISK(N) ──(midnight, has freeze)──▶ FROZEN(N)
 *   AT_RISK(N) ──(midnight, no freeze)──▶ BROKEN(0)
 *   FROZEN(N) ──(next day activity)──▶ ACTIVE(N+1)
 *   FROZEN(N) ──(next day midnight, no activity)──▶ BROKEN(0)
 *   BROKEN(0) ──(activity)──▶ ACTIVE(1)
 */
export const STREAK_STATES = [
  'inactive',
  'active',
  'at_risk',
  'frozen',
  'broken',
] as const;
export type StreakState = (typeof STREAK_STATES)[number];

/**
 * Streak milestone thresholds
 */
export const STREAK_MILESTONES = [7, 14, 30, 60, 90, 180, 365] as const;
export type StreakMilestoneDay = (typeof STREAK_MILESTONES)[number];

/**
 * Milestone sub-document
 */
@Schema({ _id: false })
export class StreakMilestone {
  /** Milestone day count (7, 14, 30, etc.) */
  @Prop({ required: true })
  days: number;

  /** When this milestone was achieved */
  @Prop({ required: true, type: Date })
  achievedAt: Date;

  /** Whether the user has claimed the reward */
  @Prop({ default: false })
  rewardClaimed: boolean;
}

export const StreakMilestoneSchema =
  SchemaFactory.createForClass(StreakMilestone);

/**
 * UserStreak — separate collection for streak tracking
 *
 * Replaces embedded User.dailyTasks.currentStreak/longestStreak.
 * Supports state machine, freeze, milestones, and badges.
 */
@Schema({ timestamps: true, collection: 'userstreaks' })
export class UserStreak {
  /** Reference to User document */
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId;

  /** Telegram ID for quick lookup (denormalized) */
  @Prop({ index: true })
  telegramId?: number;

  /** Current consecutive streak days */
  @Prop({ default: 0 })
  currentStreak: number;

  /** Longest streak ever achieved */
  @Prop({ default: 0 })
  longestStreak: number;

  /** Current state in the streak state machine */
  @Prop({
    enum: STREAK_STATES,
    default: 'inactive',
    index: true,
  })
  state: StreakState;

  /** Last day user completed a qualifying activity (Tashkent date, midnight UTC equivalent) */
  @Prop({ type: Date })
  lastActivityDate?: Date;

  /** Type of last activity that counted */
  @Prop({ enum: ['daily_task', 'irs_test'], default: 'daily_task' })
  lastActivityType: string;

  // ─── Freeze ────────────────────────────────────────────────

  /** Remaining freeze uses this month (Pro: 2, Elite: 3) */
  @Prop({ default: 0 })
  freezesRemaining: number;

  /** Dates when freezes were used (for audit trail) */
  @Prop({ type: [Date], default: [] })
  freezeUsedDates: Date[];

  /** Number of freezes used this month (reset on 1st of each month) */
  @Prop({ default: 0 })
  freezesUsedThisMonth: number;

  /** Month key for freeze reset tracking (e.g. "2025-06") */
  @Prop()
  freezeResetMonth?: string;

  // ─── Milestones & Badges ────────────────────────────────────

  /** Achieved streak milestones */
  @Prop({ type: [StreakMilestoneSchema], default: [] })
  milestones: StreakMilestone[];

  /** Badge IDs earned by this user */
  @Prop({ type: [String], default: [] })
  badges: string[];

  // ─── Lifetime Stats ─────────────────────────────────────────

  /** Total number of active days (lifetime) */
  @Prop({ default: 0 })
  totalActiveDays: number;

  /** Total number of streaks started (lifetime) */
  @Prop({ default: 0 })
  totalStreaksStarted: number;

  /** Total number of streaks broken (lifetime) */
  @Prop({ default: 0 })
  totalStreaksBroken: number;
}

export const UserStreakSchema = SchemaFactory.createForClass(UserStreak);

// Indexes
UserStreakSchema.index(
  { state: 1, lastActivityDate: 1 },
  { name: 'streak_midnight_check_idx' },
);
UserStreakSchema.index(
  { currentStreak: -1 },
  { name: 'streak_ranking_idx' },
);
