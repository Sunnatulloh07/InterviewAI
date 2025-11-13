import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AnalyticsEventDocument = AnalyticsEvent & Document;

@Schema({ timestamps: true })
export class AnalyticsEvent {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ type: String })
  sessionId?: string;

  @Prop({ type: Object, default: {} })
  properties: Record<string, any>;

  @Prop({ type: Object, default: {} })
  metadata: {
    userAgent: string;
    ipAddress: string;
    referrer?: string;
    platform: string;
    version: string;
  };

  @Prop({ type: Date, default: () => Date.now(), index: true })
  timestamp: Date;
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);

// Indexes (TZ compliant)
AnalyticsEventSchema.index({ userId: 1, timestamp: -1 });
AnalyticsEventSchema.index({ eventType: 1, timestamp: -1 });
// TTL index: Auto-delete after 90 days (TZ requirement)
AnalyticsEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

AnalyticsEventSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
