import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorAuth, TwoFactorAuthSchema } from './schemas/two-factor-auth.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

/**
 * Two-Factor Authentication Module
 * Provides TOTP (Time-based One-Time Password) 2FA
 * Compatible with Google Authenticator, Authy, etc.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TwoFactorAuth.name, schema: TwoFactorAuthSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
