import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Generated Question Schema
 *
 * Stores AI-generated questions with caching for cost optimization.
 * Questions are cached for 30 days to serve similar requests.
 *
 * COST OPTIMIZATION:
 * - Cache hit = $0 cost
 * - Cache miss = ~$0.001 (Z-AI GLM-4-32B cost)
 * - 90% cache hit rate for 1M users = $100/day instead of $1000/day
 */

@Schema({ timestamps: true })
export class GeneratedQuestion {
  @Prop({ type: Types.ObjectId, ref: 'QuestionPattern', required: false })
  patternId: Types.ObjectId;

  @Prop({ required: true, enum: ['junior', 'middle', 'senior', 'lead'] })
  position: string;

  @Prop({ type: String })
  domain: string; // e.g., 'frontend', 'backend', 'mobile'

  @Prop({ type: [String], default: [] })
  techStacks: string[]; // e.g., ['react', 'node', 'java']

  @Prop({ required: true, enum: ['technical', 'behavioral', 'system_design'] })
  type: string;

  @Prop({ required: true })
  question: string; // AI-generated question text

  @Prop({ type: String })
  context: string; // Story context (optional)

  @Prop({ type: [String], default: [] })
  hints: string[]; // Hint hierarchy (AI-generated)

  @Prop({ type: String })
  sampleAnswer: string; // Optional sample answer

  @Prop({ type: Object })
  metadata: {
    generatedBy: string; // 'z-ai/glm-4-32b'
    tokensUsed: number;
    generationTime: number; // milliseconds
    cost: number; // USD
  };

  @Prop({ default: 0 })
  timesUsed: number; // How many users received this

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  servedToUsers: Types.ObjectId[]; // Track who got this (prevent duplication)

  @Prop({ type: Date })
  expiresAt: Date; // Cache expiry (30 days)
}

export type GeneratedQuestionDocument = GeneratedQuestion & Document;
export const GeneratedQuestionSchema = SchemaFactory.createForClass(GeneratedQuestion);

// Indexes for efficient queries
GeneratedQuestionSchema.index({ patternId: 1, position: 1, type: 1 });
GeneratedQuestionSchema.index({ domain: 1, techStacks: 1 }); // Tech stack matching
GeneratedQuestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
GeneratedQuestionSchema.index({ timesUsed: 1 });
