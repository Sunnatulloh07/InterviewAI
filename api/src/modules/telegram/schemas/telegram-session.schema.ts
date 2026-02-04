import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TelegramSessionDocument = TelegramSession & Document;

@Schema({ timestamps: true })
export class TelegramSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  telegramChatId: number;

  @Prop({
    type: String,
    enum: ['idle', 'active_interview', 'voice_chat', 'live_session', 'daily_task'],
    default: 'idle',
  })
  status: string;

  // Daily task session tracking
  @Prop({ type: Object })
  dailyTaskSession?: {
    dailyTaskId: string;
    currentTaskIndex: number;
    totalTasks: number;
    date: Date;
  };

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'InterviewSession' })
  currentInterviewId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: Array, default: [] })
  messages: Array<{
    timestamp: Date;
    type: 'question' | 'answer';
    content: string;
    audioUrl?: string;
    aiResponse?: string;
    processingTime?: number;
  }>;

  @Prop({ type: String })
  context?: string;

  @Prop({ type: Object, default: {} })
  metadata: {
    // Legacy fields
    jobRole?: string;
    interviewType?: string;
    language?: string;
    // New fields for live session
    domain?: string;
    technologies?: string[];
    position?: string;
    company?: string;
  };

  @Prop({ type: Date })
  sessionStartedAt?: Date;

  @Prop({ type: Date })
  lastActivityAt?: Date;
}

export const TelegramSessionSchema = SchemaFactory.createForClass(TelegramSession);

// Indexes
// Note: telegramChatId already has index: true in @Prop (line 15)
// Only add composite indexes here to avoid duplicates
TelegramSessionSchema.index({ userId: 1, status: 1 });
TelegramSessionSchema.index({ status: 1, lastActivityAt: -1 });

// ⚡ PHASE 2.4: TTL index for automatic cleanup of stale sessions
// Sessions older than 24 hours are automatically deleted by MongoDB
// This prevents memory leaks from abandoned sessions (bot restart, network errors, etc.)
TelegramSessionSchema.index(
  { lastActivityAt: 1 },
  {
    expireAfterSeconds: 86400, // 24 hours
    name: 'session_ttl_cleanup',
  },
);

// Transform to JSON
TelegramSessionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
