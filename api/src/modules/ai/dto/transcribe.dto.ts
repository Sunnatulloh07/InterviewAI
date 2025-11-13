import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, Min, Max } from 'class-validator';

export class TranscribeDto {
  @ApiProperty({
    description: 'Base64 encoded audio data',
    example: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd...',
  })
  @IsString()
  audioData: string;

  @ApiPropertyOptional({
    description: 'Language code (ISO 639-1). Auto-detect if not provided.',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Context/prompt to improve accuracy',
    example: 'Technical interview about React and Node.js',
  })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiPropertyOptional({
    description: 'Temperature for transcription (0-1)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  temperature?: number;
}

export class TranscriptionResponseDto {
  @ApiProperty({
    description: 'Transcribed text',
    example: 'What is the difference between var, let, and const in JavaScript?',
  })
  text: string;

  @ApiProperty({
    description: 'Detected language',
    example: 'en',
  })
  language: string;

  @ApiProperty({
    description: 'Confidence score (0-1)',
    example: 0.95,
  })
  confidence: number;

  @ApiProperty({
    description: 'Audio duration in seconds',
    example: 5.2,
  })
  duration: number;

  @ApiPropertyOptional({
    description: 'Transcript segments with timestamps',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        start: { type: 'number' },
        end: { type: 'number' },
        text: { type: 'string' },
        confidence: { type: 'number' },
      },
    },
  })
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    confidence: number;
  }>;
}
