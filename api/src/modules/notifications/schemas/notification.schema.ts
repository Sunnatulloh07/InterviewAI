import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  message: string;

  @Prop({
    type: String,
    enum: ['cv_analysis', 'interview_feedback', 'subscription', 'payment', 'usage_limit'],
    required: true,
  })
  type: string;

  @Prop({
    type: String,
    enum: ['telegram', 'in_app', 'email'],
    default: 'in_app',
  })
  channel: string;

  @Prop({
    type: String,
    enum: ['pending', 'sent', 'failed', 'read'],
    default: 'pending',
  })
  status: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ type: Date })
  readAt?: Date;

  @Prop({ type: Date })
  sentAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ status: 1 });

NotificationSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
