import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsEnum, IsNumber, IsArray, IsOptional, Min, Max } from 'class-validator';

export class StartInterviewDto {
  @ApiProperty({
    description: 'Interview type',
    enum: ['technical', 'behavioral', 'case_study', 'mixed'],
    example: 'technical',
  })
  @IsEnum(['technical', 'behavioral', 'case_study', 'mixed'])
  type: string;

  @ApiProperty({
    description: 'Difficulty level',
    enum: ['junior', 'mid', 'senior'],
    example: 'mid',
  })
  @IsEnum(['junior', 'mid', 'senior'])
  difficulty: string;

  @ApiPropertyOptional({
    description: 'Domain/field',
    example: 'frontend',
  })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({
    description: 'Technologies/skills to focus on',
    type: [String],
    example: ['react', 'typescript', 'node.js'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  technology?: string[];

  @ApiProperty({
    description: 'Number of questions (5-20)',
    example: 10,
  })
  @IsNumber()
  @Min(5)
  @Max(20)
  numQuestions: number;

  @ApiProperty({
    description: 'Answer mode',
    enum: ['audio', 'text'],
    example: 'text',
  })
  @IsEnum(['audio', 'text'])
  mode: string;

  @ApiPropertyOptional({
    description: 'Time limit per question in minutes',
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(15)
  timeLimit?: number;

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
