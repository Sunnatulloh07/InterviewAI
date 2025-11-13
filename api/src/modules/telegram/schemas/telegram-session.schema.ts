import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TelegramSessionDocument = TelegramSession & Document;

@Schema({ timestamps: true })
export class TelegramSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  telegramChatId: number;

  @Prop({
    type: String,
    enum: ['idle', 'active_interview', 'voice_chat', 'live_session'],
    default: 'idle',
  })
  status: string;

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
    jobRole?: string;
    company?: string;
    interviewType?: string;
    language?: string;
  };

  @Prop({ type: Date })
  sessionStartedAt?: Date;

  @Prop({ type: Date })
  lastActivityAt?: Date;
}

export const TelegramSessionSchema = SchemaFactory.createForClass(TelegramSession);

// Indexes
TelegramSessionSchema.index({ telegramChatId: 1 });
TelegramSessionSchema.index({ userId: 1, status: 1 });

// Transform to JSON
TelegramSessionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
