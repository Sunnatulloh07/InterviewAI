import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InterviewQuestionResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: 1 })
  order: number;

  @ApiProperty({ example: 'technical' })
  category: string;

  @ApiProperty({ example: 'mid' })
  difficulty: string;

  @ApiProperty({
    example: 'Explain the difference between async/await and Promises in JavaScript.',
  })
  question: string;

  @ApiPropertyOptional({ type: [String] })
  expectedKeyPoints?: string[];

  @ApiPropertyOptional({ example: 300 })
  timeLimit?: number;

  @ApiPropertyOptional({ type: [String] })
  hints?: string[];
}

export class InterviewAnswerResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: 'text' })
  answerType: string;

  @ApiProperty({ example: 'Async/await is syntactic sugar built on top of Promises...' })
  content: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/...' })
  audioUrl?: string;

  @ApiProperty({ example: 120 })
  duration: number;

  @ApiPropertyOptional({ example: 8.5 })
  score?: number;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      score: { type: 'number' },
      strengths: { type: 'array', items: { type: 'string' } },
      improvements: { type: 'array', items: { type: 'string' } },
      keyPointsCovered: { type: 'array', items: { type: 'string' } },
      keyPointsMissed: { type: 'array', items: { type: 'string' } },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
  })
  feedback?: any;

  @ApiProperty()
  submittedAt: Date;
}

export class InterviewSessionResponseDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ example: 'technical' })
  type: string;

  @ApiProperty({ example: 'mid' })
  difficulty: string;

  @ApiPropertyOptional({ example: 'frontend' })
  domain?: string;

  @ApiPropertyOptional({ type: [String], example: ['react', 'typescript'] })
  technology?: string[];

  @ApiProperty({ example: 10 })
  numQuestions: number;

  @ApiProperty({ example: 'text' })
  mode: string;

  @ApiPropertyOptional({ example: 5 })
  timeLimit?: number;

  @ApiProperty({ example: 'active', enum: ['active', 'paused', 'completed', 'abandoned'] })
  status: string;

  @ApiProperty({ example: 3 })
  currentQuestionIndex: number;

  @ApiProperty({ type: [InterviewQuestionResponseDto] })
  questions: InterviewQuestionResponseDto[];

  @ApiProperty({ type: [InterviewAnswerResponseDto] })
  answers: InterviewAnswerResponseDto[];

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  completedAt?: Date;

  @ApiPropertyOptional({ example: 85.5 })
  overallScore?: number;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      overallScore: { type: 'number' },
      ratings: {
        type: 'object',
        properties: {
          technicalAccuracy: { type: 'number' },
          communication: { type: 'number' },
          structuredThinking: { type: 'number' },
          confidence: { type: 'number' },
          problemSolving: { type: 'number' },
        },
      },
      summary: {
        type: 'object',
        properties: {
          strengths: { type: 'array', items: { type: 'string' } },
          weaknesses: { type: 'array', items: { type: 'string' } },
          topConcerns: { type: 'array', items: { type: 'string' } },
        },
      },
      recommendations: { type: 'array', items: { type: 'string' } },
    },
  })
  feedback?: any;
}
