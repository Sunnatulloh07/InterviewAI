import { IsString, IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

class NotificationPreferencesDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Enable email notifications',
  })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Enable Telegram notifications',
  })
  @IsOptional()
  @IsBoolean()
  telegram?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Enable push notifications',
  })
  @IsOptional()
  @IsBoolean()
  push?: boolean;
}

enum AnswerStyle {
  PROFESSIONAL = 'professional',
  BALANCED = 'balanced',
  SIMPLE = 'simple',
}

enum AnswerLength {
  SHORT = 'short',
  MEDIUM = 'medium',
  LONG = 'long',
}

class InterviewSettingsDto {
  @ApiPropertyOptional({
    enum: AnswerStyle,
    example: AnswerStyle.BALANCED,
    description: 'Preferred answer style',
  })
  @IsOptional()
  @IsEnum(AnswerStyle)
  answerStyle?: 'professional' | 'balanced' | 'simple';

  @ApiPropertyOptional({
    enum: AnswerLength,
    example: AnswerLength.MEDIUM,
    description: 'Preferred answer length',
  })
  @IsOptional()
  @IsEnum(AnswerLength)
  answerLength?: 'short' | 'medium' | 'long';

  @ApiPropertyOptional({
    example: true,
    description: 'Enable automatic transcription',
  })
  @IsOptional()
  @IsBoolean()
  autoTranscribe?: boolean;
}

class PrivacySettingsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Save interview history',
  })
  @IsOptional()
  @IsBoolean()
  saveHistory?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Share analytics data',
  })
  @IsOptional()
  @IsBoolean()
  shareAnalytics?: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    example: 'en',
    description: 'Preferred language (ISO 639-1 code)',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    type: NotificationPreferencesDto,
    description: 'Notification preferences',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPreferencesDto)
  notifications?: NotificationPreferencesDto;

  @ApiPropertyOptional({
    type: InterviewSettingsDto,
    description: 'Interview settings',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InterviewSettingsDto)
  interviewSettings?: InterviewSettingsDto;

  @ApiPropertyOptional({
    type: PrivacySettingsDto,
    description: 'Privacy settings',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacySettingsDto)
  privacy?: PrivacySettingsDto;
}
