import { UserRole } from '@common/enums/user-role.enum';

export interface ISubscription {
  plan: 'free' | 'pro' | 'elite' | 'enterprise';
  status: 'active' | 'cancelled' | 'expired' | 'trialing';
  startDate: Date;
  endDate?: Date;
  trialEndsAt?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface IUserPreferences {
  language: string;
  notifications: {
    email: boolean;
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
}

export interface IUsage {
  mockInterviewsThisMonth: number;
  cvAnalysesThisMonth: number;
  chromeQuestionsThisMonth: number;
  lastResetDate: Date;
}

export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  avatar?: string;
  bio?: string;
  role: UserRole;
  emailVerified: boolean;
  telegramId?: number;
  subscription: ISubscription;
  preferences: IUserPreferences;
  usage: IUsage;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface IUserSanitized extends Omit<IUser, 'password'> {}
