import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const client: Socket = context.switchToWs().getClient();
      const token = this.extractToken(client);

      if (!token) {
        return false;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      client.data.userId = payload.sub;
      client.data.user = payload;

      return true;
    } catch {
      return false;
    }
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth;
    if (auth && auth.token) {
      return auth.token;
    }

    const query = client.handshake.query;
    if (query && query.token) {
      return query.token as string;
    }

    return null;
  }
}
