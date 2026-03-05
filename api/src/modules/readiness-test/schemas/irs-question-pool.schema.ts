import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IrsQuestionDocument = IrsQuestion & Document;

/**
 * IRS Question Pool Schema
 *
 * Oldindan tayyorlangan savollar bazasi.
 * Har bir savol pozitsiya, tech stack, kategoriya va difficulty bo'yicha filtrlangan.
 * Savollar 3 tilda mavjud (uz/ru/en).
 */
@Schema({ timestamps: true, collection: 'irs_questions' })
export class IrsQuestion {
  /** Savol matni — o'zbek tili */
  @Prop({ required: true })
  text_uz: string;

  /** Savol matni — rus tili */
  @Prop({ required: true })
  text_ru: string;

  /** Savol matni — ingliz tili */
  @Prop({ required: true })
  text_en: string;

  /** Savol kategoriyasi */
  @Prop({
    required: true,
    enum: ['technical', 'behavioral', 'problemSolving', 'systemDesign'],
    index: true,
  })
  category: string;

  /** Qiyinchilik darajasi */
  @Prop({
    required: true,
    enum: ['easy', 'medium', 'hard'],
    index: true,
  })
  difficulty: string;

  /** Qaysi pozitsiya uchun mo'ljallangan */
  @Prop({
    required: true,
    enum: ['junior', 'middle', 'senior', 'lead'],
    index: true,
  })
  position: string;

  /** Texnologiya steki (javascript, python, etc.) */
  @Prop({ required: true, index: true })
  techStack: string;

  /** Maslahatlar (foydalanuvchi uchun hint) */
  @Prop({ type: [String], default: [] })
  hints: string[];

  /** Ideal javob namunasi (AI scoring uchun reference) */
  @Prop()
  idealAnswer?: string;

  /** Necha marta ishlatilgan */
  @Prop({ default: 0 })
  timesUsed: number;

  /** O'rtacha skor (bu savol bo'yicha) */
  @Prop({ default: 0 })
  avgScore: number;

  /** Faol yoki yo'q */
  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const IrsQuestionSchema = SchemaFactory.createForClass(IrsQuestion);

// Compound indexes for efficient question selection
IrsQuestionSchema.index(
  { position: 1, techStack: 1, category: 1, difficulty: 1, isActive: 1 },
  { name: 'question_selection_idx' },
);
IrsQuestionSchema.index({ timesUsed: 1 }, { name: 'least_used_idx' });
