import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { TwoFactorAuth } from './schemas/two-factor-auth.schema';
import { User } from '../users/schemas/user.schema';
import { LoggerService } from '../../common/logger/logger.service';
import { AuditEventType } from '../../common/logger/winston.config';

/**
 * Two-Factor Authentication Service
 * Implements TOTP (Time-based One-Time Password)
 */
@Injectable()
export class TwoFactorService {
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    @InjectModel(TwoFactorAuth.name) private twoFactorAuthModel: Model<TwoFactorAuth>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('TwoFactorService');
  }

  /**
   * Generate 2FA secret and QR code for user
   */
  async generateSecret(userId: string, userEmail: string) {
    // Check if 2FA already enabled
    const existing = await this.twoFactorAuthModel.findOne({ userId: new Types.ObjectId(userId) });
    if (existing?.enabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `InterviewAI Pro (${userEmail})`,
      issuer: 'InterviewAI Pro',
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Generate backup codes
    const backupCodes = this.generateBackupCodes(10);
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(code, 12)),
    );

    // Save or update 2FA record
    await this.twoFactorAuthModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        secret: secret.base32,
        qrCodeUrl,
        enabled: false,
        backupCodes: hashedBackupCodes,
        backupCodesUsed: 0,
        failedAttempts: 0,
      },
      { upsert: true, new: true },
    );

    this.logger.log(`2FA secret generated for user ${userId}`);

    return {
      secret: secret.base32,
      qrCodeUrl,
      backupCodes, // Return plain text backup codes only once
    };
  }

  /**
   * Enable 2FA after verifying initial token
   */
  async enable(userId: string, token: string) {
    const twoFa = await this.twoFactorAuthModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('+secret');

    if (!twoFa) {
      throw new BadRequestException('2FA not set up. Generate secret first');
    }

    if (twoFa.enabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: twoFa.secret,
      encoding: 'base32',
      token,
      window: 2, // Allow 2 time steps tolerance
    });

    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Enable 2FA
    twoFa.enabled = true;
    twoFa.lastVerifiedAt = new Date();
    twoFa.qrCodeUrl = undefined; // Remove QR code after setup
    await twoFa.save();

    // Log audit event
    this.logger.audit({
      eventType: AuditEventType.TWO_FA_ENABLED,
      userId,
      result: 'success',
    });

    this.logger.log(`2FA enabled for user ${userId}`);

    return { enabled: true };
  }

  /**
   * Disable 2FA
   */
  async disable(userId: string, token: string) {
    const twoFa = await this.twoFactorAuthModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('+secret +backupCodes');

    if (!twoFa || !twoFa.enabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify token or backup code
    const verified = await this.verifyTokenOrBackupCode(twoFa, token);

    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Disable 2FA
    await this.twoFactorAuthModel.deleteOne({ userId: new Types.ObjectId(userId) });

    // Log audit event
    this.logger.audit({
      eventType: AuditEventType.TWO_FA_DISABLED,
      userId,
      result: 'success',
    });

    this.logger.log(`2FA disabled for user ${userId}`);

    return { enabled: false };
  }

  /**
   * Verify 2FA token
   */
  async verify(userId: string, token: string): Promise<boolean> {
    const twoFa = await this.twoFactorAuthModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('+secret +backupCodes');

    if (!twoFa || !twoFa.enabled) {
      return true; // 2FA not enabled, consider as verified
    }

    // Check if account is locked
    if (twoFa.lockedUntil && twoFa.lockedUntil > new Date()) {
      const remainingMs = twoFa.lockedUntil.getTime() - Date.now();
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      throw new UnauthorizedException(
        `Account locked due to too many failed attempts. Try again in ${remainingMinutes} minutes`,
      );
    }

    // Verify token or backup code
    const verified = await this.verifyTokenOrBackupCode(twoFa, token);

    if (verified) {
      // Reset failed attempts on success
      twoFa.failedAttempts = 0;
      twoFa.lastFailedAttemptAt = undefined;
      twoFa.lockedUntil = undefined;
      twoFa.lastVerifiedAt = new Date();
      await twoFa.save();

      // Log audit event
      this.logger.audit({
        eventType: AuditEventType.TWO_FA_VERIFIED,
        userId,
        result: 'success',
      });

      return true;
    }

    // Increment failed attempts
    twoFa.failedAttempts += 1;
    twoFa.lastFailedAttemptAt = new Date();

    // Lock account if too many failed attempts
    if (twoFa.failedAttempts >= this.MAX_FAILED_ATTEMPTS) {
      twoFa.lockedUntil = new Date(Date.now() + this.LOCK_DURATION_MS);
      await twoFa.save();

      this.logger.security('2FA account locked due to failed attempts', 'high', { userId });

      throw new UnauthorizedException(
        'Too many failed attempts. Account locked for 15 minutes',
      );
    }

    await twoFa.save();

    // Log audit event
    this.logger.audit({
      eventType: AuditEventType.TWO_FA_VERIFIED,
      userId,
      result: 'failure',
      metadata: { failedAttempts: twoFa.failedAttempts },
    });

    throw new UnauthorizedException(
      `Invalid verification code. ${this.MAX_FAILED_ATTEMPTS - twoFa.failedAttempts} attempts remaining`,
    );
  }

  /**
   * Check if 2FA is enabled for user
   */
  async isEnabled(userId: string): Promise<boolean> {
    const twoFa = await this.twoFactorAuthModel.findOne({
      userId: new Types.ObjectId(userId),
      enabled: true,
    });
    return !!twoFa;
  }

  /**
   * Get 2FA status
   */
  async getStatus(userId: string) {
    const twoFa = await this.twoFactorAuthModel.findOne({ userId: new Types.ObjectId(userId) });

    if (!twoFa) {
      return { enabled: false };
    }

    return {
      enabled: twoFa.enabled,
      backupCodesRemaining: twoFa.backupCodes.length - twoFa.backupCodesUsed,
      lastVerifiedAt: twoFa.lastVerifiedAt,
    };
  }

  /**
   * Regenerate backup codes
   */
  async regenerateBackupCodes(userId: string, token: string) {
    const twoFa = await this.twoFactorAuthModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('+secret +backupCodes');

    if (!twoFa || !twoFa.enabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: twoFa.secret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Generate new backup codes
    const backupCodes = this.generateBackupCodes(10);
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(code, 12)),
    );

    twoFa.backupCodes = hashedBackupCodes;
    twoFa.backupCodesUsed = 0;
    await twoFa.save();

    this.logger.log(`Backup codes regenerated for user ${userId}`);

    return { backupCodes };
  }

  /**
   * Verify token or backup code
   */
  private async verifyTokenOrBackupCode(twoFa: TwoFactorAuth, token: string): Promise<boolean> {
    // Try TOTP token first
    const totpVerified = speakeasy.totp.verify({
      secret: twoFa.secret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (totpVerified) {
      return true;
    }

    // Try backup codes
    for (let i = 0; i < twoFa.backupCodes.length; i++) {
      const isMatch = await bcrypt.compare(token, twoFa.backupCodes[i]);
      if (isMatch) {
        // Remove used backup code
        twoFa.backupCodes.splice(i, 1);
        twoFa.backupCodesUsed += 1;
        await twoFa.save();

        this.logger.warn(`Backup code used for user ${twoFa.userId}`, {
          backupCodesRemaining: twoFa.backupCodes.length,
        });

        return true;
      }
    }

    return false;
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      codes.push(code);
    }
    return codes;
  }
}
