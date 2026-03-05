/**
 * Mock Interview Constants
 *
 * Central configuration for the enhanced mock interview system.
 * Based on TZ section 6.
 */

// ─── Interview Types ─────────────────────────────────────────

export const MOCK_INTERVIEW_TYPES = [
  'quick_technical',
  'full_technical',
  'behavioral',
  'system_design',
  'company_specific',
  'full_stack',
] as const;

export type MockInterviewType = (typeof MOCK_INTERVIEW_TYPES)[number];

/**
 * Interview type configuration.
 *   duration: target minutes
 *   questionCount: number of main questions (before follow-ups)
 *   category: maps to InterviewQuestion.category
 */
export const MOCK_TYPE_CONFIG: Record<
  MockInterviewType,
  {
    label: string;
    labelUz: string;
    labelRu: string;
    duration: number;
    questionCount: number;
    category: string;
    description: string;
    descriptionUz: string;
    emoji: string;
  }
> = {
  quick_technical: {
    label: 'Quick Technical',
    labelUz: 'Tezkor texnik',
    labelRu: 'Быстрое техническое',
    duration: 15,
    questionCount: 3,
    category: 'technical',
    description: '15 min, 3 questions — fast technical screen',
    descriptionUz: '15 daqiqa, 3 savol — tezkor texnik tekshiruv',
    emoji: '⚡',
  },
  full_technical: {
    label: 'Full Technical',
    labelUz: 'To\'liq texnik',
    labelRu: 'Полное техническое',
    duration: 45,
    questionCount: 6,
    category: 'technical',
    description: '45 min, 5-6 questions — in-depth technical interview',
    descriptionUz: '45 daqiqa, 5-6 savol — chuqur texnik intervyu',
    emoji: '💻',
  },
  behavioral: {
    label: 'Behavioral',
    labelUz: 'Xulq-atvor',
    labelRu: 'Поведенческое',
    duration: 30,
    questionCount: 4,
    category: 'behavioral',
    description: '30 min, 4 STAR-format questions',
    descriptionUz: '30 daqiqa, 4 STAR-format savol',
    emoji: '🤝',
  },
  system_design: {
    label: 'System Design',
    labelUz: 'Tizim dizayni',
    labelRu: 'Системный дизайн',
    duration: 45,
    questionCount: 2,
    category: 'case_study',
    description: '45 min, 2 system design problems',
    descriptionUz: '45 daqiqa, 2 tizim dizayni masalasi',
    emoji: '🏗️',
  },
  company_specific: {
    label: 'Company-Specific',
    labelUz: 'Kompaniyaga mos',
    labelRu: 'Под компанию',
    duration: 45,
    questionCount: 5,
    category: 'mixed',
    description: '45 min, company-format interview',
    descriptionUz: '45 daqiqa, kompaniya formatidagi intervyu',
    emoji: '🏢',
  },
  full_stack: {
    label: 'Full Stack',
    labelUz: 'Full Stack',
    labelRu: 'Full Stack',
    duration: 60,
    questionCount: 6,
    category: 'mixed',
    description: '60 min, mixed frontend + backend + system design',
    descriptionUz: '60 daqiqa, frontend + backend + dizayn aralash',
    emoji: '🔄',
  },
};

// ─── Interview State Machine ─────────────────────────────────

export const MOCK_STATES = [
  'created',
  'intro',
  'questioning',
  'follow_up',
  'wrap_up',
  'scoring',
  'completed',
  'cancelled',
] as const;

export type MockState = (typeof MOCK_STATES)[number];

// ─── Company Templates ───────────────────────────────────────

export interface CompanyTemplate {
  id: string;
  name: string;
  emoji: string;
  rounds: number;
  focus: string[];
  focusUz: string;
  description: string;
  descriptionUz: string;
  questionStyle: string; // Injected into AI prompt
}

