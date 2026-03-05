/**
 * COMPLETE SUBSCRIPTION PLAN LIMITS
 *
 * This is the SINGLE SOURCE OF TRUTH for all plan-based feature limits.
 * Based on COMPLETE_PLAN_AUDIT.md specification.
 *
 * ⚠️ CRITICAL: All plan enforcement MUST reference this structure.
 * ⚠️ DO NOT hardcode limits elsewhere in the codebase.
 */

export interface PlanLimits {
  // Voice Quotas (minutes per month)
  voice: {
    mockVoice: number; // Voice quota for mock interview practice
    realVoice: number; // Voice quota for real interview assistance
  };

  // Mock Interview Limits
  mockInterviews: {
    perMonth: number; // -1 = unlimited (total across all types)
    questionsPerInterview: number;
  };

  // Mock Interview Type Limits (Phase 3: Enhanced Mock Interview)
  // These limits are WITHIN the total mockInterviews.perMonth cap
  mockInterviewTypes: {
    quickTechnical: number; // 15 min, 3 questions. -1 = unlimited
    fullTechnical: number; // 45 min, 5-6 questions. -1 = unlimited
    behavioral: number; // 30 min, 4 STAR questions. -1 = unlimited
    systemDesign: number; // 45 min, 2 SD problems. -1 = unlimited
    companySpecific: number; // 45 min, company format. -1 = unlimited
    fullStack: number; // 60 min, mixed. -1 = unlimited
  };

  // CV Analysis Limits
  cvAnalysis: {
    perMonth: number; // -1 = unlimited
    maxFileSize: number; // MB
    allowedFormats: string[] | '*';
  };

  // Daily Tasks Features
  dailyTasks: {
    enabled: boolean;
    questionsPerDay: number;
    voiceAnswer: boolean;
    imageAnswer: boolean;
    videoAnswer: boolean;
    textAnswer: boolean;
    customQuestions?: boolean; // Elite only
  };

  // File Upload Limits (general)
  fileUploads: {
    maxSize: number; // MB
    allowedTypes: string[] | '*';
    imagesAllowed: boolean;
    audioAllowed: boolean;
    videoAllowed: boolean;
    documentsAllowed?: boolean; // Elite only
  };

  // AI Features Level
  aiFeatures: {
    basicFeedback: boolean;
    detailedAnalysis: boolean;
    voiceExplanations: boolean;
    taskCompletionCheck: 'basic' | 'advanced' | 'ai-powered';
    personalizedHints?: boolean;
    progressTracking?: 'basic' | 'advanced';
    monthlyAIReport?: boolean; // Monthly AI analysis (Starter+)
    weeklyAIRecommendations?: boolean; // Weekly tips (Pro+)
    weeklyRoadmap?: boolean; // Career roadmap (Elite only)
    careerGrowthInsights?: boolean; // Career analysis (Elite only)
    oneOnOneCoaching?: boolean; // Elite only
    prioritySupport?: boolean; // Elite only
    customInterviews?: boolean; // Elite only
  };

  // --- Growth & Engagement Features ---

  // Interview Readiness Score (IRS) — free viral test
  irs: {
    enabled: boolean;
    maxTestsPerDay: number; // -1 = unlimited
  };

  // Streak System — daily activity tracking
  streakFreeze: {
    enabled: boolean;
    perMonth: number; // Freeze uses per month
  };

  // Leaderboard — competitive ranking
  leaderboard: {
    canView: boolean;
    canParticipate: boolean;
  };

  // Badges & Gamification
  badges: {
    level: 'basic' | 'full' | 'full_exclusive';
  };
}

/**
 * COMPLETE PLAN LIMITS - Matches COMPLETE_PLAN_AUDIT.md exactly
 */
