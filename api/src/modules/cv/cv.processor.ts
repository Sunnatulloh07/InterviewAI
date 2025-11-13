import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { CvService } from './cv.service';
import { UsersService } from '../users/users.service';
import { QUEUE_CV_ANALYSIS } from '@common/constants';

@Processor(QUEUE_CV_ANALYSIS)
export class CvProcessor {
  private readonly logger = new Logger(CvProcessor.name);

  constructor(
    private readonly cvService: CvService,
    private readonly usersService: UsersService,
  ) {}

  @Process('analyze-cv')
  async handleCvAnalysis(job: Job) {
    this.logger.log(`Processing CV analysis job ${job.id}`);
    const { cvId, userId, jobDescription } = job.data;

    try {
      // Get user for language preference
      const user = await this.usersService.findById(userId);
      const userLanguage = user.preferences?.language || user.language || 'en';

      await this.cvService.analyzeCv(userId, cvId, {
        jobDescription,
        language: userLanguage, // Pass user's language preference
      });
      this.logger.log(`CV analysis completed: ${cvId}`);
    } catch (error) {
      this.logger.error(`CV analysis failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
