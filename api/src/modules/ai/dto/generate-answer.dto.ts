import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';

export class GenerateAnswerDto {
  @ApiProperty({
    description: 'Interview question',
    example: 'Tell me about a time when you had to resolve a conflict in your team.',
  })
  @IsString()
  question: string;

  @ApiPropertyOptional({
    description: 'Session ID for context continuity',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Target job description for tailored answers',
  })
  @IsOptional()
  @IsString()
  jobDescription?: string;

  @ApiPropertyOptional({
    description: 'Previous questions in the session',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previousQuestions?: string[];

  @ApiPropertyOptional({
    description: 'Previous answers in the session',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  previousAnswers?: string[];

  @ApiPropertyOptional({
    description: 'Answer style',
    enum: ['professional', 'balanced', 'simple'],
    default: 'professional',
  })
  @IsOptional()
  @IsEnum(['professional', 'balanced', 'simple'])
  style?: string;

  @ApiPropertyOptional({
    description: 'Answer length',
    enum: ['short', 'medium', 'long'],
    default: 'medium',
  })
  @IsOptional()
  @IsEnum(['short', 'medium', 'long'])
  length?: string;

  @ApiPropertyOptional({
    description: 'Number of answer variations',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  variations?: number;

  @ApiPropertyOptional({
    description: 'Include key points',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeKeyPoints?: boolean;

  @ApiPropertyOptional({
    description: 'Include follow-up questions',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeFollowups?: boolean;

  @ApiPropertyOptional({
    description: 'Response language code (ISO 639-1). Default: en',
    enum: ['uz', 'ru', 'en'],
    default: 'en',
    example: 'uz',
  })
  @IsOptional()
  @IsEnum(['uz', 'ru', 'en'])
  language?: string;
}

export class GeneratedAnswerDto {
  @ApiProperty({
    description: 'Answer variant type',
    example: 'professional',
  })
  variant: string;

  @ApiProperty({
    description: 'Generated answer content',
    example: 'In my previous role as a team lead...',
  })
  content: string;

  @ApiProperty({
    description: 'Key points to mention',
    type: [String],
    example: ['Leadership', 'Conflict resolution', 'Communication'],
  })
  keyPoints: string[];

  @ApiPropertyOptional({
    description: 'STAR method breakdown for behavioral questions',
    type: 'object',
    properties: {
      situation: { type: 'string' },
      task: { type: 'string' },
      action: { type: 'string' },
      result: { type: 'string' },
    },
  })
  starMethod?: {
    situation: string;
    task: string;
    action: string;
    result: string;
  };

  @ApiProperty({
    description: 'Confidence score (0-1)',
    example: 0.92,
  })
  confidence: number;

  @ApiProperty({
    description: 'Suggested follow-up questions',
    type: [String],
    example: ['Can you elaborate on the outcome?', 'What would you do differently?'],
  })
  suggestedFollowups: string[];
}

export class AnswerResponseDto {
  @ApiProperty({
    description: 'Generated answers',
    type: [GeneratedAnswerDto],
  })
  answers: GeneratedAnswerDto[];

  @ApiProperty({
    description: 'Processing time in milliseconds',
    example: 2456,
  })
  processingTime: number;

  @ApiProperty({
    description: 'Tokens used',
    example: 850,
  })
  tokensUsed: number;

  @ApiProperty({
    description: 'AI model used',
    example: 'gpt-4-turbo-preview',
  })
  model: string;

  @ApiProperty({
    description: 'Whether response was cached',
    example: false,
  })
  cached: boolean;

  @ApiPropertyOptional({
    description: 'Session ID for context',
    example: '507f1f77bcf86cd799439011',
  })
  sessionId?: string;
}
