/**
 * Job Seeking Status Enum
 * Used for user segmentation and personalized engagement
 */
export enum JobSeekingStatus {
  /** User is actively searching for a job */
  ACTIVELY_LOOKING = 'actively_looking',
  /** User is preparing for interviews but not actively applying */
  PREPARING = 'preparing',
  /** User wants to improve skills without immediate job goals */
  LEARNING = 'learning',
  /** User has found employment */
  EMPLOYED = 'employed',
  /** User hasn't completed the onboarding survey yet */
  NOT_SET = 'not_set',
}

/**
 * Survey scheduling constants
 */
export const SURVEY_CONFIG = {
  /** Hours after registration to send onboarding survey */
  DELAY_HOURS_MIN: 3,
  DELAY_HOURS_MAX: 4,
  /** Allowed hours for survey delivery (local time, UTC+5) */
  ALLOWED_START_HOUR: 9,
  ALLOWED_END_HOUR: 21,
  /** How often to check for pending surveys (minutes) */
  CHECK_INTERVAL_MINUTES: 30,
} as const;