export const COMPLETE_PLAN_LIMITS: Record<string, PlanLimits> = {
  /**
   * FREE TRIAL PLAN (7 days)
   * Default plan for new users
   *
   * - 1 mock interview (TEXT ONLY, no voice)
   * - 1 CV analysis
   * - 0 voice minutes (mock & real)
   * - NO daily tasks
   * - IRS: 3 tests/day (viral acquisition tool)
   * - Streak: basic (IRS-based only, no freeze)
   * - Leaderboard: view only
   * - AI model: z-ai/glm-4-32b (internal, not shown to users)
   */
  free_trial: {
    voice: {
      mockVoice: 0, // No voice in free trial (text only)
      realVoice: 0, // No real interview voice
    },

    mockInterviews: {
      perMonth: 1, // 1 mock interview (text only)
      questionsPerInterview: 10,
    },

    mockInterviewTypes: {
      quickTechnical: 1,
      fullTechnical: 0,
      behavioral: 0,
      systemDesign: 0,
      companySpecific: 0,
      fullStack: 0,
    },

    cvAnalysis: {
      perMonth: 1,
      maxFileSize: 5, // 5 MB max
      allowedFormats: ['pdf', 'docx', 'txt'],
    },

    dailyTasks: {
      enabled: false, // No daily tasks in free trial
      questionsPerDay: 0,
      voiceAnswer: false,
      imageAnswer: false,
      videoAnswer: false,
      textAnswer: false,
    },

    fileUploads: {
      maxSize: 5, // 5 MB
      allowedTypes: ['text', 'pdf', 'docx'],
      imagesAllowed: false,
      audioAllowed: false,
      videoAllowed: false,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: false,
      voiceExplanations: false,
      taskCompletionCheck: 'basic', // Simple keyword check
    },

    // --- Growth Features ---
    irs: {
      enabled: true, // IRS is FREE for everyone (viral acquisition)
      maxTestsPerDay: 3,
    },

    streakFreeze: {
      enabled: false,
      perMonth: 0,
    },

    leaderboard: {
      canView: true,
      canParticipate: false, // View only for free users
    },

    badges: {
      level: 'basic' as const,
    },
  },

  /**
   * STARTER PLAN ($5/month)
   * Entry-level paid plan
   *
   * - 1 daily task (cost optimization)
   * - Monthly AI report
   * - 2 mock interviews (quick only), 5 CV analyses
   * - 10 min mockVoice, 15 min realVoice
   * - Basic progress tracking
   * - Full streak (no freeze), leaderboard participation
   */
  starter: {
    voice: {
      mockVoice: 10, // 10 minutes per month
      realVoice: 15, // 15 minutes real interview assistance
    },

    mockInterviews: {
      perMonth: 2, // 2 interviews total (price $10→$5, limits adjusted)
      questionsPerInterview: 15,
    },

    mockInterviewTypes: {
      quickTechnical: 2, // Only quick technical interviews
      fullTechnical: 0,
      behavioral: 0,
      systemDesign: 0,
      companySpecific: 0,
      fullStack: 0,
    },

    cvAnalysis: {
      perMonth: 5, // 5 analyses
      maxFileSize: 10, // 10 MB
      allowedFormats: ['pdf', 'docx', 'txt', 'rtf'],
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 1, // 1 task/day (cost optimization)
      voiceAnswer: true,
      imageAnswer: true,
      videoAnswer: false,
      textAnswer: true,
    },

    fileUploads: {
      maxSize: 10, // 10 MB
      allowedTypes: ['text', 'pdf', 'docx', 'png', 'jpg', 'jpeg'],
      imagesAllowed: true,
      audioAllowed: false,
      videoAllowed: false,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true,
      voiceExplanations: true,
      taskCompletionCheck: 'advanced',
      progressTracking: 'basic',
      monthlyAIReport: true,
    },

    // --- Growth Features ---
    irs: {
      enabled: true,
      maxTestsPerDay: 3,
    },

    streakFreeze: {
      enabled: false, // No freeze for Starter
      perMonth: 0,
    },

    leaderboard: {
      canView: true,
      canParticipate: true, // Can compete in leaderboard
    },

    badges: {
      level: 'full' as const,
    },
  },

  /**
   * PRO PLAN ($15/month)
   * Professional plan with advanced features
   *
   * - 1 daily task (with daily progress tracking)
   * - Weekly AI recommendations
   * - 8 mock interviews (5 quick + 3 full), 15 CV analyses
   * - 30 min mockVoice, 45 min realVoice
   * - Streak freeze (2/month), full leaderboard
   */
  pro: {
    voice: {
      mockVoice: 30, // 30 minutes per month
      realVoice: 45, // 45 minutes real interview
    },

    mockInterviews: {
      perMonth: 8, // 8 interviews total (price $20→$15, limits adjusted)
      questionsPerInterview: 20,
    },

    mockInterviewTypes: {
      quickTechnical: 5, // 5 quick technical
      fullTechnical: 3, // 3 full technical
      behavioral: 3, // 3 behavioral (shares with fullTechnical cap)
      systemDesign: 0,
      companySpecific: 0,
      fullStack: 0,
    },

    cvAnalysis: {
      perMonth: 15, // 15 analyses
      maxFileSize: 20, // 20 MB
      allowedFormats: ['pdf', 'docx', 'txt', 'rtf', 'odt'],
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 1, // 1 task/day (cost optimization)
      voiceAnswer: true,
      imageAnswer: true,
      videoAnswer: false,
      textAnswer: true,
    },

    fileUploads: {
      maxSize: 20, // 20 MB
      allowedTypes: [
        'text',
        'pdf',
        'docx',
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp',
        'mp3',
        'wav',
        'ogg',
      ],
      imagesAllowed: true,
      audioAllowed: true,
      videoAllowed: false,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true,
      voiceExplanations: true,
      taskCompletionCheck: 'ai-powered',
      personalizedHints: true,
      progressTracking: 'advanced',
      weeklyAIRecommendations: true,
      monthlyAIReport: true,
    },

    // --- Growth Features ---
    irs: {
      enabled: true,
      maxTestsPerDay: 3,
    },

    streakFreeze: {
      enabled: true, // Pro gets streak freeze
      perMonth: 2,
    },

    leaderboard: {
      canView: true,
      canParticipate: true,
    },

    badges: {
      level: 'full' as const,
    },
  },

  /**
   * ELITE PLAN ($30/month)
   * Premium plan with maximum features
   *
   * - 2 daily tasks
   * - Weekly AI roadmap, career growth insights
   * - Unlimited mock interviews (all types), unlimited CV analyses
   * - 60 min mockVoice, 120 min realVoice
   * - Streak freeze (3/month), full leaderboard, exclusive badges
   */
  elite: {
    voice: {
      mockVoice: 60, // 60 minutes per month
      realVoice: 120, // 120 minutes real interview
    },

    mockInterviews: {
      perMonth: -1, // UNLIMITED!
      questionsPerInterview: 30,
    },

    mockInterviewTypes: {
      quickTechnical: -1, // Unlimited
      fullTechnical: -1,
      behavioral: -1,
      systemDesign: -1,
      companySpecific: -1, // Elite-exclusive
      fullStack: -1,
    },

    cvAnalysis: {
      perMonth: -1, // UNLIMITED!
      maxFileSize: 50, // 50 MB
      allowedFormats: '*', // ALL formats
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 2, // 2 tasks/day (better than Starter/Pro)
      voiceAnswer: true,
      imageAnswer: true,
      videoAnswer: false,
      textAnswer: true,
      customQuestions: true,
    },

    fileUploads: {
      maxSize: 50, // 50 MB
      allowedTypes: '*', // ALL file types (except video)
      imagesAllowed: true,
      audioAllowed: true,
      videoAllowed: false,
      documentsAllowed: true,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true,
      voiceExplanations: true,
      taskCompletionCheck: 'ai-powered',
      personalizedHints: true,
      progressTracking: 'advanced',
      weeklyAIRecommendations: true,
      weeklyRoadmap: true,
      monthlyAIReport: true,
      careerGrowthInsights: true,
      oneOnOneCoaching: true,
      prioritySupport: true,
      customInterviews: true,
    },

    // --- Growth Features ---
    irs: {
      enabled: true,
      maxTestsPerDay: -1, // Unlimited for Elite
    },

    streakFreeze: {
      enabled: true, // Elite gets streak freeze
      perMonth: 3, // 3 freezes per month
    },

    leaderboard: {
      canView: true,
      canParticipate: true,
    },

    badges: {
      level: 'full_exclusive' as const, // Exclusive badges for Elite
    },
  },
};

