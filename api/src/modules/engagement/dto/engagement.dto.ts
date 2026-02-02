import { NotificationTrigger } from '../schemas/notification-log.schema';

/**
 * DTO for creating a new notification log entry
 */
export interface CreateNotificationLogDto {
  /** MongoDB ObjectId as string */
  userId: string;
  /** Telegram user ID */
  telegramId: number;
  /** What triggered this notification */
  trigger: NotificationTrigger;
  /** The actual message content */
  content: string;
  /** Optional metadata for analytics */
  metadata?: {
    aiGenerated?: boolean;
    aiModel?: string;
    tokensUsed?: number;
    consecutiveIgnoresAtSend?: number;
    language?: string;
    context?: Record<string, any>;
  };
}

/**
 * User context for AI message generation
 */
export interface EngagementUserContext {
  /** User's display name */
  firstName: string;
  /** User's preferred language (uz, ru, en) */
  language: string;
  /** Days since last bot activity */
  daysSinceActive: number;
  /** User's average interview score (0-100) */
  averageScore: number;
  /** Whether user has a paused interview */
  hasPausedInterview: boolean;
  /** Technology/domain of paused interview */
  pausedInterviewTechnology?: string;
  /** User's last interview technology */
  lastTechnology?: string;
  /** Number of completed interviews */
  completedInterviews: number;
  /** User's current subscription plan */
  subscriptionPlan: string;
  /** Days until trial expires (if applicable) */
  trialDaysRemaining?: number;
  /** Last 3 interview scores for trend analysis */
  recentScores?: number[];

  // Achievement trigger fields
  /** Type of achievement (e.g., "new_high_score", "10_interviews", "streak_7") */
  achievementType?: string;

  // Weekly progress trigger fields
  /** Number of interviews completed this week */
  weeklyInterviews?: number;
  /** User's strong areas based on this week's performance */
  strengths?: string[];
  /** Areas that need improvement */
  improvements?: string[];

  // First interview trigger fields
  /** Score from first interview */
  firstScore?: number;
}

/**
 * Result from AI message generation
 */
export interface GeneratedMessage {
  /** The generated message content */
  content: string;
  /** AI model used */
  model: string;
  /** Tokens used for generation */
  tokensUsed: number;
}

/**
 * Notification sending result
 */
export interface NotificationResult {
  success: boolean;
  logId?: string;
  error?: string;
  blocked?: boolean;
}
