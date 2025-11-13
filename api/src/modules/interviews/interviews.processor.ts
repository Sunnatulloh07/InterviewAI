import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InterviewsFeedbackService } from './interviews-feedback.service';
import { QUEUE_INTERVIEW_FEEDBACK } from '@common/constants';

@Processor(QUEUE_INTERVIEW_FEEDBACK)
export class InterviewsProcessor {
  private readonly logger = new Logger(InterviewsProcessor.name);

  constructor(private readonly feedbackService: InterviewsFeedbackService) {}

  @Process('generate-answer-feedback')
  async handleAnswerFeedback(job: Job) {
    this.logger.log(`Processing answer feedback job ${job.id}`);
    const { answerId, questionId } = job.data;

    try {
      await this.feedbackService.generateAnswerFeedback(answerId, questionId);
      this.logger.log(`Answer feedback completed: ${answerId}`);
    } catch (error) {
      this.logger.error(`Answer feedback failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Process('generate-session-feedback')
  async handleSessionFeedback(job: Job) {
    this.logger.log(`Processing session feedback job ${job.id}`);
    const { sessionId } = job.data;

    try {
      await this.feedbackService.generateSessionFeedback(sessionId);
      this.logger.log(`Session feedback completed: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Session feedback failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