/**
 * Helper function to get plan limits
 */
export function getPlanLimits(plan: string): PlanLimits {
  return COMPLETE_PLAN_LIMITS[plan] || COMPLETE_PLAN_LIMITS.free_trial;
}

/**
 * Helper function to check if plan allows a feature
 */
export function canUseDailyTaskVoiceAnswer(plan: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.dailyTasks.enabled && limits.dailyTasks.voiceAnswer;
}

export function canUseDailyTaskImageAnswer(plan: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.dailyTasks.enabled && limits.dailyTasks.imageAnswer;
}

export function canUseDailyTaskVideoAnswer(plan: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.dailyTasks.enabled && limits.dailyTasks.videoAnswer;
}

/**
 * Helper function to get mock interview monthly limit
 */
export function getMockInterviewMonthlyLimit(plan: string): number {
  const limits = getPlanLimits(plan);
  return limits.mockInterviews.perMonth;
}

/**
 * Helper function to get CV analysis monthly limit
 */
export function getCvAnalysisMonthlyLimit(plan: string): number {
  const limits = getPlanLimits(plan);
  return limits.cvAnalysis.perMonth;
}

/**
 * Helper: Get mock interview type limit
 */
export function getMockInterviewTypeLimit(
  plan: string,
  type: keyof PlanLimits['mockInterviewTypes'],
): number {
  const limits = getPlanLimits(plan);
  return limits.mockInterviewTypes[type];
}

/**
 * Helper: Check if plan has streak freeze enabled
 */
export function canUseStreakFreeze(plan: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.streakFreeze.enabled && limits.streakFreeze.perMonth > 0;
}

/**
 * Helper: Get streak freeze count per month
 */
export function getStreakFreezeLimit(plan: string): number {
  const limits = getPlanLimits(plan);
  return limits.streakFreeze.perMonth;
}

/**
 * Helper: Check if plan can participate in leaderboard
 */
export function canParticipateInLeaderboard(plan: string): boolean {
  const limits = getPlanLimits(plan);
  return limits.leaderboard.canParticipate;
}

/**
 * Helper: Get IRS daily test limit
 */
export function getIrsMaxTestsPerDay(plan: string): number {
  const limits = getPlanLimits(plan);
  return limits.irs.maxTestsPerDay;
}

/**
 * Helper: Get badge level for plan
 */
export function getBadgeLevel(plan: string): PlanLimits['badges']['level'] {
  const limits = getPlanLimits(plan);
  return limits.badges.level;
}

/**
 * Type exports for type safety
 */
export type SubscriptionPlan = keyof typeof COMPLETE_PLAN_LIMITS;
export type AICheckLevel = 'basic' | 'advanced' | 'ai-powered';
export type ProgressTrackingLevel = 'basic' | 'advanced';
export type BadgeLevel = 'basic' | 'full' | 'full_exclusive';
export type MockInterviewType = keyof PlanLimits['mockInterviewTypes'];