export const COMPANY_TEMPLATES: CompanyTemplate[] = [
  {
    id: 'google',
    name: 'Google',
    emoji: '🟢',
    rounds: 5,
    focus: ['algorithms', 'system design', 'behavioral'],
    focusUz: 'Algoritmlar, scalability, muammoni hal qilish',
    description: 'Google-style: coding + system design + behavioral',
    descriptionUz: 'Google uslubi: coding + tizim dizayni + xulq-atvor',
    questionStyle:
      'Ask questions in Google interview style. Focus on algorithms, data structures, ' +
      'system design for scale, and Googleyness (leadership, collaboration). ' +
      'Include at least 1 coding problem that requires optimal time complexity analysis.',
  },
  {
    id: 'epam',
    name: 'EPAM Systems',
    emoji: '🔵',
    rounds: 3,
    focus: ['frameworks', 'teamwork', 'practical'],
    focusUz: 'Java/JS frameworklar, jamoaviy ish, amaliy tajriba',
    description: 'EPAM-style: tech screen + coding + behavioral',
    descriptionUz: 'EPAM uslubi: texnik + coding + jamoaviy ish',
    questionStyle:
      'Ask questions in EPAM Systems interview style. Focus on practical framework knowledge, ' +
      'teamwork and collaboration scenarios, and real-world project experience. ' +
      'Include questions about Agile/Scrum methodology and cross-team communication.',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    emoji: '🟠',
    rounds: 6,
    focus: ['leadership principles', 'system design', 'coding'],
    focusUz: 'Leadership Principles, scalability, coding',
    description: 'Amazon-style: LP-based behavioral + technical',
    descriptionUz: 'Amazon uslubi: Leadership Principles + texnik',
    questionStyle:
      'Ask questions in Amazon interview style. EVERY behavioral question must map to one of Amazon\'s ' +
      '16 Leadership Principles (Customer Obsession, Ownership, Invent and Simplify, etc.). ' +
      'Technical questions should focus on scalability, distributed systems, and operational excellence.',
  },
  {
    id: 'meta',
    name: 'Meta',
    emoji: '🔷',
    rounds: 4,
    focus: ['coding', 'system design', 'behavioral'],
    focusUz: 'Performance, large-scale systems, coding',
    description: 'Meta-style: coding + system design + behavioral',
    descriptionUz: 'Meta uslubi: performance + large-scale tizimlar',
    questionStyle:
      'Ask questions in Meta (Facebook) interview style. Focus on efficient coding solutions, ' +
      'large-scale system design (billions of users), and Move Fast culture. ' +
      'Include questions about performance optimization and product sense.',
  },
  {
    id: 'startup',
    name: 'Startup',
    emoji: '🚀',
    rounds: 3,
    focus: ['practical', 'culture fit', 'versatility'],
    focusUz: 'Amaliy ko\'nikmalar, ko\'p qirralilik, tezlik',
    description: 'Startup-style: practical task + culture fit + technical',
    descriptionUz: 'Startup uslubi: amaliy vazifa + madaniyat + texnik',
    questionStyle:
      'Ask questions in startup interview style. Focus on practical problem-solving, ' +
      'ability to wear multiple hats, speed of delivery, and culture fit. ' +
      'Include a take-home style scenario question and ask about working with ambiguity.',
  },
];

// ─── Scoring Weights ─────────────────────────────────────────

export const SCORING_WEIGHTS = {
  correctness: 0.25,
  completeness: 0.20,
  structure: 0.15,
  communication: 0.15,
  depth: 0.15,
  timeManagement: 0.10,
} as const;

export const SCORING_CATEGORIES = [
  'correctness',
  'completeness',
  'structure',
  'communication',
  'depth',
  'timeManagement',
] as const;

// ─── Follow-up Configuration ─────────────────────────────────

export const FOLLOW_UP_CONFIG = {
  maxPerQuestion: 2,
  minWordsForTechnical: 50,
  minWordsForBehavioral: 80,
  lowScoreThreshold: 5,  // Score < 5 → redirect follow-up
  highScoreThreshold: 7, // Score >= 7 → deep_dive follow-up
} as const;

export const FOLLOW_UP_TYPES = ['expand', 'redirect', 'deep_dive'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

// ─── Verdicts ────────────────────────────────────────────────

export const INTERVIEW_VERDICTS = [
  'strong_hire',
  'hire',
  'maybe',
  'no_hire',
] as const;

export type InterviewVerdict = (typeof INTERVIEW_VERDICTS)[number];

export function getVerdictFromScore(score: number): InterviewVerdict {
  if (score >= 85) return 'strong_hire';
  if (score >= 70) return 'hire';
  if (score >= 50) return 'maybe';
  return 'no_hire';
}

export function getVerdictLabel(
  verdict: InterviewVerdict,
  lang: string = 'uz',
): string {
  const labels: Record<InterviewVerdict, Record<string, string>> = {
    strong_hire: { uz: 'KUCHLI HIRE', ru: 'ТОЧНО НАНЯТЬ', en: 'STRONG HIRE' },
    hire: { uz: 'HIRE', ru: 'НАНЯТЬ', en: 'HIRE' },
    maybe: { uz: 'MUMKIN', ru: 'ВОЗМОЖНО', en: 'MAYBE' },
    no_hire: { uz: 'HIRE EMAS', ru: 'НЕ НАНИМАТЬ', en: 'NO HIRE' },
  };
  return labels[verdict]?.[lang] || labels[verdict]?.en || verdict;
}

// ─── Idle Timeout ────────────────────────────────────────────

/** Default idle timeout: 15 minutes (from env MOCK_IDLE_TIMEOUT_SECONDS) */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 900;
