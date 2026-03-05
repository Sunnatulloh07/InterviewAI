/**
 * Application Event Constants
 *
 * Central registry for all EventEmitter2 event names used across the application.
 * Events follow the pattern: domain.action (e.g., 'irs.test.completed')
 *
 * Usage:
 *   Emit:   this.eventEmitter.emit(APP_EVENTS.IRS_TEST_COMPLETED, payload)
 *   Listen: @OnEvent(APP_EVENTS.IRS_TEST_COMPLETED)
 */
export const APP_EVENTS = {
  // --- Interview Readiness Score (IRS) ---
  /** Fired when a user completes an IRS test (all 5 questions answered) */
  IRS_TEST_COMPLETED: 'irs.test.completed',

  // --- Daily Tasks ---
  /** Fired when a single daily task is completed (answer submitted + scored) */
  DAILY_TASK_COMPLETED: 'daily.task.completed',
  /** Fired when ALL assigned daily tasks for the day are completed */
  DAILY_TASKS_ALL_COMPLETED: 'daily.tasks.all_completed',

  // --- Streak ---
  /** Fired when a user's streak is incremented (new day activity recorded) */
  STREAK_UPDATED: 'streak.updated',
  /** Fired when a user's streak is broken (reset to 0) */
  STREAK_BROKEN: 'streak.broken',
  /** Fired when a user reaches a streak milestone (7, 14, 30, 60, 90, 180, 365) */
  STREAK_MILESTONE: 'streak.milestone',

  // --- Mock Interview ---
  /** Fired when a mock interview session is fully completed with feedback */
  MOCK_COMPLETED: 'mock.completed',

  // --- Leaderboard ---
  /** Fired when leaderboard ranks are recalculated (every 15 min via cron) */
  LEADERBOARD_RECALCULATED: 'leaderboard.recalculated',

  // --- Gamification ---
  /** Fired when a user earns a new badge */
  BADGE_EARNED: 'badge.earned',

  // --- Referral ---
  /** Fired when a referred user completes their first task (referral confirmed) */
  REFERRAL_CONFIRMED: 'referral.confirmed',
} as const;

/**
 * Event Payload Types
 *
 * TypeScript interfaces for event payloads to ensure type safety
 * between emitters and listeners.
 */

export interface IrsTestCompletedPayload {
  userId?: string; // null for anonymous users
  telegramId: number;
  testId: string;
  score: number; // 0-100
  categories: {
    technical: number;
    problemSolving: number;
    communication: number;
    behavioral: number;
    systemDesign: number;
  };
}

export interface DailyTaskCompletedPayload {
  userId: string;
  taskId: string;
  taskIndex: number;
  score: number; // 0-100
  taskType: 'technical' | 'behavioral' | 'system_design';
}

export interface DailyTasksAllCompletedPayload {
  userId: string;
  dailyTaskId: string;
  totalTasks: number;
  averageScore: number;
}

export interface StreakUpdatedPayload {
  userId: string;
  currentStreak: number;
  isNewMilestone: boolean;
  milestoneDay?: number; // 7, 14, 30, etc.
  activityType: 'daily_task' | 'irs_test';
}

export interface StreakBrokenPayload {
  userId: string;
  lostStreak: number; // The streak count that was lost
  reason: 'missed_day' | 'expired_freeze';
}

export interface StreakMilestonePayload {
  userId: string;
  milestoneDay: number; // 7, 14, 30, 60, 90, 180, 365
  currentStreak: number;
}

export interface MockCompletedPayload {
  userId: string;
  sessionId: string;
  score: number; // 0-100
  type: string; // interview type
  duration: number; // actual minutes
}

export interface LeaderboardRecalculatedPayload {
  period: 'weekly' | 'monthly' | 'alltime';
  periodKey: string; // e.g., "2025-W23"
  topUsers: Array<{
    userId: string;
    rank: number;
    points: number;
  }>;
}

export interface BadgeEarnedPayload {
  userId: string;
  badgeId: string;
  badgeName: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface ReferralConfirmedPayload {
  referrerId: string; // User who shared the referral
  referredUserId: string; // User who signed up via referral
}

/**
 * Union type of all event names for type-safe event registration
 */
export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];
