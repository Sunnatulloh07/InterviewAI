import { Controller, Post, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TwoFactorService } from './two-factor.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * Two-Factor Authentication Controller
 */
@ApiTags('Two-Factor Authentication')
@Controller('two-factor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  /**
   * Get 2FA status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get 2FA status' })
  @ApiResponse({ status: 200, description: '2FA status' })
  async getStatus(@CurrentUser() user: any) {
    return this.twoFactorService.getStatus(user.id);
  }

  /**
   * Generate 2FA secret (step 1)
   */
  @Post('generate')
  @ApiOperation({ summary: 'Generate 2FA secret and QR code' })
  @ApiResponse({ status: 200, description: '2FA secret and QR code generated' })
  async generate(@CurrentUser() user: any) {
    return this.twoFactorService.generateSecret(user.id, user.email);
  }

  /**
   * Enable 2FA (step 2)
   */
  @Post('enable')
  @ApiOperation({ summary: 'Enable 2FA after verifying token' })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async enable(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactorService.enable(user.id, token);
  }

  /**
   * Disable 2FA
   */
  @Delete('disable')
  @ApiOperation({ summary: 'Disable 2FA' })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async disable(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactorService.disable(user.id, token);
  }

  /**
   * Verify 2FA token
   */
  @Post('verify')
  @ApiOperation({ summary: 'Verify 2FA token' })
  @ApiResponse({ status: 200, description: 'Token verified successfully' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verify(@CurrentUser() user: any, @Body('token') token: string) {
    const verified = await this.twoFactorService.verify(user.id, token);
    return { verified };
  }

  /**
   * Regenerate backup codes
   */
  @Post('backup-codes/regenerate')
  @ApiOperation({ summary: 'Regenerate backup codes' })
  @ApiResponse({ status: 200, description: 'Backup codes regenerated' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async regenerateBackupCodes(@CurrentUser() user: any, @Body('token') token: string) {
    return this.twoFactorService.regenerateBackupCodes(user.id, token);
  }
}
