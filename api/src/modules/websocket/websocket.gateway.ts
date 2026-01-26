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
import { AiSttService } from '../ai/ai-stt.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { UsersService } from '../users/users.service';
import { WsJwtGuard } from './ws-jwt.guard';

import { SubscriptionService } from '../payments/subscription.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws',
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  // Map to track session start time: socketId -> startTime (ms)
  private readonly sessionStartTimes = new Map<string, number>();

  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly usersService: UsersService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    // We don't start tracking here because we don't know the user ID yet
    // Tracking starts at handleJoinSession
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    await this.processSessionEnd(client);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('audio:chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { audioData: string; sessionId: string },
  ) {
    try {
      // Check if usage limit is reached (double check in real-time)
      const userId = client.data.userId;
      if (userId) {
         // Optionally check remaining minutes here if strict enforcement is needed
      }

      // Transcribe audio chunk
      const transcription = await this.sttService.transcribe({
        audioData: data.audioData,
        language: 'en',
      });

      // Emit transcription result
      client.emit('transcription:result', {
        sessionId: data.sessionId,
        text: transcription.text,
        confidence: transcription.confidence,
      });

      // Get user for language preference
      const user = await this.usersService.findById(client.data.userId);
      const userLanguage = user.preferences?.language || user.language || 'en';

      // Generate answer
      const answer = await this.answerService.generateAnswer(client.data.userId, {
        question: transcription.text,
        sessionId: data.sessionId,
        style: 'professional',
        length: 'medium',
        variations: 1,
        language: userLanguage, // Pass user's language preference
      });

      // Emit answer
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
  async handleJoinSession(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string }) {
    client.join(data.sessionId);
    
    // Start tracking duration
    this.sessionStartTimes.set(client.id, Date.now());
    this.logger.debug(`Session tracking started for ${client.id} (User: ${client.data.userId})`);

    client.emit('session:status', { joined: true, sessionId: data.sessionId });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('session:leave')
  async handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.leave(data.sessionId);
    await this.processSessionEnd(client);
    client.emit('session:status', { left: true, sessionId: data.sessionId });
  }

  /**
   * Calculate duration and deduct minutes
   */
  private async processSessionEnd(client: Socket) {
    const startTime = this.sessionStartTimes.get(client.id);
    if (startTime && client.data.userId) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const minutesUsed = Math.ceil(durationMs / (1000 * 60)); // Round up to nearest minute

      if (minutesUsed > 0) {
        this.logger.log(`Deducting ${minutesUsed} live minutes for user ${client.data.userId}`);
        try {
          await this.subscriptionService.addLiveMinutes(client.data.userId, minutesUsed);
        } catch (error) {
          this.logger.error(`Failed to deduct minutes for user ${client.data.userId}: ${error.message}`);
        }
      }
      
      this.sessionStartTimes.delete(client.id);
    }
  }
}
