import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class TelegramWebhookDto {
  @ApiProperty({
    description: 'Telegram update object',
    type: 'object',
    additionalProperties: false,
    properties: {
      update: {
        type: 'object',
        additionalProperties: false,
      },
    },
    required: ['update'],
  })
  @IsObject()
  update: any;
}

export class SendOtpDto {
  @ApiProperty({
    description: 'Telegram chat ID',
    example: 123456789,
  })
  telegramChatId: number;

  @ApiProperty({
    description: 'OTP code',
    example: '123456',
  })
  otpCode: string;

  @ApiProperty({
    description: 'Phone number',
    example: '+998901234567',
  })
  phoneNumber: string;
}
