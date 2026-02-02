import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '@common/enums/user-role.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  // Phone number as primary identifier (Telegram-based auth)
  @Prop({ required: true, unique: true, index: true, trim: true })
  phoneNumber: string;

  @Prop({ default: false })
  phoneVerified: boolean;

  // OTP for phone verification
  @Prop({ select: false })
  otpCode?: string;

  @Prop()
  otpExpires?: Date;

  @Prop({ default: 0 })
  otpAttempts: number;

  // Telegram integration (required for this app)
  @Prop({ required: true, unique: true, index: true })
  telegramId: number;

  @Prop()
  telegramUsername?: string;

  @Prop()
  telegramFirstName?: string;

  @Prop()
  telegramLastName?: string;

  // User profile
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  avatar?: string;

  @Prop({ maxlength: 500 })
  bio?: string;

  // Optional email for secondary communication
  @Prop({ unique: true, sparse: true, lowercase: true, trim: true })
  email?: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
    index: true,
  })
  role: UserRole;

  // Language preference
  @Prop({ default: 'uz' })
  language: string;

  // Subscription - Plans: free_trial (7 days), starter, pro, elite
  @Prop({
    type: Object,
    default: () => {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      return {
        plan: 'free_trial',
        status: 'trialing',
        startDate: now,
        trialStartDate: now,
        trialEndsAt: trialEnd,
      };
    },
  })
  subscription: {
    plan: 'free_trial' | 'starter' | 'pro' | 'elite';
    status: 'trialing' | 'active' | 'expired' | 'cancelled';
    startDate: Date;
    endDate?: Date;
    trialStartDate?: Date;
    trialEndsAt?: Date;
    billingCycle?: 'monthly' | 'annual';
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    cancelAtPeriodEnd?: boolean;
  };

  // Preferences (TZ compliant - includes language and email notification)
  @Prop({
    type: Object,
    default: () => ({
      language: 'uz',
      notifications: {
        email: false, // TZ compliance
        telegram: true,
        push: false,
      },
      interviewSettings: {
        answerStyle: 'balanced',
        answerLength: 'medium',
        autoTranscribe: true,
      },
      privacy: {
        saveHistory: true,
        shareAnalytics: false,
      },
    }),
  })
  preferences: {
    language: string;
    notifications: {
      email: boolean; // TZ compliance
      telegram: boolean;
      push: boolean;
    };
    interviewSettings: {
      answerStyle: 'professional' | 'balanced' | 'simple';
      answerLength: 'short' | 'medium' | 'long';
      autoTranscribe: boolean;
    };
    privacy: {
      saveHistory: boolean;
      shareAnalytics: boolean;
    };
  };

  // Usage tracking - includes live interview minutes
  @Prop({
    type: Object,
    default: () => ({
      mockInterviewsThisMonth: 0,
      liveInterviewMinutesThisMonth: 0,
      cvAnalysesThisMonth: 0,
      chromeQuestionsThisMonth: 0,
      aiTokensThisMonth: 0,
      lastResetDate: new Date(),
    }),
  })
  usage: {
    mockInterviewsThisMonth: number;
    liveInterviewMinutesThisMonth: number;
    cvAnalysesThisMonth: number;
    chromeQuestionsThisMonth: number;
    aiTokensThisMonth: number;
    lastResetDate: Date;
  };

  // Voice quota tracking (separate for mock practice vs real interview help)
  @Prop({
    type: Object,
    default: () => ({
      mockVoice: {
        total: 5,
        used: 0,
        remaining: 5,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      realVoice: {
        total: 0,
        used: 0,
        remaining: 0,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    }),
  })
  voiceQuota: {
    mockVoice: { total: number; used: number; remaining: number; resetDate: Date };
    realVoice: { total: number; used: number; remaining: number; resetDate: Date };
  };

  // User profile for personalized interview experience
  @Prop({
    type: Object,
    default: () => ({
      position: 'junior',
      goal: 'job_search',
      techStack: [],
    }),
  })
  profile: {
    position: 'junior' | 'middle' | 'senior' | 'lead';
    goal: 'job_search' | 'career_growth' | 'learning';
    techStack: string[];
  };

  // Daily tasks tracking
  @Prop({
    type: Object,
    default: () => ({
      currentStreak: 0,
      longestStreak: 0,
      totalCompleted: 0,
    }),
  })
  dailyTasks: {
    currentStreak: number;
    longestStreak: number;
    totalCompleted: number;
  };

  // Account management
  @Prop()
  lastLoginAt?: Date;

  // Trial notification tracking (to prevent duplicate notifications)
  @Prop()
  lastTrialNotificationDate?: Date;

  // Trial expired notification tracking
  @Prop()
  trialExpiredNotifiedAt?: Date;

  // Limit exhausted notification tracking
  @Prop()
  limitExhaustedNotifiedAt?: Date;

  @Prop({ index: true })
  deletedAt?: Date;

  // Blocking
  @Prop({ default: false })
  isBlocked: boolean;

  @Prop()
  blockReason?: string;

  @Prop()
  blockedAt?: Date;

  @Prop()
  blockedBy?: number;

  /**
   * Engagement tracking for Smart Assistant notifications
   * Used to send personalized reminders, motivations, and progress updates
   */
  @Prop({
    type: Object,
    default: () => ({
      lastActiveAt: new Date(),
      lastNotificationSentAt: null,
      lastNotificationRespondedAt: null,
      consecutiveIgnores: 0,
      nextNotificationAt: null,
      isBotBlocked: false,
      botBlockedAt: null,
      notificationsPaused: false,
      notificationsPausedUntil: null,
      // User segmentation survey fields
      jobSeekingStatus: 'not_set',
      surveyCompletedAt: null,
      scheduledSurveyAt: null,
      // Position completion tracking
      positionConfirmed: false,
      scheduledPositionPromptAt: null,
    }),
  })
  engagement: {
    /** Last time user interacted with the bot */
    lastActiveAt: Date;
    /** When we last sent a notification to this user */
    lastNotificationSentAt: Date | null;
    /** When user responded to our notification (within 24h window) */
    lastNotificationRespondedAt: Date | null;
    /** Count of consecutive notifications without response (for backoff) */
    consecutiveIgnores: number;
    /** Scheduled time for next notification (calculated by backoff algorithm) */
    nextNotificationAt: Date | null;
    /** Whether user has blocked the bot (detected via Telegram API error) */
    isBotBlocked: boolean;
    /** When user blocked the bot */
    botBlockedAt: Date | null;
    /** User opted out via /stop command */
    notificationsPaused: boolean;
    /** If paused temporarily, when to resume */
    notificationsPausedUntil: Date | null;
    /** User's current job-seeking status for personalized engagement */
    jobSeekingStatus: 'actively_looking' | 'preparing' | 'learning' | 'employed' | 'not_set';
    /** When user completed the onboarding survey */
    surveyCompletedAt: Date | null;
    /** Scheduled time for onboarding survey (3-4h after registration) */
    scheduledSurveyAt: Date | null;
    /** Whether user has manually confirmed their position (not default) */
    positionConfirmed: boolean;
    /** Scheduled time for position prompt (4h after registration if still default) */
    scheduledPositionPromptAt: Date | null;
  };

  // Virtual property
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  // Timestamps (automatically added by timestamps: true)
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
// Note: phoneNumber and telegramId already have index: true in @Prop
// Only add composite indexes here
UserSchema.index({ phoneNumber: 1, deletedAt: 1 });
UserSchema.index({ telegramId: 1, deletedAt: 1 });
UserSchema.index({ createdAt: -1 });

// Engagement indexes for notification scheduling
UserSchema.index({
  'engagement.nextNotificationAt': 1,
  'engagement.isBotBlocked': 1,
  'engagement.notificationsPaused': 1,
});
UserSchema.index({ 'engagement.lastActiveAt': 1 });

// Survey scheduling index (for cron job queries)
UserSchema.index({ 'engagement.scheduledSurveyAt': 1, 'engagement.surveyCompletedAt': 1 });

// Position prompt scheduling index (for cron job queries)
UserSchema.index({ 
  'engagement.scheduledPositionPromptAt': 1, 
  'engagement.positionConfirmed': 1,
  'profile.position': 1
});

// Job seeker engagement index
UserSchema.index({ 'engagement.jobSeekingStatus': 1, 'engagement.lastActiveAt': 1 });

// CRITICAL: Trial user reminder indexes (for user-activation.service.ts queries)
// Index for finding trial users: status + plan + trialEndsAt + bot blocked flags
UserSchema.index({
  'subscription.status': 1,
  'subscription.plan': 1,
  'subscription.trialEndsAt': 1,
  isBlocked: 1,
  'engagement.isBotBlocked': 1,
});

// Index for lastTrialNotificationDate queries (prevent duplicate sends)
UserSchema.index({ lastTrialNotificationDate: 1 });

// CRITICAL: Inactivity tracking indexes (for inactivity-tracker.service)
// Index for finding inactive users by last active date
UserSchema.index({
  'engagement.lastActiveAt': 1,
  'engagement.isBotBlocked': 1,
  'engagement.notificationsPaused': 1,
});

// Index for inactivity reminder level queries
UserSchema.index({
  'engagement.inactiveReminderLevel': 1,
  'engagement.inactiveReminderSentAt': 1,
});

// Index for finding users who have never been active (createdAt = lastActiveAt)
UserSchema.index({
  'engagement.lastActiveAt': 1,
  createdAt: 1,
});

// Index for trial stats queries
UserSchema.index({
  'subscription.status': 1,
  'subscription.plan': 1,
  'usage.mockInterviewsThisMonth': 1,
});

// Virtual properties
UserSchema.virtual('fullName').get(function (this: UserDocument) {
  return `${this.firstName} ${this.lastName}`;
});

// JSON transformation
UserSchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret: any) {
    const obj: any = { ...ret };
    delete obj._id;
    delete obj.__v;
    delete obj.otpCode;
    delete obj.deletedAt;
    obj.id = _doc._id.toString();
    return obj;
  },
});

UserSchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret: any) {
    const obj: any = { ...ret };
    delete obj._id;
    delete obj.__v;
    delete obj.otpCode;
    obj.id = _doc._id.toString();
    return obj;
  },
});

// Pre-save middleware
UserSchema.pre('save', function (next) {
  const user = this as any;

  // Ensure defaults for new users
  if (user.isNew) {
    // Set trial subscription for new users (7 days)
    if (!user.subscription) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      user.subscription = {
        plan: 'free_trial',
        status: 'trialing',
        startDate: now,
        trialStartDate: now,
        trialEndsAt: trialEnd,
      };
    }

    // Initialize usage tracking
    if (!user.usage) {
      user.usage = {
        mockInterviewsThisMonth: 0,
        liveInterviewMinutesThisMonth: 0,
        cvAnalysesThisMonth: 0,
        chromeQuestionsThisMonth: 0,
        aiTokensThisMonth: 0,
        lastResetDate: new Date(),
      };
    }

    // Set default preferences if not provided (TZ compliant)
    if (!user.preferences) {
      user.preferences = {
        language: user.language || 'uz',
        notifications: {
          email: false,
          telegram: true,
          push: false,
        },
        interviewSettings: {
          answerStyle: 'balanced',
          answerLength: 'medium',
          autoTranscribe: true,
        },
        privacy: {
          saveHistory: true,
          shareAnalytics: false,
        },
      };
    }

    // CRITICAL: Initialize voice quota based on subscription plan
    if (!user.voiceQuota) {
      const plan = user.subscription?.plan || 'free_trial';
      const quotas: Record<string, { mock: number; real: number }> = {
        free_trial: { mock: 5, real: 0 },
        starter: { mock: 10, real: 15 },
        pro: { mock: 30, real: 45 },
        elite: { mock: 60, real: 120 },
      };
      const quota = quotas[plan] || quotas.free_trial;
      const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

      user.voiceQuota = {
        mockVoice: {
          total: quota.mock,
          used: 0,
          remaining: quota.mock,
          resetDate: nextMonth,
        },
        realVoice: {
          total: quota.real,
          used: 0,
          remaining: quota.real,
          resetDate: nextMonth,
        },
      };
    }

    // CRITICAL: Initialize user profile (defaults to junior)
    if (!user.profile) {
      user.profile = {
        position: 'junior',
        goal: 'job_search',
        techStack: [],
      };
    }

    // CRITICAL: Initialize daily tasks tracking
    if (!user.dailyTasks) {
      user.dailyTasks = {
        currentStreak: 0,
        longestStreak: 0,
        totalCompleted: 0,
      };
    }

    // Schedule onboarding survey for new users (3-4 hours after registration)
    // Only schedule if: 1) not yet scheduled, 2) not already completed, 3) user is new (no lastActiveAt set beyond initial creation)
    const isNewUser = !user.engagement?.surveyCompletedAt && !user.engagement?.scheduledSurveyAt;
    const hasNeverBeenScheduled = !user.engagement?.surveyCompletedAt; // Don't re-schedule if completed

    if (isNewUser && hasNeverBeenScheduled && this.isNew) {
      const surveyDelayHours = 3 + Math.random(); // 3-4 hours random
      const scheduledTime = new Date(Date.now() + surveyDelayHours * 60 * 60 * 1000);

      // Ensure survey is scheduled within allowed hours (09:00-21:00 UTC+5)
      const utcPlus5Hours = scheduledTime.getUTCHours() + 5;
      const localHour = utcPlus5Hours % 24;

      if (localHour < 9) {
        // Too early, schedule for 09:00 same day
        scheduledTime.setUTCHours(4, 0, 0, 0); // 09:00 UTC+5 = 04:00 UTC
      } else if (localHour >= 21) {
        // Too late, schedule for 09:00 next day
        scheduledTime.setDate(scheduledTime.getDate() + 1);
        scheduledTime.setUTCHours(4, 0, 0, 0);
      }

      if (!user.engagement) {
        user.engagement = {} as any;
      }
      user.engagement.scheduledSurveyAt = scheduledTime;
      
      // 🔧 FIX: Also schedule position prompt for 4h after registration
      // This will prompt user to confirm their real position if still default 'junior'
      const positionPromptDelayHours = 4 + Math.random() * 0.5; // 4-4.5 hours
      const positionPromptTime = new Date(Date.now() + positionPromptDelayHours * 60 * 60 * 1000);
      
      // Ensure position prompt is also within allowed hours
      const positionUtcPlus5Hours = positionPromptTime.getUTCHours() + 5;
      const positionLocalHour = positionUtcPlus5Hours % 24;
      
      if (positionLocalHour < 9) {
        positionPromptTime.setUTCHours(4, 0, 0, 0);
      } else if (positionLocalHour >= 21) {
        positionPromptTime.setDate(positionPromptTime.getDate() + 1);
        positionPromptTime.setUTCHours(4, 0, 0, 0);
      }
      
      user.engagement.scheduledPositionPromptAt = positionPromptTime;
      user.engagement.positionConfirmed = false; // Default position needs confirmation
    }

    // Initialize inactivity tracking fields for new users
    if (user.isNew && user.engagement) {
      user.engagement.inactiveReminderLevel = null;
      user.engagement.inactiveReminderSentAt = null;
      user.engagement.inactiveDaysCount = 0;
    }
  }

  next();
});
