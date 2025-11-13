import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type InterviewSessionDocument = InterviewSession & Document;

@Schema({ timestamps: true })
export class InterviewSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['technical', 'behavioral', 'case_study', 'mixed'],
    required: true,
  })
  type: string;

  @Prop({
    type: String,
    enum: ['junior', 'mid', 'senior'],
    required: true,
  })
  difficulty: string;

  @Prop({ type: String })
  domain?: string;

  @Prop({ type: [String], default: [] })
  technology: string[];

  @Prop({ required: true })
  numQuestions: number;

  @Prop({
    type: String,
    enum: ['audio', 'text'],
    default: 'text',
  })
  mode: string;

  @Prop({ type: Number })
  timeLimit?: number; // Minutes per question

  @Prop({
    type: String,
    enum: ['active', 'paused', 'completed', 'abandoned'],
    default: 'active',
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  currentQuestionIndex: number;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'InterviewQuestion' }], default: [] })
  questions: MongooseSchema.Types.ObjectId[];

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'InterviewAnswer' }], default: [] })
  answers: MongooseSchema.Types.ObjectId[];

  @Prop({ type: Date, default: () => Date.now() })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt?: Date;

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

  @Prop({ type: String })
  aiSessionId?: string;
}

export const InterviewSessionSchema = SchemaFactory.createForClass(InterviewSession);

// Indexes
InterviewSessionSchema.index({ userId: 1, createdAt: -1 });
InterviewSessionSchema.index({ status: 1 });
InterviewSessionSchema.index({ type: 1, difficulty: 1 });

// Transform to JSON
InterviewSessionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
