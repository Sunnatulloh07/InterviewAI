import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';
import { TelegramWebhookDto, SendOtpDto } from './dto/telegram-webhook.dto';
import { Public } from '@common/decorators/public.decorator';

@ApiTags('Telegram Bot')
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Telegram webhook handler',
    description: 'Receives updates from Telegram Bot API',
  })
  @ApiResponse({ status: 200, description: 'Update processed' })
  async handleWebhook(@Body() dto: TelegramWebhookDto) {
    await this.telegramService.handleUpdate(dto.update);
    return { ok: true };
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Send OTP via Telegram',
    description: 'Internal endpoint for sending OTP codes via Telegram bot',
  })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  async sendOtp(@Body() dto: SendOtpDto) {
    await this.telegramService.sendOtp(dto.telegramChatId, dto.otpCode, dto.phoneNumber);
    return { success: true };
  }
}
