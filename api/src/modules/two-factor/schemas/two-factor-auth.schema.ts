import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Two-Factor Authentication Schema
 * Stores TOTP secrets and backup codes
 */
@Schema({
  timestamps: true,
  collection: 'two_factor_auth',
})
export class TwoFactorAuth extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  // TOTP Secret (encrypted)
  @Prop({ required: true, select: false })
  secret: string;

  // QR Code data URL (temporary, for initial setup)
  @Prop({ select: false })
  qrCodeUrl?: string;

  // Whether 2FA is enabled
  @Prop({ default: false })
  enabled: boolean;

  // Backup codes (hashed)
  @Prop({ type: [String], default: [], select: false })
  backupCodes: string[];

  // Number of backup codes used
  @Prop({ default: 0 })
  backupCodesUsed: number;

  // Last verification timestamp
  @Prop()
  lastVerifiedAt?: Date;

  // Failed verification attempts (for rate limiting)
  @Prop({ default: 0 })
  failedAttempts: number;

  // Last failed attempt timestamp
  @Prop()
  lastFailedAttemptAt?: Date;

  // Account locked until (if too many failed attempts)
  @Prop()
  lockedUntil?: Date;

  // Timestamps
  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const TwoFactorAuthSchema = SchemaFactory.createForClass(TwoFactorAuth);

// Indexes for performance
TwoFactorAuthSchema.index({ userId: 1 }, { unique: true });
TwoFactorAuthSchema.index({ enabled: 1 });
TwoFactorAuthSchema.index({ lockedUntil: 1 });
