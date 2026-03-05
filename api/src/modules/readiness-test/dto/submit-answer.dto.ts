import { IsNumber, IsString, MaxLength, Min } from 'class-validator';

export class SubmitIrsAnswerDto {
  @IsString()
  @MaxLength(5000)
  answer: string;

  @IsNumber()
  @Min(0)
  timeTaken: number; // seconds
}
