import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type DailyTaskDocument = DailyTask & Document;

@Schema({ timestamps: true })
export class DailyTask {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop({
    type: [Object],
    default: [],
  })
  tasks: {
    question: string;
    answer?: string;
    completed: boolean;
    score?: number;
    completedAt?: Date;
  }[];

  @Prop({ default: 'pending', index: true })
  status: 'pending' | 'completed' | 'expired';

  // Timestamps (automatically added by timestamps: true)
  createdAt: Date;
  updatedAt: Date;
}

export const DailyTaskSchema = SchemaFactory.createForClass(DailyTask);

// Indexes
DailyTaskSchema.index({ userId: 1, date: 1 }, { unique: true });
DailyTaskSchema.index({ status: 1, date: 1 });
