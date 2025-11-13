import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebsocketGateway } from './websocket.gateway';
import { WsJwtGuard } from './ws-jwt.guard';
import { AiModule } from '../ai/ai.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
      }),
      inject: [ConfigService],
    }),
    ConfigModule,
    AiModule,
    UsersModule,
  ],
  providers: [WebsocketGateway, WsJwtGuard],
})
export class WebsocketModule {}
