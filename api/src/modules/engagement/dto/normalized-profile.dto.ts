import { IsArray, IsEnum, IsNumber, IsString } from 'class-validator';

export class NormalizedProfileDto {
  @IsEnum(['junior', 'middle', 'senior', 'lead'])
  position: 'junior' | 'middle' | 'senior' | 'lead';

  @IsArray()
  @IsString({ each: true })
  techStack: string[];

  @IsEnum(['job_search', 'career_growth', 'learning'])
  goal: 'job_search' | 'career_growth' | 'learning';

  @IsNumber()
  confidence: number;
}
