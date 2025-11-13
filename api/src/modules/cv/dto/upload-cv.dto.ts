import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadCvDto {
  @ApiPropertyOptional({
    example: 'Looking for a Senior Backend Developer position with Node.js expertise...',
    description: 'Job description to tailor the analysis (optional)',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Job description must not exceed 5000 characters' })
  jobDescription?: string;
}
