import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type InterviewAnswerDocument = InterviewAnswer & Document;

@Schema({ timestamps: true })
export class InterviewAnswer {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'InterviewSession',
    required: true,
    index: true,
  })
  sessionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'InterviewQuestion',
    required: true,
  })
  questionId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['text', 'audio'],
    required: true,
  })
  answerType: string;

  @Prop({ required: true })
  content: string; // Text or transcript

  @Prop({ type: String })
  audioUrl?: string;

  @Prop({ type: Date, default: () => Date.now() })
  submittedAt: Date;

  @Prop({ required: true })
  duration: number; // Seconds taken

  @Prop({ type: Number })
  score?: number; // 0-10

  @Prop({ type: Object })
  feedback?: {
    score: number;
    strengths: string[];
    improvements: string[];
    keyPointsCovered: string[];
    keyPointsMissed: string[];
    suggestions: string[];
    exampleAnswer?: string;
  };

  @Prop({ type: String })
  aiModel?: string;

  @Prop({ default: false })
  analyzed: boolean;
}

export const InterviewAnswerSchema = SchemaFactory.createForClass(InterviewAnswer);

// Indexes
InterviewAnswerSchema.index({ sessionId: 1 });
InterviewAnswerSchema.index({ analyzed: 1 });

// Transform to JSON
InterviewAnswerSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
