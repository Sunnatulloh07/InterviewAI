import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly otpLength: number;
  private readonly otpExpiry: number; // in minutes

  constructor(private readonly configService: ConfigService) {
    this.otpLength = this.configService.get<number>('OTP_LENGTH', 6);
    this.otpExpiry = this.configService.get<number>('OTP_EXPIRY_MINUTES', 5);
  }

  /**
   * Generate a random OTP code
   */
  generateOtp(): string {
    const digits = '0123456789';
    let otp = '';

    for (let i = 0; i < this.otpLength; i++) {
      const randomIndex = crypto.randomInt(0, digits.length);
      otp += digits[randomIndex];
    }

    this.logger.debug(`Generated OTP: ${otp}`);
    return otp;
  }

  /**
   * Get OTP expiry date
   */
  getOtpExpiry(): Date {
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + this.otpExpiry);
    return expiryDate;
  }

  /**
   * Validate OTP code
   */
  validateOtp(
    inputOtp: string,
    storedOtp: string,
    otpExpires: Date,
    otpAttempts: number,
  ): { valid: boolean; message?: string } {
    // Check max attempts
    const maxAttempts = this.configService.get<number>('OTP_MAX_ATTEMPTS', 3);
    if (otpAttempts >= maxAttempts) {
      return {
        valid: false,
        message: 'Maximum OTP attempts exceeded. Please request a new code.',
      };
    }

    // Check expiry
    if (new Date() > otpExpires) {
      return {
        valid: false,
        message: 'OTP code has expired. Please request a new code.',
      };
    }

    // Check code match
    if (inputOtp !== storedOtp) {
      return {
        valid: false,
        message: 'Invalid OTP code.',
      };
    }

    return { valid: true };
  }

  /**
   * Hash OTP for secure storage
   */
  hashOtp(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Format phone number to international format
   */
  formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // Add + prefix if not present
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  /**
   * Validate phone number format
   */
  validatePhoneNumber(phoneNumber: string): boolean {
    // Basic validation: should start with + and have 10-15 digits
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    return phoneRegex.test(phoneNumber);
  }

  /**
   * Send OTP via Telegram bot
   * This method will be called by Telegram bot service
   */
  async sendOtpViaTelegram(
    phoneNumber: string,
    otp: string,
    telegramChatId: number,
  ): Promise<void> {
    try {
      this.logger.log(`Sending OTP to phone: ${phoneNumber}, chat: ${telegramChatId}`);

      // TODO: Implement actual Telegram message sending
      // This will be handled by TelegramService
      // For now, just log
      this.logger.debug(`OTP: ${otp} for phone: ${phoneNumber}`);

      // In production, the Telegram bot will send:
      // "Your verification code is: {otp}\nThis code will expire in {expiry} minutes."
    } catch (error) {
      this.logger.error(`Failed to send OTP via Telegram: ${error.message}`);
      throw new BadRequestException('Failed to send verification code');
    }
  }
}
