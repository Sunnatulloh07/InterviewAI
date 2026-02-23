import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type DailyTaskDocument = DailyTask & Document;

/**
 * DailyTask Schema - Embedded Array Approach
 *
 * DESIGN DECISION: Use embedded array for tasks instead of separate documents
 *
 * RATIONALE:
 * 1. Performance: 1 query gets all tasks (vs 3-10 queries for separate docs)
 * 2. Atomicity: MongoDB atomic updates with array operators
 * 3. Consistency: All tasks for a day in 1 document = no race conditions
 * 4. Storage: Less overhead (1 doc vs 3-10 docs)
 * 5. Scalability: Bounded size (max 10 tasks/day = ~4KB doc)
 * 6. MongoDB Best Practice: Embedded docs for 1-to-few relationships
 *
 * SCHEMA STRUCTURE:
 * - 1 document per user per day
 * - Unique index on (userId, date)
 * - Tasks stored as embedded array (max 10 items)
 * - Status tracking: pending → completed/expired
 * - Reminder tracking for engagement
 *
 * @see https://www.mongodb.com/docs/manual/core/data-model-design/
 */
@Schema({ timestamps: true })
export class DailyTask {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true })
  date: Date; // Tashkent midnight (UTC+5)

  @Prop({
    type: [
      {
        questionId: {
          type: MongooseSchema.Types.ObjectId,
          ref: 'GeneratedQuestion',
          required: false,
        }, // Link to source
        title: { type: String }, // Short task title for list view
        question: { type: String, required: true },
        answer: { type: String }, // Text answer or transcript
        answerType: { type: String, enum: ['text', 'voice', 'image'] }, // ✅ NO VIDEO - Too expensive
        audioUrl: { type: String }, // Voice audio URL
        imageUrl: { type: String }, // Image URL
        transcript: { type: String }, // STT transcript for voice
        completed: { type: Boolean, required: true, default: false },
        score: { type: Number, min: 0, max: 100 }, // Score validation (0-100 scale)
        feedback: { type: String }, // AI feedback stored
        completedAt: { type: Date },
        // 🛡 PHASE 1.1: Race condition prevention fields
        scoringStatus: {
          type: String,
          enum: ['pending', 'completed', 'failed'],
          default: 'pending',
        },
        scoredAt: { type: Date }, // When scoring finished
      },
    ],
    default: [],
    validate: {
      validator: function (tasks: any[]) {
        // SENIOR VALIDATION: Max tasks per day based on plan
        // Elite: 2, Pro: 1, Starter: 1
        return tasks.length <= 10; // Max safety limit
      },
      message: 'Maximum 10 tasks allowed per day',
    },
  })
  tasks: {
    title?: string; // Short task title for list view
    question: string;
    answer?: string; // Text answer or transcript
    answerType?: 'text' | 'voice' | 'image'; // ✅ NO VIDEO - Too expensive
    audioUrl?: string; // Voice audio URL
    imageUrl?: string; // Image URL
    transcript?: string; // STT transcript for voice
    completed: boolean;
    score?: number; // 0-100 range
    feedback?: string; // AI feedback stored
    completedAt?: Date;
    scoringStatus?: 'pending' | 'completed' | 'failed'; // 🛡 PHASE 1.1
    scoredAt?: Date; // 🛡 PHASE 1.1
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
    firstReminderSentAt: Date | null; // 30 min after task delivery
    secondReminderSentAt: Date | null; // 13:30
    thirdReminderSentAt: Date | null; // 18:00
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
  'reminders.firstReminderSentAt': 1,
});

// For second/third reminder queries (date + status + reminder sent flags)
DailyTaskSchema.index({
  date: 1,
  status: 1,
  'reminders.secondReminderSentAt': 1,
});

DailyTaskSchema.index({
  date: 1,
  status: 1,
  'reminders.thirdReminderSentAt': 1,
});
