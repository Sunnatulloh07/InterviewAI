import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VoiceReservationDocument = VoiceReservation & Document;

/**
 * Voice Quota Reservation Schema
 *
 * Purpose: Track quota reservations for transaction safety
 *
 * Flow:
 * 1. User sends voice → Reserve quota (status: 'reserved')
 * 2. AI processing succeeds → Commit (status: 'committed')
 * 3. AI processing fails → Rollback (status: 'rolled_back')
 * 4. Auto-cleanup: Expired reservations (>5min) → Rollback
 *
 * This prevents:
 * - Charging users for failed services
 * - Revenue loss from successful services
 * - Race conditions
 */
@Schema({
  collection: 'voice_reservations',
  timestamps: true,
})
export class VoiceReservation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['mock', 'real'], required: true })
  type: 'mock' | 'real';

  @Prop({ type: Number, required: true, min: 1 })
  minutes: number;

  @Prop({
    type: String,
    enum: ['reserved', 'committed', 'rolled_back'],
    required: true,
    default: 'reserved',
    index: true,
  })
  status: 'reserved' | 'committed' | 'rolled_back';

  // Context for debugging and analytics
  @Prop({
    type: Object,
    required: true,
  })
  context: {
    flow: 'mock_interview' | 'live_session' | 'daily_task';
    sessionId?: string;
    estimatedDurationSeconds: number;
    actualDurationSeconds?: number;
  };

  @Prop({ type: Date, required: true, index: true })
  reservedAt: Date;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date; // Auto-rollback after this time

  @Prop({ type: Date })
  committedAt?: Date;

  @Prop({ type: Date })
  rolledBackAt?: Date;

  @Prop({ type: String })
  rollbackReason?: string; // 'expired' | 'ai_failed' | 'user_cancelled'
}

export const VoiceReservationSchema = SchemaFactory.createForClass(VoiceReservation);

// Indexes for performance
VoiceReservationSchema.index({ userId: 1, status: 1 });
VoiceReservationSchema.index({ expiresAt: 1, status: 1 }); // For cleanup cron
VoiceReservationSchema.index({ createdAt: -1 }); // For analytics
