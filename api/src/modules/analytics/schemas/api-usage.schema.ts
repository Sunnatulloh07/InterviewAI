import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ApiUsageDocument = ApiUsage & Document;

/**
 * API Usage Schema - TZ Requirement
 * For rate limiting and billing tracking
 */
@Schema({ timestamps: true })
export class ApiUsage {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ required: true })
  method: string;

  @Prop({ type: Date, default: () => Date.now(), index: true })
  timestamp: Date;

  @Prop({ required: true })
  responseTime: number; // milliseconds

  @Prop({ required: true })
  statusCode: number;

  @Prop({ type: Number, default: 0 })
  tokensUsed: number;

  @Prop({ type: Number, default: 0 })
  cost: number; // in cents
}

export const ApiUsageSchema = SchemaFactory.createForClass(ApiUsage);

// Indexes (TZ requirement)
ApiUsageSchema.index({ userId: 1, timestamp: -1 });
ApiUsageSchema.index({ endpoint: 1 });
ApiUsageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // 30 days TTL

// Transform to JSON
ApiUsageSchema.set('toJSON', {
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete (ret as any)._id;
    delete (ret as any).__v;
    return ret;
  },
} as any);
