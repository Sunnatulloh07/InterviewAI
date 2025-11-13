import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUser } from '@common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '@common/pipes/parse-objectid.pipe';
import { StartInterviewDto } from './dto/start-interview.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { InterviewSessionResponseDto } from './dto/interview-response.dto';
import { InterviewsService } from './interviews.service';

@ApiTags('Mock Interviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start mock interview',
    description: 'Start a new mock interview session with AI-generated questions',
  })
  @ApiResponse({
    status: 201,
    description: 'Interview started successfully',
    type: InterviewSessionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 403, description: 'Usage limit exceeded' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async startInterview(@CurrentUser() user: RequestUser, @Body() dto: StartInterviewDto) {
    return await this.interviewsService.startInterview(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get interview session',
    description: 'Retrieve interview session details including questions and answers',
  })
  @ApiResponse({
    status: 200,
    description: 'Session retrieved successfully',
    type: InterviewSessionResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getSession(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    return await this.interviewsService.getSession(user.id, id);
  }

  @Post(':id/answer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit answer',
    description: 'Submit answer for a question in the interview session',
  })
  @ApiResponse({
    status: 201,
    description: 'Answer submitted successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async submitAnswer(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return await this.interviewsService.submitAnswer(user.id, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete interview',
    description: 'Mark interview session as completed and trigger feedback generation',
  })
  @ApiResponse({
    status: 200,
    description: 'Interview completed successfully',
    type: InterviewSessionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Session already completed' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async completeSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return await this.interviewsService.completeSession(user.id, id);
  }

  @Get(':id/feedback')
  @ApiOperation({
    summary: 'Get feedback',
    description: 'Retrieve detailed AI-generated feedback for completed interview',
  })
  @ApiResponse({
    status: 200,
    description: 'Feedback retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        overallScore: { type: 'number' },
        ratings: {
          type: 'object',
          properties: {
            technicalAccuracy: { type: 'number' },
            communication: { type: 'number' },
            structuredThinking: { type: 'number' },
            confidence: { type: 'number' },
            problemSolving: { type: 'number' },
          },
        },
        summary: {
          type: 'object',
          properties: {
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            topConcerns: { type: 'array', items: { type: 'string' } },
          },
        },
        recommendations: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Session or feedback not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getFeedback(@CurrentUser() user: RequestUser, @Param('id', ParseObjectIdPipe) id: string) {
    const session = await this.interviewsService.getSession(user.id, id);
    return session.feedback || { message: 'Feedback generation in progress' };
  }

  @Get()
  @ApiOperation({
    summary: 'Get interview history',
    description: "Retrieve user's mock interview history",
  })
  @ApiResponse({
    status: 200,
    description: 'History retrieved successfully',
    type: [InterviewSessionResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getHistory(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: number,
    @Query('skip') skip?: number,
  ) {
    return await this.interviewsService.getHistory(user.id, limit, skip);
  }

  @Get('analytics/stats')
  @ApiOperation({
    summary: 'Get analytics',
    description: 'Retrieve interview performance analytics and statistics',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalInterviews: { type: 'number' },
        completedInterviews: { type: 'number' },
        averageScore: { type: 'number' },
        practicedTopics: { type: 'object' },
        progressOverTime: { type: 'array' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAnalytics(@CurrentUser() user: RequestUser) {
    return await this.interviewsService.getAnalytics(user.id);
  }
}
