import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type VoiceUsageDocument = VoiceUsage & Document;

@Schema({ timestamps: true })
export class VoiceUsage {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: ['mock', 'real'], index: true })
  type: 'mock' | 'real';

  @Prop({ required: true })
  durationSeconds: number; // Actual duration in seconds

  @Prop({ required: true })
  durationMinutes: number; // Rounded up to nearest minute

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'InterviewSession' })
  interviewSessionId?: MongooseSchema.Types.ObjectId;

  @Prop()
  transcriptionText?: string; // First 500 chars for reference

  @Prop({ required: true, default: () => new Date() })
  usedAt: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export const VoiceUsageSchema = SchemaFactory.createForClass(VoiceUsage);

// Indexes for analytics and cleanup
VoiceUsageSchema.index({ userId: 1, usedAt: -1 });
VoiceUsageSchema.index({ type: 1, usedAt: -1 });
VoiceUsageSchema.index({ usedAt: 1 }); // For TTL/cleanup
