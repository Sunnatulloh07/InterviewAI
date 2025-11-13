import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'usd' })
  currency: string;

  @Prop({
    type: String,
    enum: ['succeeded', 'pending', 'failed', 'refunded'],
    default: 'pending',
  })
  status: string;

  @Prop({ type: String })
  stripePaymentIntentId?: string;

  @Prop({ type: String })
  stripeInvoiceId?: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ userId: 1, createdAt: -1 });
PaymentSchema.index({ status: 1 });

PaymentSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
