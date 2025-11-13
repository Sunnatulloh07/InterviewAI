import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export class SubmitAnswerDto {
  @ApiProperty({
    description: 'Question ID being answered',
    example: '507f1f77bcf86cd799439011',
  })
  @IsString()
  questionId: string;

  @ApiProperty({
    description: 'Answer type',
    enum: ['text', 'audio'],
    example: 'text',
  })
  @IsEnum(['text', 'audio'])
  answerType: string;

  @ApiPropertyOptional({
    description: 'Text answer content',
    example: 'In my previous role, I implemented a microservices architecture...',
  })
  @IsOptional()
  @IsString()
  answerText?: string;

  @ApiPropertyOptional({
    description: 'Audio file URL (if audio answer)',
    example: 'https://s3.amazonaws.com/bucket/audio/12345.webm',
  })
  @IsOptional()
  @IsString()
  audioUrl?: string;

  @ApiPropertyOptional({
    description: 'Audio transcript (if audio answer)',
  })
  @IsOptional()
  @IsString()
  transcript?: string;

  @ApiProperty({
    description: 'Time taken to answer in seconds',
    example: 120,
  })
  @IsNumber()
  @Min(1)
  duration: number;
}
