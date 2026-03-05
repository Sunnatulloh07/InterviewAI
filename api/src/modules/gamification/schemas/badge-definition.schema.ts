import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BadgeDefinitionDocument = BadgeDefinition & Document;

/** Badge rarity levels */
export const BADGE_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const;
export type BadgeRarity = (typeof BADGE_RARITIES)[number];

/** Badge condition types */
export const BADGE_CONDITION_TYPES = [
  'streak',
  'score',
  'mock',
  'referral',
  'leaderboard',
  'irs',
  'special',
] as const;
export type BadgeConditionType = (typeof BADGE_CONDITION_TYPES)[number];

/**
 * BadgeDefinition — static badge catalog
 *
 * Seeded once, not user-specific. Users earn badges by meeting conditions.
 * Earned badge IDs are stored in UserStreak.badges[].
 */
@Schema({ collection: 'badgedefinitions' })
export class BadgeDefinition {
  /** Unique badge identifier (e.g. "week_warrior") */
  @Prop({ required: true, unique: true, index: true })
  badgeId: string;

  /** Display name */
  @Prop({ required: true })
  name: string;

  /** Emoji for display */
  @Prop({ required: true })
  emoji: string;

  /** Description of how to earn this badge */
  @Prop({ required: true })
  description: string;

  /** Rarity level */
  @Prop({ required: true, enum: BADGE_RARITIES })
  rarity: BadgeRarity;

  /** Condition to earn this badge */
  @Prop(
    raw({
      type: {
        type: String,
        enum: BADGE_CONDITION_TYPES,
        required: true,
      },
      threshold: { type: Number, required: true },
      extra: { type: Object },
    }),
  )
  condition: {
    type: BadgeConditionType;
    threshold: number;
    extra?: Record<string, any>;
  };

  /** Whether this badge is currently active/earnable */
  @Prop({ default: true })
  isActive: boolean;

  /** Sort order for display */
  @Prop({ default: 0 })
  sortOrder: number;
}

export const BadgeDefinitionSchema =
  SchemaFactory.createForClass(BadgeDefinition);

// ─── Default Badge Definitions (for seeding) ──────────────────

export const DEFAULT_BADGES: Omit<BadgeDefinition, keyof Document>[] = [
  // Streak badges
  {
    badgeId: 'first_flame',
    name: 'First Flame',
    emoji: '🔥',
    description: 'Start your first streak',
    rarity: 'common',
    condition: { type: 'streak', threshold: 1 },
    isActive: true,
    sortOrder: 1,
  },
  {
    badgeId: 'week_warrior',
    name: 'Week Warrior',
    emoji: '⚡',
    description: '7-day streak',
    rarity: 'common',
    condition: { type: 'streak', threshold: 7 },
    isActive: true,
    sortOrder: 2,
  },
  {
    badgeId: 'two_week_champion',
    name: 'Two Week Champion',
    emoji: '💪',
    description: '14-day streak',
    rarity: 'uncommon',
    condition: { type: 'streak', threshold: 14 },
    isActive: true,
    sortOrder: 3,
  },
  {
    badgeId: 'monthly_master',
    name: 'Monthly Master',
    emoji: '🏆',
    description: '30-day streak',
    rarity: 'rare',
    condition: { type: 'streak', threshold: 30 },
    isActive: true,
    sortOrder: 4,
  },
  {
    badgeId: 'consistency_king',
    name: 'Consistency King',
    emoji: '💎',
    description: '60-day streak',
    rarity: 'epic',
    condition: { type: 'streak', threshold: 60 },
    isActive: true,
    sortOrder: 5,
  },
  {
    badgeId: 'quarter_legend',
    name: 'Quarter Legend',
    emoji: '🌟',
    description: '90-day streak',
    rarity: 'epic',
    condition: { type: 'streak', threshold: 90 },
    isActive: true,
    sortOrder: 6,
  },
  {
    badgeId: 'half_year_hero',
    name: 'Half Year Hero',
    emoji: '🚀',
    description: '180-day streak',
    rarity: 'legendary',
    condition: { type: 'streak', threshold: 180 },
    isActive: true,
    sortOrder: 7,
  },
  {
    badgeId: 'interview_master',
    name: 'Interview Master',
    emoji: '👑',
    description: '365-day streak',
    rarity: 'legendary',
    condition: { type: 'streak', threshold: 365 },
    isActive: true,
    sortOrder: 8,
  },

  // Score badges
  {
    badgeId: 'perfect_score',
    name: 'Perfect Score',
    emoji: '🎯',
    description: 'Get 10/10 on a daily task',
    rarity: 'rare',
    condition: { type: 'score', threshold: 10 },
    isActive: true,
    sortOrder: 10,
  },
  {
    badgeId: 'perfect_week',
    name: 'Perfect Week',
    emoji: '⭐',
    description: '7 days with all tasks scored 8+',
    rarity: 'epic',
    condition: { type: 'score', threshold: 8, extra: { consecutiveDays: 7 } },
    isActive: true,
    sortOrder: 11,
  },

  // Mock badges
  {
    badgeId: 'ai_challenger',
    name: 'AI Challenger',
    emoji: '🤖',
    description: 'Complete your first Mock Interview',
    rarity: 'common',
    condition: { type: 'mock', threshold: 1 },
    isActive: true,
    sortOrder: 20,
  },

  // IRS badges
  {
    badgeId: 'readiness_tested',
    name: 'Readiness Tested',
    emoji: '🧪',
    description: 'Complete your first IRS test',
    rarity: 'common',
    condition: { type: 'irs', threshold: 1 },
    isActive: true,
    sortOrder: 30,
  },

  // Leaderboard badges
  {
    badgeId: 'top3_weekly',
    name: 'Top 3 Weekly',
    emoji: '🏅',
    description: 'Reach top 3 in weekly leaderboard',
    rarity: 'rare',
    condition: { type: 'leaderboard', threshold: 3, extra: { period: 'weekly' } },
    isActive: true,
    sortOrder: 40,
  },
  {
    badgeId: 'number1_monthly',
    name: '#1 Monthly',
    emoji: '👑',
    description: 'Reach #1 in monthly leaderboard',
    rarity: 'legendary',
    condition: { type: 'leaderboard', threshold: 1, extra: { period: 'monthly' } },
    isActive: true,
    sortOrder: 41,
  },

  // Referral badges
  {
    badgeId: 'social_butterfly',
    name: 'Social Butterfly',
    emoji: '📣',
    description: 'Refer 5 friends',
    rarity: 'uncommon',
    condition: { type: 'referral', threshold: 5 },
    isActive: true,
    sortOrder: 50,
  },
];
