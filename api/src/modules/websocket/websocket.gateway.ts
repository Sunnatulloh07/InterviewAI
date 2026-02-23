import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { AiSttService } from '../ai/ai-stt.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { UsersService } from '../users/users.service';
import { WsJwtGuard } from './ws-jwt.guard';
import { SubscriptionService } from '../payments/subscription.service';

/**
 * WebSocket Gateway — Live Interview real-time audio streaming
 *
 * FIX BUG-02: CORS origin is now read from ALLOWED_ORIGINS env var
 *   (previously `origin: '*'` + `credentials: true` — browsers reject this combination).
 *
 * FIX BUG-03: Real-time quota enforcement on every audio:chunk event.
 *   Previously quota was only deducted on disconnect — users with 0 minutes
 *   remaining could stream indefinitely.
 */
@WebSocketGateway({
  cors: {
    // FIX BUG-02: origin is injected via factory — see corsOptions below.
    // Cannot use ConfigService directly in decorator, so we use a getter pattern.
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      // This gets replaced at runtime via onModuleInit — see configureServer()
      callback(null, true);
    },
    credentials: true,
  },
  namespace: '/ws',
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);

  /** socketId -> session start time (ms) */
  private readonly sessionStartTimes = new Map<string, number>();

  /**
   * Per-socket chunk counter for quota enforcement.
   * We check quota every N chunks (not every single chunk) to avoid
   * hammering the DB on every audio packet. Default: every 10 chunks ≈ every ~10s.
   */
  private readonly chunkCounters = new Map<string, number>();
  private static readonly QUOTA_CHECK_INTERVAL = 10;

  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly usersService: UsersService,
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * FIX BUG-02: Configure Socket.IO CORS after the server is created
   * so we can read ALLOWED_ORIGINS from ConfigService.
   *
   * NestJS WebSocketGateway decorator runs before DI, so ConfigService
   * is not available there. Instead we patch the adapter after init.
   */
  afterInit(server: Server) {
    const allowedOrigins = this.configService
      .get<string>('ALLOWED_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim());

    // Replace the placeholder CORS handler with the real one
    server.engine.on('headers', (headers: any) => {
      // Engine.IO level headers are already set by the adapter;
      // the origin check below is applied at Socket.IO handshake.
    });

    // Patch the cors option on the io server
    (server as any).engine.opts.cors = {
      origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (server-to-server, Postman, mobile apps)
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          return cb(null, true);
        }
        this.logger.warn(`WebSocket CORS rejected origin: ${origin}`);
        return cb(new Error(`Origin ${origin} not allowed`));
      },
      credentials: true,
    };

    this.logger.log(
      `WebSocket CORS configured. Allowed origins: ${allowedOrigins.join(', ')}`,
    );
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.chunkCounters.delete(client.id);
    await this.processSessionEnd(client);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('audio:chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { audioData: string; sessionId: string },
  ) {
    try {
      const userId = client.data.userId as string;

      // FIX BUG-03: Real-time quota enforcement.
      // Check every QUOTA_CHECK_INTERVAL chunks to balance accuracy vs DB load.
      const chunkCount = (this.chunkCounters.get(client.id) ?? 0) + 1;
      this.chunkCounters.set(client.id, chunkCount);

      if (chunkCount % WebsocketGateway.QUOTA_CHECK_INTERVAL === 1) {
        const status = await this.subscriptionService.getLiveInterviewStatus(userId);
        if (!status.allowed) {
          this.logger.warn(
            `Live quota exhausted for user=${userId}, reason=${status.reason}. Disconnecting.`,
          );
          client.emit('quota:exceeded', {
            message: 'Live interview quota exhausted. Session ended.',
            reason: status.reason,
            remainingMinutes: 0,
          });
          // Deduct whatever was used so far, then disconnect
          await this.processSessionEnd(client);
          client.disconnect(true);
          return;
        }

        // Warn client when < 5 minutes remain (so they can wrap up)
        if (status.remainingMinutes <= 5 && status.remainingMinutes > 0) {
          client.emit('quota:warning', {
            remainingMinutes: status.remainingMinutes,
            message: `Only ${status.remainingMinutes} minutes remaining in live session.`,
          });
        }
      }

      // Transcribe audio chunk
      const transcription = await this.sttService.transcribe({
        audioData: data.audioData,
        language: 'en',
      });

      client.emit('transcription:result', {
        sessionId: data.sessionId,
        text: transcription.text,
        confidence: transcription.confidence,
      });

      // Get user language preference (cached on client.data after first fetch)
      if (!client.data.language) {
        const user = await this.usersService.findById(userId);
        client.data.language = user?.preferences?.language || user?.language || 'en';
      }

      const answer = await this.answerService.generateAnswer(userId, {
        question: transcription.text,
        sessionId: data.sessionId,
        style: 'professional',
        length: 'medium',
        variations: 1,
        language: client.data.language,
      });

      client.emit('answer:generated', {
        sessionId: data.sessionId,
        answers: answer.answers,
        processingTime: answer.processingTime,
      });
    } catch (error) {
      this.logger.error(`Error processing audio: ${error.message}`);
      client.emit('error', { message: 'Failed to process audio' });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('session:join')
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const userId = client.data.userId as string;

    // Pre-flight quota check before allowing session to start
    const status = await this.subscriptionService.getLiveInterviewStatus(userId);
    if (!status.allowed) {
      client.emit('quota:exceeded', {
        message: 'No live interview minutes remaining. Please upgrade your plan.',
        reason: status.reason,
        remainingMinutes: 0,
      });
      return;
    }

    client.join(data.sessionId);
    this.sessionStartTimes.set(client.id, Date.now());
    this.chunkCounters.set(client.id, 0);

    this.logger.debug(
      `Session started: socket=${client.id}, user=${userId}, remaining=${status.remainingMinutes}min`,
    );

    client.emit('session:status', {
      joined: true,
      sessionId: data.sessionId,
      remainingMinutes: status.remainingMinutes,
    });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('session:leave')
  async handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.leave(data.sessionId);
    this.chunkCounters.delete(client.id);
    await this.processSessionEnd(client);
    client.emit('session:status', { left: true, sessionId: data.sessionId });
  }

  /**
   * Deduct actual minutes used when session ends.
   * Minutes are rounded UP to the nearest minute (business rule).
   */
  private async processSessionEnd(client: Socket) {
    const startTime = this.sessionStartTimes.get(client.id);
    if (startTime && client.data.userId) {
      const durationMs = Date.now() - startTime;
      const minutesUsed = Math.ceil(durationMs / (1000 * 60));

      if (minutesUsed > 0) {
        this.logger.log(
          `Session ended: socket=${client.id}, user=${client.data.userId}, duration=${minutesUsed}min`,
        );
        try {
          await this.subscriptionService.addLiveMinutes(client.data.userId, minutesUsed);
        } catch (error) {
          this.logger.error(
            `Failed to deduct minutes for user=${client.data.userId}: ${error.message}`,
          );
        }
      }

      this.sessionStartTimes.delete(client.id);
    }
  }
}
