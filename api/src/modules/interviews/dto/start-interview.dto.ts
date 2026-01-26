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
    enum: ['junior', 'middle', 'senior'],
    example: 'middle',
  })
  @IsEnum(['junior', 'middle', 'senior'])
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
    description: 'Number of questions (30-50)',
    example: 30,
  })
  @IsNumber()
  @Min(30)
  @Max(50)
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

  @ApiPropertyOptional({
    description: 'CV context for personalized questions (skills, experience, etc.)',
    example: { skills: ['React', 'Node.js'], experience: '3 years' },
  })
  @IsOptional()
  cvContext?: {
    skills?: string[];
    experience?: string;
    strengths?: string[];
    summary?: string;
  };
}
