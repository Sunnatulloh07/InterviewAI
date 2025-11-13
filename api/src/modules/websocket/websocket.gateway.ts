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

  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly usersService: UsersService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('audio:chunk')
  async handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { audioData: string; sessionId: string },
  ) {
    try {
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
  handleJoinSession(@ConnectedSocket() client: Socket, @MessageBody() data: { sessionId: string }) {
    client.join(data.sessionId);
    client.emit('session:status', { joined: true, sessionId: data.sessionId });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('session:leave')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    client.leave(data.sessionId);
    client.emit('session:status', { left: true, sessionId: data.sessionId });
  }
}
