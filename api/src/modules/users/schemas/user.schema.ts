import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole } from '@common/enums/user-role.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  // Phone number as primary identifier (Telegram-based auth)
  @Prop({ required: true, unique: true, index: true, trim: true })
  phoneNumber: string;

  @Prop({ default: false })
  phoneVerified: boolean;

  // OTP for phone verification
  @Prop({ select: false })
  otpCode?: string;

  @Prop()
  otpExpires?: Date;

  @Prop({ default: 0 })
  otpAttempts: number;

  // Telegram integration (required for this app)
  @Prop({ required: true, unique: true, index: true })
  telegramId: number;

  @Prop()
  telegramUsername?: string;

  @Prop()
  telegramFirstName?: string;

  @Prop()
  telegramLastName?: string;

  // User profile
  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  avatar?: string;

  @Prop({ maxlength: 500 })
  bio?: string;

  // Optional email for secondary communication
  @Prop({ unique: true, sparse: true, lowercase: true, trim: true })
  email?: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.USER,
    index: true,
  })
  role: UserRole;

  // Language preference
  @Prop({ default: 'uz' })
  language: string;

  // Subscription
  @Prop({
    type: Object,
    default: () => ({
      plan: 'free',
      status: 'active',
      startDate: new Date(),
    }),
  })
  subscription: {
    plan: 'free' | 'pro' | 'elite' | 'enterprise';
    status: 'active' | 'cancelled' | 'expired' | 'trialing';
    startDate: Date;
    endDate?: Date;
    trialEndsAt?: Date;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    cancelAtPeriodEnd?: boolean;
  };

  // Preferences (TZ compliant - includes language and email notification)
  @Prop({
    type: Object,
    default: () => ({
      language: 'uz',
      notifications: {
        email: false, // TZ compliance
        telegram: true,
        push: false,
      },
      interviewSettings: {
        answerStyle: 'balanced',
        answerLength: 'medium',
        autoTranscribe: true,
      },
      privacy: {
        saveHistory: true,
        shareAnalytics: false,
      },
    }),
  })
  preferences: {
    language: string;
    notifications: {
      email: boolean; // TZ compliance
      telegram: boolean;
      push: boolean;
    };
    interviewSettings: {
      answerStyle: 'professional' | 'balanced' | 'simple';
      answerLength: 'short' | 'medium' | 'long';
      autoTranscribe: boolean;
    };
    privacy: {
      saveHistory: boolean;
      shareAnalytics: boolean;
    };
  };

  // Usage tracking (TZ compliant with aiTokensThisMonth added)
  @Prop({
    type: Object,
    default: () => ({
      mockInterviewsThisMonth: 0,
      cvAnalysesThisMonth: 0,
      chromeQuestionsThisMonth: 0,
      aiTokensThisMonth: 0,
      lastResetDate: new Date(),
    }),
  })
  usage: {
    mockInterviewsThisMonth: number;
    cvAnalysesThisMonth: number;
    chromeQuestionsThisMonth: number;
    aiTokensThisMonth: number;
    lastResetDate: Date;
  };

  // Account management
  @Prop()
  lastLoginAt?: Date;

  @Prop({ index: true })
  deletedAt?: Date;

  // Virtual property
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  // Timestamps (automatically added by timestamps: true)
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ phoneNumber: 1, deletedAt: 1 });
UserSchema.index({ telegramId: 1, deletedAt: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual properties
UserSchema.virtual('fullName').get(function (this: UserDocument) {
  return `${this.firstName} ${this.lastName}`;
});

// JSON transformation
UserSchema.set('toJSON', {
  virtuals: true,
  transform: function (_doc, ret: any) {
    const obj: any = { ...ret };
    delete obj._id;
    delete obj.__v;
    delete obj.otpCode;
    delete obj.deletedAt;
    obj.id = _doc._id.toString();
    return obj;
  },
});

UserSchema.set('toObject', {
  virtuals: true,
  transform: function (_doc, ret: any) {
    const obj: any = { ...ret };
    delete obj._id;
    delete obj.__v;
    delete obj.otpCode;
    obj.id = _doc._id.toString();
    return obj;
  },
});

// Pre-save middleware
UserSchema.pre('save', function (next) {
  const user = this as any;

  // Ensure defaults for new users (TZ compliant)
  if (user.isNew) {
    if (!user.subscription) {
      user.subscription = {
        plan: 'free',
        status: 'active',
        startDate: new Date(),
      };
    }

    if (!user.usage) {
      user.usage = {
        mockInterviewsThisMonth: 0,
        cvAnalysesThisMonth: 0,
        chromeQuestionsThisMonth: 0,
        aiTokensThisMonth: 0,
        lastResetDate: new Date(),
      };
    }

    // Set default preferences if not provided (TZ compliant)
    if (!user.preferences) {
      user.preferences = {
        language: user.language || 'uz',
        notifications: {
          email: false,
          telegram: true,
          push: false,
        },
        interviewSettings: {
          answerStyle: 'balanced',
          answerLength: 'medium',
          autoTranscribe: true,
        },
        privacy: {
          saveHistory: true,
          shareAnalytics: false,
        },
      };
    }
  }

  next();
});
