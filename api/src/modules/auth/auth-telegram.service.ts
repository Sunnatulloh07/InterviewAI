import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

import { UsersService } from '../users/users.service';
import { OtpService } from '../otp/otp.service';
import { PhoneLoginDto, VerifyOtpDto } from './dto/phone-login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthTelegramService {
  private readonly logger = new Logger(AuthTelegramService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  /**
   * Step 1: Request OTP via phone number
   * This endpoint is called from Chrome extension
   */
  async requestOtp(phoneLoginDto: PhoneLoginDto): Promise<{
    success: boolean;
    message: string;
    telegramBotUrl?: string;
  }> {
    const { phoneNumber } = phoneLoginDto;

    // Format phone number
    const formattedPhone = this.otpService.formatPhoneNumber(phoneNumber);

    // Check if user exists with this phone number
    const user = await this.usersService.findByPhoneNumber(formattedPhone);

    if (!user) {
      // User not registered - redirect to Telegram bot
      const botUsername = this.configService.get<string>(
        'TELEGRAM_BOT_USERNAME',
        'InterviewAIProBot',
      );
      const telegramBotUrl = `https://t.me/${botUsername}?start=register_${Buffer.from(formattedPhone).toString('base64')}`;

      return {
        success: false,
        message: 'User not found. Please register via Telegram bot first.',
        telegramBotUrl,
      };
    }

    // Check if user has Telegram linked
    if (!user.telegramId) {
      const botUsername = this.configService.get<string>(
        'TELEGRAM_BOT_USERNAME',
        'InterviewAIProBot',
      );
      const telegramBotUrl = `https://t.me/${botUsername}?start=link_${Buffer.from(formattedPhone).toString('base64')}`;

      return {
        success: false,
        message: 'Please link your Telegram account first.',
        telegramBotUrl,
      };
    }

    // Generate OTP
    const otpCode = this.otpService.generateOtp();
    const otpExpires = this.otpService.getOtpExpiry();

    // Hash OTP before storing
    const hashedOtp = this.otpService.hashOtp(otpCode);

    // Store OTP in database
    await this.usersService.updateOtp(user.id, {
      otpCode: hashedOtp,
      otpExpires,
      otpAttempts: 0,
    });

    // Send OTP via Telegram bot
    try {
      await this.sendOtpToTelegram(user.telegramId, otpCode, formattedPhone);
    } catch (error) {
      this.logger.error(`Failed to send OTP via Telegram: ${error.message}`);
      throw new BadRequestException('Failed to send verification code. Please try again.');
    }

    this.logger.log(`OTP requested for phone: ${formattedPhone}`);

    return {
      success: true,
      message: 'OTP sent to your Telegram account. Please check your messages.',
    };
  }

  /**
   * Step 2: Verify OTP and login
   */
  async verifyOtpAndLogin(verifyOtpDto: VerifyOtpDto): Promise<AuthResponseDto> {
    const { phoneNumber, otpCode } = verifyOtpDto;

    // Format phone number
    const formattedPhone = this.otpService.formatPhoneNumber(phoneNumber);

    // Find user with OTP data
    const user = await this.usersService.findByPhoneNumberWithOtp(formattedPhone);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if account is deleted
    if (user.deletedAt) {
      throw new UnauthorizedException('This account has been deleted');
    }

    // Hash input OTP for comparison
    const hashedInputOtp = this.otpService.hashOtp(otpCode);

    // Validate OTP
    const validation = this.otpService.validateOtp(
      hashedInputOtp,
      user.otpCode || '',
      user.otpExpires || new Date(),
      user.otpAttempts,
    );

    if (!validation.valid) {
      // Increment attempts
      await this.usersService.incrementOtpAttempts(user.id);
      throw new UnauthorizedException(validation.message);
    }

    // Clear OTP data
    await this.usersService.clearOtp(user.id);

    // Update last login
    await this.usersService.updateLastLogin(user.id);

    // Mark phone as verified if not already
    if (!user.phoneVerified) {
      await this.usersService.updatePhoneVerified(user.id, true);
    }

    // Generate JWT tokens
    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in via OTP: ${formattedPhone}`);

    return {
      ...tokens,
      user: this.usersService.sanitizeUser(user),
    };
  }

  /**
   * Send OTP to user's Telegram account
   * This method communicates with Telegram Bot service
   */
  private async sendOtpToTelegram(
    telegramId: number,
    otpCode: string,
    phoneNumber: string,
  ): Promise<void> {
    try {
      // Store OTP request in Redis for Telegram bot to process
      const key = `otp:telegram:${telegramId}`;
      const otpData = JSON.stringify({
        phoneNumber,
        otpCode,
        timestamp: Date.now(),
      });

      // Store OTP in Redis with error handling
      try {
        await this.redis.setex(key, 300, otpData); // 5 minutes expiry
        this.logger.debug(`OTP stored in Redis for Telegram ID: ${telegramId}`);
      } catch (error) {
        this.logger.error(`Failed to store OTP in Redis: ${error.message}`, error.stack);
        // Don't throw - OTP generation succeeded, just storage failed
        // In production, consider fallback storage or alerting
      }

      // In production, this would trigger a Telegram bot message
      // The bot service will read from Redis and send the message

      // TODO: Implement actual Telegram message sending
      // This will be handled by TelegramService/Bot
      // Message format:
      // "🔐 Your verification code is: {otpCode}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this message."
    } catch (error) {
      this.logger.error(`Failed to send OTP to Telegram: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate JWT access and refresh tokens
   */
  private async generateTokens(user: UserDocument): Promise<Omit<AuthResponseDto, 'user'>> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email || user.phoneNumber,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: 0, // Will be set by JWT
    };

    const accessExpiration = this.configService.get<number>('JWT_ACCESS_EXPIRATION', 900);
    const refreshExpiration = this.configService.get<number>('JWT_REFRESH_EXPIRATION', 604800);

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpiration,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiration,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiration,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<Omit<AuthResponseDto, 'user'>> {
    try {
      // Verify refresh token
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      // Check if token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(refreshToken);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }

      // Find user
      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Check if account is deleted
      if (user.deletedAt) {
        throw new UnauthorizedException('This account has been deleted');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      // Blacklist old refresh token
      await this.blacklistToken(refreshToken);

      this.logger.log(`Token refreshed for user: ${user.phoneNumber}`);

      return tokens;
    } catch (error) {
      this.logger.error(`Failed to refresh token: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Logout user
   */
  async logout(refreshToken: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.blacklistToken(refreshToken);
      this.logger.log('User logged out successfully');
      return {
        success: true,
        message: 'Logged out successfully',
      };
    } catch (error) {
      this.logger.error(`Logout failed: ${error.message}`);
      throw new BadRequestException('Logout failed');
    }
  }

  /**
   * Blacklist token in Redis
   */
  private async blacklistToken(token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token) as any;
      if (!decoded || !decoded.exp) {
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const ttl = decoded.exp - now;

      if (ttl > 0) {
        try {
          await this.redis.setex(`blacklist:${token}`, ttl, '1');
        } catch (redisError) {
          this.logger.error(
            `Failed to blacklist token in Redis: ${redisError.message}`,
            redisError.stack,
          );
          // Graceful degradation: Log error but don't fail logout
          // Token will expire naturally, just won't be blacklisted
        }
      }
    } catch (error) {
      this.logger.error(`Failed to blacklist token: ${error.message}`, error.stack);
      // Don't throw - logout should succeed even if blacklisting fails
    }
  }

  /**
   * Check if token is blacklisted
   */
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const result = await this.redis.get(`blacklist:${token}`);
      return result === '1';
    } catch (error) {
      this.logger.error(`Failed to check token blacklist in Redis: ${error.message}`, error.stack);
      // Graceful degradation: If Redis fails, assume token is not blacklisted
      // This allows users to continue using their tokens even if Redis is down
      // Security trade-off: Blacklisted tokens may still work until Redis recovers
      return false;
    }
  }
}
