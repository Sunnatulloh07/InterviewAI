import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AiSessionDocument = AiSession & Document;

@Schema({ timestamps: true })
export class AiSession {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  sessionType: string; // 'interview', 'chrome-extension', 'telegram-bot'

  @Prop({ type: String })
  interviewId?: string;

  @Prop({ type: Array, default: [] })
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    type: 'question' | 'answer';
    topics?: string[];
  }>;

  @Prop({ type: Array, default: [] })
  topics: string[];

  @Prop({ type: Array, default: [] })
  mentionedExperiences: string[];

  @Prop({ type: Array, default: [] })
  skills: string[];

  @Prop({ type: Object, default: {} })
  context: Record<string, any>;

  @Prop({ default: 0 })
  tokensUsed: number;

  @Prop({ type: String })
  model?: string;

  @Prop({ type: Date, default: () => Date.now() })
  lastUpdated: Date;

  @Prop({ default: false })
  archived: boolean;
}

export const AiSessionSchema = SchemaFactory.createForClass(AiSession);

// Indexes
AiSessionSchema.index({ userId: 1, createdAt: -1 });
AiSessionSchema.index({ sessionType: 1 });
AiSessionSchema.index({ lastUpdated: -1 });

// Transform to JSON
AiSessionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
