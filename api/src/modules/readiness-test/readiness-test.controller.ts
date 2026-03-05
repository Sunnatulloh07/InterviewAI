import { Controller, Get, Param, NotFoundException, Logger } from '@nestjs/common';
import { ReadinessTestService } from './readiness-test.service';
import { getScoreGrade } from './constants/irs.constants';

/**
 * IRS REST API Controller
 *
 * Public endpoints:
 * - GET /api/irs/share/:token — Share link: natijani ko'rish (no auth)
 * - GET /api/irs/stats/weekly — Haftalik statistika (no auth)
 */
@Controller('api/irs')
export class ReadinessTestController {
  private readonly logger = new Logger(ReadinessTestController.name);

  constructor(private readonly readinessTestService: ReadinessTestService) {}

  /**
   * Share link endpoint — public, no auth required
   * Telegram deep link => bot => redirect to this page (optional web view)
   */
  @Get('share/:token')
  async getSharedResult(@Param('token') token: string) {
    const test = await this.readinessTestService.getTestByShareToken(token);

    if (!test) {
      throw new NotFoundException('Test result not found');
    }

    const grade = getScoreGrade(test.totalScore || 0);

    return {
      position: test.position,
      techStack: test.techStack,
      totalScore: test.totalScore,
      categoryScores: test.categoryScores,
      percentile: test.percentile,
      grade,
      completedAt: test.completedAt,
      questionsCount: test.questions?.length || 0,
    };
  }

  /**
   * Weekly stats — public, cacheable
   * Used by share pages, landing page widgets, etc.
   */
  @Get('stats/weekly')
  async getWeeklyStats() {
    return this.readinessTestService.getWeeklyStats();
  }
}
