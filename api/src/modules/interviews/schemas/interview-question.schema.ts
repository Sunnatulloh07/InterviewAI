import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InterviewQuestionDocument = InterviewQuestion & Document;

@Schema({ timestamps: true })
export class InterviewQuestion {
  @Prop({ required: true })
  order: number;

  @Prop({
    type: String,
    enum: ['technical', 'behavioral', 'case_study', 'mixed'],
    required: true,
  })
  category: string;

  @Prop({
    type: String,
    enum: ['junior', 'mid', 'senior'],
    required: true,
  })
  difficulty: string;

  @Prop({ required: true })
  question: string;

  @Prop({ type: [String], default: [] })
  expectedKeyPoints: string[];

  @Prop({ type: Number })
  timeLimit?: number; // Seconds

  @Prop({ type: [String], default: [] })
  hints: string[];

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String })
  domain?: string;

  @Prop({ type: [String], default: [] })
  technology?: string[];

  @Prop({ type: String })
  idealAnswer?: string;

  // TZ compliance fields
  @Prop({ type: String })
  subcategory?: string;

  @Prop({ type: String })
  context?: string;

  @Prop({ type: String })
  sampleAnswer?: string;

  @Prop({ type: [String], default: [] })
  followUpQuestions: string[];

  @Prop({ default: 0 })
  timesAsked: number;

  @Prop({ type: Number })
  averageScore?: number;

  @Prop({ type: String, enum: ['system', 'admin'], default: 'system' })
  createdBy: string;
}

export const InterviewQuestionSchema = SchemaFactory.createForClass(InterviewQuestion);

// Indexes
InterviewQuestionSchema.index({ category: 1, difficulty: 1 });
InterviewQuestionSchema.index({ tags: 1 });
InterviewQuestionSchema.index({ domain: 1 });

// Transform to JSON
InterviewQuestionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
