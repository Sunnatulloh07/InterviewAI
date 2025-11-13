import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type SubscriptionDocument = Subscription & Document;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: String,
    enum: ['free', 'pro', 'elite', 'enterprise'],
    default: 'free',
  })
  plan: string;

  @Prop({
    type: String,
    enum: ['active', 'canceled', 'past_due', 'trialing'],
    default: 'active',
  })
  status: string;

  @Prop({ type: String })
  stripeCustomerId?: string;

  @Prop({ type: String })
  stripeSubscriptionId?: string;

  @Prop({ type: Date })
  currentPeriodStart?: Date;

  @Prop({ type: Date })
  currentPeriodEnd?: Date;

  @Prop({ default: false })
  cancelAtPeriodEnd: boolean;

  @Prop({ type: Date })
  trialEnd?: Date;

  @Prop({
    type: String,
    enum: ['monthly', 'annual'],
    default: 'monthly',
  })
  billingCycle: string;

  @Prop({ type: Number, default: 0 })
  amount: number;

  @Prop({ type: String, default: 'usd' })
  currency: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ userId: 1 });
SubscriptionSchema.index({ stripeCustomerId: 1 });
SubscriptionSchema.index({ status: 1 });

SubscriptionSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
