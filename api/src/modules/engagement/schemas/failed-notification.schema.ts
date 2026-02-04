import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type FailedNotificationDocument = FailedNotification & Document;

@Schema({ timestamps: true })
export class FailedNotification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  telegramChatId: number;

  @Prop({
    type: String,
    enum: [
      'daily_task_delivery',
      'first_reminder',
      'second_reminder',
      'third_reminder',
      'trial_expiry',
      'engagement',
      'trial_reminder',
      'inactivity',
      'unregistered_engagement',
      'limit_exhausted',
      'employment_survey', // 🔧 FIX: Added missing enum value
      'position_prompt', // 🔧 FIX: Added missing enum value
    ],
    required: true,
    index: true,
  })
  notificationType: string;

  @Prop({ required: true })
  errorMessage: string;

  @Prop()
  errorCode?: number;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: false })
  isPermanentlyFailed: boolean;

  @Prop({ type: Date })
  nextRetryAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: {
    taskId?: string;
    taskIndex?: number;
    daysRemaining?: number;
    messageContent?: string;
    [key: string]: any;
  };

  createdAt: Date;
  updatedAt: Date;
}

export const FailedNotificationSchema = SchemaFactory.createForClass(FailedNotification);

FailedNotificationSchema.index({ userId: 1, notificationType: 1 });
FailedNotificationSchema.index({ nextRetryAt: 1, isPermanentlyFailed: 1 });
FailedNotificationSchema.index({ telegramChatId: 1 });

FailedNotificationSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
