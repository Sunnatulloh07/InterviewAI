import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { JwtPayload } from '@common/interfaces/jwt-payload.interface';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          // Extract from Authorization header
          const authHeader = request.headers?.authorization;
          if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
          }

          // Extract from body (for refresh token endpoint)
          return request.body?.refreshToken || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret',
      algorithms: ['HS256'],
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token payload');
    }

    // Verify user still exists and is active
    try {
      const user = await this.usersService.findById(payload.sub);

      if (!user || user.deletedAt) {
        throw new UnauthorizedException('User not found or account deleted');
      }

      // Return user object
      return {
        id: user.id,
        email: user.email,
        role: user.role,
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
