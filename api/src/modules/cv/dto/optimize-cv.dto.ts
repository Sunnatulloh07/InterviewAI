import { IsOptional, IsString, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OptimizationLevel {
  LIGHT = 'light',
  MODERATE = 'moderate',
  AGGRESSIVE = 'aggressive',
}

export class OptimizeCvDto {
  @ApiProperty({
    enum: OptimizationLevel,
    example: OptimizationLevel.MODERATE,
    description: 'Level of optimization to apply',
  })
  @IsEnum(OptimizationLevel)
  optimizationLevel: OptimizationLevel;

  @ApiPropertyOptional({
    example: 'Senior Backend Developer',
    description: 'Target job role',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetRole?: string;

  @ApiPropertyOptional({
    example: 'Google',
    description: 'Target company name',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetCompany?: string;

  @ApiPropertyOptional({
    example: 'Looking for a Senior Backend Developer with Node.js and microservices expertise...',
    description: 'Target job description',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  jobDescription?: string;

  @ApiPropertyOptional({
    description: 'Response language code (ISO 639-1). Default: en',
    enum: ['uz', 'ru', 'en'],
    default: 'en',
    example: 'uz',
  })
  @IsOptional()
  @IsString()
  language?: string;
}
