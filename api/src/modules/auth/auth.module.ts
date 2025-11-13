import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Import modules
import { UsersModule } from '../users/users.module';
import { OtpModule } from '../otp/otp.module';

// Import controllers and services
import { AuthController } from './auth.controller';
import { AuthTelegramService } from './auth-telegram.service';

// Import strategies
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

@Module({
  imports: [
    UsersModule,
    OtpModule,
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        ({
          secret: configService.get<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            expiresIn: configService.get<number>('JWT_ACCESS_EXPIRATION', 900),
            algorithm: 'HS256',
          },
        }) as JwtModuleOptions,
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthTelegramService, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthTelegramService, JwtModule, PassportModule],
})
export class AuthModule {}
