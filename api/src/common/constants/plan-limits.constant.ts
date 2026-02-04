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
    perMonth: number; // -1 = unlimited
    questionsPerInterview: number;
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
    monthlyAIReport?: boolean; // 🆕 Monthly AI analysis (Starter+)
    weeklyAIRecommendations?: boolean; // 🆕 Weekly tips (Pro+)
    weeklyRoadmap?: boolean; // 🆕 Career roadmap (Elite only)
    careerGrowthInsights?: boolean; // 🆕 Career analysis (Elite only)
    oneOnOneCoaching?: boolean; // Elite only
    prioritySupport?: boolean; // Elite only
    customInterviews?: boolean; // Elite only
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
   * 🆕 NEW STRUCTURE (2024):
   * - 1 mock interview (2 minutes voice limit)
   * - 1 CV analysis
   * - 0 real interview minutes
   * - NO daily tasks
   */
  free_trial: {
    voice: {
      mockVoice: 2, // 🔥 NEW: 5 → 2 minutes (1 short interview only)
      realVoice: 0, // NO real interview voice
    },

    mockInterviews: {
      perMonth: 1, // 🔥 NEW: 5 → 1 interview only (taste test)
      questionsPerInterview: 10,
    },

    cvAnalysis: {
      perMonth: 1, // Keep as 1
      maxFileSize: 5, // 5 MB max
      allowedFormats: ['pdf', 'docx', 'txt'],
    },

    dailyTasks: {
      enabled: false, // ❌ FREE TRIAL DOES NOT GET DAILY TASKS
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
  },

  /**
   * STARTER PLAN ($9.99/month)
   * Entry-level paid plan
   * 
   * 🆕 NEW STRUCTURE (2024):
   * - 1 daily task (not 3!) - cost optimization
   * - Monthly AI analysis (end of month report with feedback)
   * - 10 mock interviews
   * - 5 CV analyses
   * - Basic progress tracking
   */
  starter: {
    voice: {
      mockVoice: 10, // 10 minutes per month
      realVoice: 15, // 15 minutes real interview assistance
    },

    mockInterviews: {
      perMonth: 10, // 10 interviews
      questionsPerInterview: 15,
    },

    cvAnalysis: {
      perMonth: 5, // 5 analyses
      maxFileSize: 10, // 10 MB
      allowedFormats: ['pdf', 'docx', 'txt', 'rtf'],
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 1, // 🔥 NEW: 3 → 1 (cost optimization!)
      voiceAnswer: true, // ✅ Can answer with voice!
      imageAnswer: true, // ✅ Can answer with image!
      videoAnswer: false, // ❌ Video only in PRO+
      textAnswer: true,
    },

    fileUploads: {
      maxSize: 10, // 5 → 10 MB
      allowedTypes: ['text', 'pdf', 'docx', 'png', 'jpg', 'jpeg'],
      imagesAllowed: true,
      audioAllowed: false,
      videoAllowed: false,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true, // ✅ Detailed analysis enabled
      voiceExplanations: true, // ✅ Voice explanations enabled
      taskCompletionCheck: 'advanced', // Better AI checking
      progressTracking: 'basic', // Basic progress only
      monthlyAIReport: true, // 🔥 NEW: Monthly AI analysis report
    },
  },

  /**
   * PRO PLAN ($19.99/month)
   * Professional plan with advanced features
   * 
   * 🆕 NEW STRUCTURE (2024):
   * - 1 daily task (same as Starter but with better tracking)
   * - Daily progress tracking
   * - Weekly AI recommendations
   * - 30 mock interviews
   * - 15 CV analyses
   */
  pro: {
    voice: {
      mockVoice: 30, // 30 minutes per month
      realVoice: 45, // 45 minutes real interview
    },

    mockInterviews: {
      perMonth: 30, // 30 interviews
      questionsPerInterview: 20,
    },

    cvAnalysis: {
      perMonth: 15, // 15 analyses
      maxFileSize: 20, // 20 MB
      allowedFormats: ['pdf', 'docx', 'txt', 'rtf', 'odt'],
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 1, // 🔥 NEW: 5 → 1 (cost optimization!)
      voiceAnswer: true,
      imageAnswer: true,
      videoAnswer: false, // ❌ NO VIDEO - Too expensive for AI processing
      textAnswer: true,
    },

    fileUploads: {
      maxSize: 20, // 10 → 20 MB
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
        'ogg', // ❌ NO mp4 - video disabled
      ],
      imagesAllowed: true,
      audioAllowed: true, // ✅ Audio files enabled
      videoAllowed: false, // ❌ NO VIDEO - Token cost too high
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true,
      voiceExplanations: true,
      taskCompletionCheck: 'ai-powered', // Full AI analysis
      personalizedHints: true, // Custom hints
      progressTracking: 'advanced', // 🔥 Daily progress tracking
      weeklyAIRecommendations: true, // 🔥 NEW: Weekly AI tips
      monthlyAIReport: true, // Monthly summary
    },
  },

  /**
   * ELITE PLAN ($29.99/month)
   * Premium plan with maximum features
   * 
   * 🆕 NEW STRUCTURE (2024):
   * - 2 daily tasks (more practice than Starter/Pro)
   * - Daily progress tracking
   * - Weekly AI roadmap recommendations
   * - Career growth insights
   * - Unlimited mock interviews
   * - Unlimited CV analyses
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

    cvAnalysis: {
      perMonth: -1, // UNLIMITED!
      maxFileSize: 50, // 50 MB
      allowedFormats: '*', // ALL formats
    },

    dailyTasks: {
      enabled: true,
      questionsPerDay: 2, // 🔥 NEW: 10 → 2 (cost optimization + better than Starter/Pro)
      voiceAnswer: true,
      imageAnswer: true,
      videoAnswer: false, // ❌ NO VIDEO - Too expensive for AI processing
      textAnswer: true,
      customQuestions: true, // ✅ Can request custom questions
    },

    fileUploads: {
      maxSize: 50, // 20 → 50 MB
      allowedTypes: '*', // ALL file types (except video)
      imagesAllowed: true,
      audioAllowed: true,
      videoAllowed: false, // ❌ NO VIDEO - Token cost too high
      documentsAllowed: true,
    },

    aiFeatures: {
      basicFeedback: true,
      detailedAnalysis: true,
      voiceExplanations: true,
      taskCompletionCheck: 'ai-powered',
      personalizedHints: true,
      progressTracking: 'advanced', // 🔥 Daily progress tracking
      weeklyAIRecommendations: true, // 🔥 Weekly AI tips
      weeklyRoadmap: true, // 🔥 NEW: Career roadmap recommendations
      monthlyAIReport: true, // 🔥 Detailed monthly report
      careerGrowthInsights: true, // 🔥 NEW: Career growth analysis
      oneOnOneCoaching: true, // ✅ Personal coaching
      prioritySupport: true, // ✅ Priority support
      customInterviews: true, // ✅ Custom interview creation
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
 * Type exports for type safety
 */
export type SubscriptionPlan = keyof typeof COMPLETE_PLAN_LIMITS;
export type AICheckLevel = 'basic' | 'advanced' | 'ai-powered';
export type ProgressTrackingLevel = 'basic' | 'advanced';
