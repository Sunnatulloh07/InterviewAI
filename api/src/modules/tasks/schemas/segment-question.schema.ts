import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Segment Question Schema
 *
 * Stores AI-generated questions for a SPECIFIC SEGMENT:
 * (Career Path + Position + Week Pattern)
 *
 * SHARED ACROSS ALL USERS in the same segment!
 *
 * COST OPTIMIZATION:
 * - 1000 career paths × 4 positions × 20 weeks × 3 questions
 * = 240,000 unique question sets MAXIMUM
 * - But we only generate when a segment has active users
 * - Real-world: ~50 active segments = 150 questions/month
 * - Cost: 150 × $0.001 = $0.15/month (!!!)
 */

@Schema({ timestamps: true })
export class SegmentQuestion {
  // Segment identifier (unique combination)
  @Prop({ required: true })
  careerPathSlug: string; // 'frontend-developer'

  @Prop({ required: true, enum: ['junior', 'middle', 'senior', 'lead'] })
  position: string;

  @Prop({ required: true })
  weekNumber: number; // 1-52

  @Prop({ required: true, enum: ['technical', 'behavioral', 'system_design'] })
  type: string;

  // The actual questions (3 per day)
  @Prop({
    type: [
      {
        question: String,
        context: String,
        hints: [String],
        difficulty: Number, // 1-10
        estimatedTime: Number, // minutes
        tags: [String],
      },
    ],
    required: true,
  })
  questions: {
    question: string;
    context?: string;
    hints: string[];
    difficulty: number;
    estimatedTime: number;
    tags: string[];
  }[];

  // AI Generation metadata
  @Prop({
    type: {
      generatedBy: String,
      model: String,
      tokensUsed: Number,
      generationTime: Number, // milliseconds
      cost: Number, // USD
      generatedAt: Date,
    },
  })
  aiMetadata: {
    generatedBy: string;
    model: string;
    tokensUsed: number;
    generationTime: number;
    cost: number;
    generatedAt: Date;
  };

  // Usage tracking
  @Prop({ default: 0 })
  timesServed: number; // How many times this was served to users

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  servedToUsers: Types.ObjectId[]; // Track unique users

  @Prop({ type: Date })
  expiresAt: Date; // Regenerate after 90 days

  @Prop({ default: true })
  isActive: boolean;
}

export type SegmentQuestionDocument = SegmentQuestion & Document;
export const SegmentQuestionSchema = SchemaFactory.createForClass(SegmentQuestion);

// Compound index for unique segments
SegmentQuestionSchema.index(
  { careerPathSlug: 1, position: 1, weekNumber: 1, type: 1 },
  { unique: true },
);

SegmentQuestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL
SegmentQuestionSchema.index({ timesServed: -1 }); // Most popular
