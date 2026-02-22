import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class NormalizedProfileDto {
  @IsEnum(['junior', 'middle', 'senior', 'lead'])
  position: 'junior' | 'middle' | 'senior' | 'lead';

  @IsArray()
  @IsString({ each: true })
  techStack: string[];

  @IsEnum(['job_search', 'career_growth', 'learning'])
  goal: 'job_search' | 'career_growth' | 'learning';

  @IsOptional()
  @IsEnum(['frontend', 'backend', 'mobile', 'fullstack', 'devops', 'ai_ml', 'data', 'qa', 'general'])
  domain?: 'frontend' | 'backend' | 'mobile' | 'fullstack' | 'devops' | 'ai_ml' | 'data' | 'qa' | 'general';

  @IsNumber()
  confidence: number;
}
