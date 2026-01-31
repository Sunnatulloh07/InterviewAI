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

  // Reminder tracking (for paid users - 3 reminders per day)
  @Prop({
    type: Object,
    default: () => ({
      firstReminderSentAt: null,
      secondReminderSentAt: null,
      thirdReminderSentAt: null,
    }),
  })
  reminders: {
    firstReminderSentAt: Date | null;  // 30 min after task delivery
    secondReminderSentAt: Date | null; // 13:30
    thirdReminderSentAt: Date | null;  // 18:00
  };

  // Timestamps (automatically added by timestamps: true)
  createdAt: Date;
  updatedAt: Date;
}

export const DailyTaskSchema = SchemaFactory.createForClass(DailyTask);

// Indexes
DailyTaskSchema.index({ userId: 1, date: 1 }, { unique: true });
DailyTaskSchema.index({ status: 1, date: 1 });

// CRITICAL: Indexes for reminder queries (performance optimization)
// For first reminder query (createdAt + reminders.firstReminderSentAt)
DailyTaskSchema.index({ 
  status: 1, 
  createdAt: 1, 
  'reminders.firstReminderSentAt': 1 
});

// For second/third reminder queries (date + status + reminder sent flags)
DailyTaskSchema.index({ 
  date: 1, 
  status: 1, 
  'reminders.secondReminderSentAt': 1 
});

DailyTaskSchema.index({ 
  date: 1, 
  status: 1, 
  'reminders.thirdReminderSentAt': 1 
});
