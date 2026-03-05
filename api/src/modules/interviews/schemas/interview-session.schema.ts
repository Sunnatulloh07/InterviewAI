import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import {
  MOCK_INTERVIEW_TYPES,
  MOCK_STATES,
  type MockInterviewType,
  type MockState,
  type InterviewVerdict,
} from '../constants/mock-interview.constants';

export type InterviewSessionDocument = InterviewSession & Document;

@Schema({ timestamps: true })
export class InterviewSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  /** Legacy type field — kept for backward compatibility */
  @Prop({
    type: String,
    enum: ['technical', 'behavioral', 'case_study', 'mixed'],
    required: true,
  })
  type: string;

  /**
   * Enhanced interview type (Phase 3).
   * Maps to MOCK_INTERVIEW_TYPES: quick_technical, full_technical, behavioral,
   * system_design, company_specific, full_stack.
   * Falls back to 'quick_technical' for legacy sessions.
   */
  @Prop({
    type: String,
    enum: [...MOCK_INTERVIEW_TYPES],
    default: 'quick_technical',
  })
  mockType?: string;

  @Prop({
    type: String,
    enum: ['junior', 'middle', 'senior', 'lead'],
    required: true,
  })
  difficulty: string;

  @Prop({ type: String })
  domain?: string;

  @Prop({ type: [String], default: [] })
  technology: string[];

  /** Company name for company_specific interviews (Elite only) */
  @Prop({ type: String })
  company?: string;

  /** Company template ID (google, amazon, meta, epam, startup) */
  @Prop({ type: String })
  companyTemplateId?: string;

  @Prop({ required: true })
  numQuestions: number;

  @Prop({
    type: String,
    enum: ['quick', 'standard', 'deep_dive'],
    default: 'standard',
  })
  interviewDuration?: string;

  @Prop({
    type: String,
    enum: ['audio', 'text'],
    default: 'text',
  })
  mode: string;

  @Prop({ type: Number })
  timeLimit?: number; // Minutes per question (legacy, use questionTimeLimit)

  @Prop({ type: Number })
  totalTimeLimit?: number; // Total interview time in minutes

  @Prop({ type: Number })
  questionTimeLimit?: number; // Per-question time in minutes (calculated from difficulty)

  @Prop({ type: Date })
  questionStartedAt?: Date; // When current question was shown

  @Prop({ type: Date })
  expiresAt?: Date; // When interview auto-expires

  /** Last user activity timestamp — for idle timeout detection */
  @Prop({ type: Date })
  lastActivityAt?: Date;

  @Prop({
    type: String,
    enum: ['active', 'paused', 'completed', 'abandoned'],
    default: 'active',
    index: true,
  })
  status: string;

  /**
   * Enhanced state machine (Phase 3).
   * States: created → intro → questioning → follow_up → wrap_up → scoring → completed / cancelled
   */
  @Prop({
    type: String,
    enum: [...MOCK_STATES],
    default: 'created',
  })
  mockState?: string;

  @Prop({ default: 0 })
  currentQuestionIndex: number;

  /** Current follow-up count for the active question (max 2) */
  @Prop({ default: 0 })
  currentFollowUpCount?: number;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'InterviewQuestion' }], default: [] })
  questions: MongooseSchema.Types.ObjectId[];

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'InterviewAnswer' }], default: [] })
  answers: MongooseSchema.Types.ObjectId[];

  /**
   * Follow-up Q&A pairs, stored inline for simplicity.
   * Each entry: { questionIndex, type, question, answer?, answerTime? }
   */
  @Prop({
    type: [
      {
        questionIndex: { type: Number, required: true },
        type: { type: String, enum: ['expand', 'redirect', 'deep_dive'] },
        question: { type: String, required: true },
        answer: { type: String },
        answerTime: { type: Number }, // seconds
        answeredAt: { type: Date },
      },
    ],
    default: [],
  })
  followUps: Array<{
    questionIndex: number;
    type: string;
    question: string;
    answer?: string;
    answerTime?: number;
    answeredAt?: Date;
  }>;

  @Prop({ type: Date, default: () => Date.now() })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  /** Actual duration in minutes (computed at completion) */
  @Prop({ default: 0 })
  actualDuration?: number;

  @Prop({ type: Number })
  overallScore?: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'InterviewFeedback' })
  feedbackId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Object })
  feedback?: {
    overallScore: number;
    ratings: {
      technicalAccuracy: number;
      communication: number;
      structuredThinking: number;
      confidence: number;
      problemSolving: number;
    };
    summary: {
      strengths: string[];
      weaknesses: string[];
      topConcerns: string[];
    };
    recommendations: string[];
  };

  /**
   * Enhanced report (Phase 3).
   * Full structured report with verdict, category breakdown, action plan.
   */
  @Prop({ type: Object })
  report?: {
    /** Overall score 0-100 */
    totalScore: number;
    /** HIRE / MAYBE / NO_HIRE / STRONG_HIRE */
    verdict: string;
    /** Category scores: technical, communication, problemSolving, behavioral, systemDesign */
    categoryScores: Record<string, number>;
    /** Top 3 strengths */
    strengths: string[];
    /** Top 3 weaknesses */
    weaknesses: string[];
    /** Actionable recommendations */
    recommendations: string[];
    /** Comparison text ("Siz top 30% middle dasiz") */
    comparison: string;
    /** Week/month action plan */
    actionPlan: string[];
    /** Position readiness percentage */
    positionReadiness: number;
  };

  @Prop({ type: String })
  aiSessionId?: string;

  /** User's language at interview start (for report generation) */
  @Prop({ type: String, default: 'uz' })
  language?: string;
}

export const InterviewSessionSchema = SchemaFactory.createForClass(InterviewSession);

// Indexes
InterviewSessionSchema.index({ userId: 1, createdAt: -1 });
InterviewSessionSchema.index({ type: 1, difficulty: 1 });
InterviewSessionSchema.index({ mockType: 1, status: 1 });
InterviewSessionSchema.index(
  { status: 1, lastActivityAt: 1 },
  { name: 'idle_timeout_check_idx' },
);

// Transform to JSON
InterviewSessionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
