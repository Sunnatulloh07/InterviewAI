import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import { UserRole } from '@common/enums/user-role.enum';

class SubscriptionResponse {
  @ApiProperty({ example: 'free' })
  plan: string;

  @ApiProperty({ example: 'active' })
  status: string;

  @ApiProperty()
  startDate: Date;

  @ApiPropertyOptional()
  endDate?: Date;

  @ApiPropertyOptional()
  trialEndsAt?: Date;

  @ApiPropertyOptional()
  cancelAtPeriodEnd?: boolean;
}

class NotificationPreferencesResponse {
  @ApiProperty({ example: true })
  email: boolean;

  @ApiProperty({ example: false })
  telegram: boolean;

  @ApiProperty({ example: false })
  push: boolean;
}

class InterviewSettingsResponse {
  @ApiProperty({ example: 'balanced' })
  answerStyle: string;

  @ApiProperty({ example: 'medium' })
  answerLength: string;

  @ApiProperty({ example: true })
  autoTranscribe: boolean;
}

class PrivacySettingsResponse {
  @ApiProperty({ example: true })
  saveHistory: boolean;

  @ApiProperty({ example: false })
  shareAnalytics: boolean;
}

class PreferencesResponse {
  @ApiProperty({ example: 'en' })
  language: string;

  @ApiProperty({ type: NotificationPreferencesResponse })
  @Type(() => NotificationPreferencesResponse)
  notifications: NotificationPreferencesResponse;

  @ApiProperty({ type: InterviewSettingsResponse })
  @Type(() => InterviewSettingsResponse)
  interviewSettings: InterviewSettingsResponse;

  @ApiProperty({ type: PrivacySettingsResponse })
  @Type(() => PrivacySettingsResponse)
  privacy: PrivacySettingsResponse;
}

class UsageResponse {
  @ApiProperty({ example: 0 })
  mockInterviewsThisMonth: number;

  @ApiProperty({ example: 0 })
  cvAnalysesThisMonth: number;

  @ApiProperty({ example: 0 })
  chromeQuestionsThisMonth: number;

  @ApiProperty()
  lastResetDate: Date;
}

@Exclude()
export class UserResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @Expose()
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  @Expose()
  email: string;

  @ApiProperty({ example: 'John' })
  @Expose()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @Expose()
  lastName: string;

  @ApiProperty({ example: 'John Doe' })
  @Expose()
  fullName: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @Expose()
  avatar?: string;

  @ApiPropertyOptional({ example: 'Experienced software developer' })
  @Expose()
  bio?: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER })
  @Expose()
  role: UserRole;

  @ApiProperty({ example: true })
  @Expose()
  emailVerified: boolean;

  @ApiPropertyOptional({ example: 123456789 })
  @Expose()
  telegramId?: number;

  @ApiProperty({ type: SubscriptionResponse })
  @Expose()
  @Type(() => SubscriptionResponse)
  subscription: SubscriptionResponse;

  @ApiProperty({ type: PreferencesResponse })
  @Expose()
  @Type(() => PreferencesResponse)
  preferences: PreferencesResponse;

  @ApiProperty({ type: UsageResponse })
  @Expose()
  @Type(() => UsageResponse)
  usage: UsageResponse;

  @ApiPropertyOptional()
  @Expose()
  lastLoginAt?: Date;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty()
  @Expose()
  updatedAt: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
