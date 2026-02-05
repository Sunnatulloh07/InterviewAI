import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Generated Question Schema
 * 
 * 🌍 MULTILINGUAL: Each question has title and question in 3 languages
 * - title_uz, title_ru, title_en
 * - question_uz, question_ru, question_en
 * 
 * Delivery time: Select appropriate language based on user's preference
 * 
 * COST OPTIMIZATION:
 * - Generate once in 3 languages
 * - Serve to all users regardless of language
 * - 3x generation cost, but serves 3x user base efficiently
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
  techStacks: string[]; // 🔥 CRITICAL: Specific technologies e.g., ['Node.js', 'Express']

  @Prop({ required: true, enum: ['technical', 'behavioral', 'system_design'] })
  type: string;

  // 🌍 MULTILINGUAL: Title in 3 languages
  @Prop({ type: String })
  title_uz: string;

  @Prop({ type: String })
  title_ru: string;

  @Prop({ type: String })
  title_en: string;

  // 🌍 MULTILINGUAL: Question in 3 languages
  @Prop({ required: true })
  question_uz: string;

  @Prop({ required: true })
  question_ru: string;

  @Prop({ required: true })
  question_en: string;

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
    cost: number; // USD (3x for 3 languages)
  };

  @Prop({ default: 0 })
  timesUsed: number; // How many users received this (counter only)

  @Prop({ type: Date })
  expiresAt: Date; // Cache expiry (30 days)
}

export type GeneratedQuestionDocument = GeneratedQuestion & Document;
export const GeneratedQuestionSchema = SchemaFactory.createForClass(GeneratedQuestion);

// Indexes for efficient queries
// 🔥 CRITICAL: Main pool query index (position + type + techStacks + createdAt)
// Query: { position, type, techStacks: { $in: userTechStack }, _id: { $nin: seenIds } }
GeneratedQuestionSchema.index({ position: 1, type: 1, techStacks: 1, createdAt: 1 });
GeneratedQuestionSchema.index({ position: 1, type: 1, domain: 1, createdAt: 1 }); // Fallback

// Legacy indexes
GeneratedQuestionSchema.index({ patternId: 1, position: 1, type: 1 });
GeneratedQuestionSchema.index({ domain: 1, techStacks: 1 });
GeneratedQuestionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
GeneratedQuestionSchema.index({ timesUsed: 1 });
