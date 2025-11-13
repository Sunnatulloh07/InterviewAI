import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PhoneLoginDto {
  @ApiProperty({
    description: 'Phone number in international format (e.g., +998901234567)',
    example: '+998901234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, {
    message: 'Phone number must be in international format (e.g., +998901234567)',
  })
  phoneNumber: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Phone number in international format',
    example: '+998901234567',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{9,14}$/, {
    message: 'Phone number must be in international format',
  })
  phoneNumber: string;

  @ApiProperty({
    description: '6-digit OTP code sent to Telegram',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, {
    message: 'OTP must be exactly 6 digits',
  })
  otpCode: string;
}
