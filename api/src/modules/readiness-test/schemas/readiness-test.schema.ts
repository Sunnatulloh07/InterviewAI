import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReadinessTestDocument = ReadinessTest & Document;

/**
 * Question Result — har bir savol uchun javob va baholash
 */
@Schema({ _id: false })
export class QuestionResult {
  /** Savol ID si (IrsQuestion dan) */
  @Prop({ type: Types.ObjectId })
  questionId?: Types.ObjectId;

  /** Savol matni (snapshot — savolni o'zgartirsak ham eski natija saqlanadi) */
  @Prop({ required: true })
  questionText: string;

  /** Kategoriya */
  @Prop({
    required: true,
    enum: ['technical', 'behavioral', 'problemSolving', 'systemDesign'],
  })
  category: string;

  /** Qiyinchilik */
  @Prop({ required: true, enum: ['easy', 'medium', 'hard'] })
  difficulty: string;

  /** Foydalanuvchi javobi */
  @Prop()
  answer?: string;

  /** Javob berish vaqti (soniyalarda) */
  @Prop()
  answerTime?: number;

  /** AI tomonidan berilgan ballar */
  @Prop(
    raw({
      correctness: { type: Number, min: 0, max: 10 },
      depth: { type: Number, min: 0, max: 10 },
      communication: { type: Number, min: 0, max: 10 },
      completeness: { type: Number, min: 0, max: 10 },
      timeEfficiency: { type: Number, min: 0, max: 10 },
    }),
  )
  scores?: {
    correctness: number;
    depth: number;
    communication: number;
    completeness: number;
    timeEfficiency: number;
  };

  /** Vaznli o'rtacha skor (0-10) */
  @Prop({ min: 0, max: 10 })
  weightedScore?: number;

  /** AI feedback */
  @Prop()
  feedback?: string;

  /** Qisqa tavsiya */
  @Prop()
  quickTip?: string;
}

export const QuestionResultSchema = SchemaFactory.createForClass(QuestionResult);

/**
 * Category Scores — kategoriya bo'yicha yakuniy ballar (0-100 scaled)
 */
@Schema({ _id: false })
export class CategoryScores {
  @Prop({ default: 0, min: 0, max: 100 })
  technical: number;

  @Prop({ default: 0, min: 0, max: 100 })
  problemSolving: number;

  @Prop({ default: 0, min: 0, max: 100 })
  communication: number;

  @Prop({ default: 0, min: 0, max: 100 })
  behavioral: number;

  @Prop({ default: 0, min: 0, max: 100 })
  systemDesign: number;
}

export const CategoryScoresSchema = SchemaFactory.createForClass(CategoryScores);

/**
 * ReadinessTest — bitta IRS test sessiyasi
 *
 * Anonim foydalanuvchilar ham test topshirishi mumkin (userId null).
 * Anonim testlar 30 kun keyin TTL index bilan avtomatik o'chiriladi.
 */
@Schema({ timestamps: true, collection: 'readinesstests' })
export class ReadinessTest {
  /** Foydalanuvchi ID si — ro'yxatdan o'tgan userlar uchun, anonim uchun null */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  /** Telegram ID — har doim mavjud (anonim ham) */
  @Prop({ required: true, index: true })
  telegramId: number;

  /** Tanlangan pozitsiya */
  @Prop({
    required: true,
    enum: ['junior', 'middle', 'senior', 'lead'],
  })
  position: string;

  /** Tanlangan texnologiya */
  @Prop({ required: true })
  techStack: string;

  /** Test tili */
  @Prop({ default: 'uz', enum: ['uz', 'ru', 'en'] })
  language: string;

  /** Savollar va javoblar (5 ta) */
  @Prop({ type: [QuestionResultSchema], default: [] })
  questions: QuestionResult[];

  /** Yakuniy skor (0-100) — vaznli o'rtacha */
  @Prop({ min: 0, max: 100 })
  totalScore?: number;

  /** Kategoriya bo'yicha ballar */
  @Prop({ type: CategoryScoresSchema })
  categoryScores?: CategoryScores;

  /** Ulashish uchun unique token */
  @Prop({ unique: true, index: true })
  shareToken: string;

  /** Test holati */
  @Prop({
    enum: ['in_progress', 'completed', 'expired'],
    default: 'in_progress',
    index: true,
  })
  status: string;

  /** Hozirgi savol indeksi (0-4) */
  @Prop({ default: 0 })
  currentQuestionIndex: number;

  /** Test yakunlangan vaqt */
  @Prop()
  completedAt?: Date;

  /** TTL — anonim testlar 30 kundan keyin o'chiriladi */
  @Prop({ type: Date, index: true })
  expiresAt?: Date;

  /** Percentile ranking (test yakunlanganda hisoblanadi) */
  @Prop({ min: 0, max: 100 })
  percentile?: number;
}

export const ReadinessTestSchema = SchemaFactory.createForClass(ReadinessTest);

// Indexes
ReadinessTestSchema.index(
  { telegramId: 1, createdAt: -1 },
  { name: 'user_tests_history_idx' },
);
ReadinessTestSchema.index(
  { status: 1, createdAt: -1 },
  { name: 'active_tests_idx' },
);
ReadinessTestSchema.index(
  { position: 1, totalScore: 1 },
  { name: 'percentile_calc_idx' },
);
ReadinessTestSchema.index(
  { completedAt: 1 },
  { name: 'weekly_stats_idx' },
);

// TTL index — anonim testlarni avtomatik o'chirish
ReadinessTestSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_cleanup_idx' },
);
