import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AiSttService } from './ai-stt.service';
import { AiAnswerService } from './ai-answer.service';
import { AiContextService } from './ai-context.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '@common/pipes/parse-objectid.pipe';
import { TranscribeDto, TranscriptionResponseDto } from './dto/transcribe.dto';
import { GenerateAnswerDto, AnswerResponseDto } from './dto/generate-answer.dto';

@ApiTags('AI Services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly sttService: AiSttService,
    private readonly answerService: AiAnswerService,
    private readonly contextService: AiContextService,
  ) {}

  @Post('transcribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transcribe audio to text',
    description:
      'Convert audio recording to text using Whisper AI. Supports multiple languages with auto-detection.',
  })
  @ApiResponse({
    status: 200,
    description: 'Audio transcribed successfully',
    type: TranscriptionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid audio data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async transcribe(
    @CurrentUser() user: RequestUser,
    @Body() dto: TranscribeDto,
  ): Promise<TranscriptionResponseDto> {
    return await this.sttService.transcribe(dto);
  }

  @Post('generate-answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate interview answer',
    description:
      'AI-powered interview answer generation with context awareness. Supports multiple styles and lengths.',
  })
  @ApiResponse({
    status: 200,
    description: 'Answer generated successfully',
    type: AnswerResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateAnswer(
    @CurrentUser() user: RequestUser,
    @Body() dto: GenerateAnswerDto,
  ): Promise<AnswerResponseDto> {
    return await this.answerService.generateAnswer(user.id, dto);
  }

  @Get('sessions/:id/context')
  @ApiOperation({
    summary: 'Get session context',
    description: 'Retrieve context and conversation history for an AI session.',
  })
  @ApiResponse({
    status: 200,
    description: 'Context retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              type: { type: 'string', enum: ['question', 'answer'] },
              topics: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        topics: { type: 'array', items: { type: 'string' } },
        mentionedExperiences: { type: 'array', items: { type: 'string' } },
        skills: { type: 'array', items: { type: 'string' } },
        context: { type: 'object' },
        lastUpdated: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getContext(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    return await this.contextService.getContext(id);
  }

  @Post('sessions/:id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive AI session',
    description: 'Archive an AI session to clean up active sessions.',
  })
  @ApiResponse({ status: 204, description: 'Session archived successfully' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async archiveSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.contextService.archiveSession(id);
  }
}
