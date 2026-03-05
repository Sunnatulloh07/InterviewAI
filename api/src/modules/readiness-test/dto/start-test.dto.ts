import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IRS_POSITIONS, IRS_TECH_STACKS } from '../constants/irs.constants';

export class StartIrsTestDto {
  @IsEnum(IRS_POSITIONS, {
    message: 'Position must be one of: junior, middle, senior, lead',
  })
  position: string;

  @IsString()
  techStack: string;

  @IsOptional()
  @IsEnum(['uz', 'ru', 'en'])
  language?: string;
}
