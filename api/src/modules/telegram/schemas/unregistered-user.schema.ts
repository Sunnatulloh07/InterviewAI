import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UnregisteredUserDocument = UnregisteredUser & Document;

@Schema({ timestamps: true })
export class UnregisteredUser {
  @Prop({ required: true, unique: true, index: true })
  telegramChatId: number;

  @Prop()
  telegramUsername?: string;

  @Prop()
  telegramFirstName?: string;

  @Prop()
  telegramLastName?: string;

  @Prop({ default: 'uz' })
  language: string;

  @Prop({ default: 'not_started' })
  registrationStatus: 'not_started' | 'phone_entered' | 'otp_sent' | 'otp_failed';

  @Prop()
  lastEngagementMessageIndex?: number;

  @Prop({ type: Date })
  lastEngagementSentAt?: Date;

  @Prop({ default: false })
  isBotBlocked: boolean;

  @Prop({ type: Date })
  botBlockedAt?: Date;

  @Prop({ type: Date })
  blockedAt?: Date;

  @Prop({ type: String })
  blockReason?: string;

  @Prop({ default: 0 })
  totalEngagementSent: number;

  createdAt: Date;
  updatedAt: Date;
}

export const UnregisteredUserSchema = SchemaFactory.createForClass(UnregisteredUser);

UnregisteredUserSchema.index({ telegramChatId: 1 });
UnregisteredUserSchema.index({ registrationStatus: 1 });
UnregisteredUserSchema.index({ lastEngagementSentAt: 1 });
UnregisteredUserSchema.index({ isBotBlocked: 1 });

UnregisteredUserSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
