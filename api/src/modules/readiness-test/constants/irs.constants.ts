/**
 * IRS (Interview Readiness Score) Constants
 *
 * Kategoriyalar, vaznlar, difficulty distribution, va scoring parametrlari.
 */

/** IRS test har doim 5 ta savoldan iborat */
export const IRS_TOTAL_QUESTIONS = 5;

/** Har bir javob uchun vaqt limiti (soniyalarda) */
export const IRS_ANSWER_TIME_LIMIT = 60;

/** Savol kategoriyalari */
export const IRS_CATEGORIES = {
  TECHNICAL: 'technical',
  BEHAVIORAL: 'behavioral',
  PROBLEM_SOLVING: 'problemSolving',
  SYSTEM_DESIGN: 'systemDesign',
} as const;

export type IrsCategory = (typeof IRS_CATEGORIES)[keyof typeof IRS_CATEGORIES];

/**
 * Kategoriya taqsimoti: 5 ta savoldan
 * 2 technical + 1 behavioral + 1 problemSolving + 1 mixed (systemDesign yoki technical)
 */
export const IRS_CATEGORY_DISTRIBUTION: IrsCategory[] = [
  'technical',
  'technical',
  'behavioral',
  'problemSolving',
  'systemDesign', // yoki runtime da random 'technical' bo'lishi mumkin
];

/**
 * Kategoriya bo'yicha final skor vaznlari (jami = 100%)
 */
export const IRS_CATEGORY_WEIGHTS: Record<string, number> = {
  technical: 0.3, // 30%
  problemSolving: 0.25, // 25%
  communication: 0.2, // 20%
  behavioral: 0.15, // 15%
  systemDesign: 0.1, // 10%
};

/**
 * Har bir javobni baholash mezonlari va vaznlari
 */
export const IRS_SCORING_CRITERIA = {
  correctness: { weight: 0.35, min: 0, max: 10 },
  depth: { weight: 0.25, min: 0, max: 10 },
  communication: { weight: 0.2, min: 0, max: 10 },
  completeness: { weight: 0.1, min: 0, max: 10 },
  timeEfficiency: { weight: 0.1, min: 0, max: 10 },
} as const;

export type IrsScoringCriterion = keyof typeof IRS_SCORING_CRITERIA;

/**
 * Difficulty distribution — position bo'yicha
 * Har bir qiymat [easy%, medium%, hard%] nisbatini ko'rsatadi (jami = 1.0)
 */
export const IRS_DIFFICULTY_DISTRIBUTION: Record<
  string,
  { easy: number; medium: number; hard: number }
> = {
  junior: { easy: 0.6, medium: 0.3, hard: 0.1 },
  middle: { easy: 0.3, medium: 0.5, hard: 0.2 },
  senior: { easy: 0.1, medium: 0.4, hard: 0.5 },
  lead: { easy: 0.0, medium: 0.3, hard: 0.7 },
};

/** Qo'llab-quvvatlanadigan pozitsiyalar */
export const IRS_POSITIONS = ['junior', 'middle', 'senior', 'lead'] as const;
export type IrsPosition = (typeof IRS_POSITIONS)[number];

/** Qo'llab-quvvatlanadigan tech stacklar */
export const IRS_TECH_STACKS = [
  'javascript',
  'typescript',
  'python',
  'java',
  'csharp',
  'golang',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'rust',
  'react',
  'angular',
  'vue',
  'node',
  'django',
  'spring',
  'dotnet',
  'flutter',
  'react_native',
] as const;
export type IrsTechStack = (typeof IRS_TECH_STACKS)[number];

/** Difficulty darajalari */
export const IRS_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type IrsDifficulty = (typeof IRS_DIFFICULTIES)[number];

/** Test statuslari */
export const IRS_TEST_STATUSES = ['in_progress', 'completed', 'expired'] as const;
export type IrsTestStatus = (typeof IRS_TEST_STATUSES)[number];

/** Redis key prefikslari */
export const IRS_REDIS_KEYS = {
  /** Rate limit: irs:ratelimit:{telegramId} */
  RATE_LIMIT: 'irs:ratelimit:',
  /** Score cache: irs:score:{sha256(question+answer)} */
  SCORE_CACHE: 'irs:score:',
  /** Active session: irs:session:{telegramId} */
  ACTIVE_SESSION: 'irs:session:',
  /** Weekly stats cache */
  WEEKLY_STATS: 'irs:stats:weekly',
} as const;

/** Rate limit: testlar soni / vaqt oynasi */
export const IRS_RATE_LIMIT = {
  MAX_TESTS: 3, // Kuniga max 3 test (default, .env dan override)
  WINDOW_SECONDS: 86400, // 24 soat
} as const;

/** Score cache TTL */
export const IRS_SCORE_CACHE_TTL = 86400; // 24 soat

/** Anonim testlar TTL (30 kun) */
export const IRS_ANONYMOUS_TTL_DAYS = 30;

/** Session timeout (10 daqiqa) */
export const IRS_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

/** Oxirgi N ta testdagi savollarni exclude qilish */
export const IRS_EXCLUDE_RECENT_TESTS = 3;

/** Skor darajalari */
export const IRS_SCORE_GRADES = {
  EXCELLENT: { min: 85, label: 'A', emoji: '🌟' },
  GOOD: { min: 70, label: 'B+', emoji: '✅' },
  AVERAGE: { min: 55, label: 'B', emoji: '📊' },
  BELOW_AVERAGE: { min: 40, label: 'C', emoji: '⚠️' },
  NEEDS_WORK: { min: 0, label: 'D', emoji: '📚' },
} as const;

/**
 * Skor darajasini aniqlash
 */
export function getScoreGrade(score: number): {
  label: string;
  emoji: string;
  level: string;
} {
  if (score >= IRS_SCORE_GRADES.EXCELLENT.min)
    return { ...IRS_SCORE_GRADES.EXCELLENT, level: 'excellent' };
  if (score >= IRS_SCORE_GRADES.GOOD.min)
    return { ...IRS_SCORE_GRADES.GOOD, level: 'good' };
  if (score >= IRS_SCORE_GRADES.AVERAGE.min)
    return { ...IRS_SCORE_GRADES.AVERAGE, level: 'average' };
  if (score >= IRS_SCORE_GRADES.BELOW_AVERAGE.min)
    return { ...IRS_SCORE_GRADES.BELOW_AVERAGE, level: 'below_average' };
  return { ...IRS_SCORE_GRADES.NEEDS_WORK, level: 'needs_work' };
}
