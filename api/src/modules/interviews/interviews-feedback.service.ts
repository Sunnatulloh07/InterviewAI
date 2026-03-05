import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { InterviewsRepository } from './interviews.repository';
import { UsersService } from '../users/users.service';
import { OPENAI_MAX_TOKENS_FEEDBACK, OPENAI_TEMPERATURE, AI_MODELS } from '@common/constants';
import {
  createOpenAIClient,
  getModelName,
  getModelForPlan,
} from '@common/utils/openai-client.factory';
import {
  SCORING_WEIGHTS,
  getVerdictFromScore,
  MOCK_TYPE_CONFIG,
  type MockInterviewType,
} from './constants/mock-interview.constants';
import {
  buildAnswerAnalysisSystemPrompt,
  buildAnswerAnalysisUserPrompt,
  buildOverallSummarySystemPrompt,
  buildOverallSummaryUserPrompt,
  buildDetailedReportSystemPrompt,
  buildDetailedReportUserPrompt,
  AI_SERVICE_CONFIG,
  type AnswerAnalysisBatchParams,
  type OverallSummaryParams,
  type DetailedReportParams,
} from '@common/constants/ai-prompts.constant';

@Injectable()
export class InterviewsFeedbackService {
  private readonly logger = new Logger(InterviewsFeedbackService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly repository: InterviewsRepository,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Update question statistics (timesAsked, averageScore) for analytics
   */
  private async updateQuestionStatistics(questionId: string, score: number): Promise<void> {
    try {
      const question = await this.repository.findQuestionById(questionId);
      if (!question) {
        return;
      }

      const answers = await this.repository.findAnswersByQuestionId(questionId);
      const scores = answers
        .filter((a) => a.score !== undefined && a.score !== null)
        .map((a) => a.score!);

      const timesAsked = answers.length;
      const averageScore =
        scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : undefined;

      await this.repository.updateQuestion(questionId, {
        timesAsked,
        averageScore: averageScore ? Math.round(averageScore) : undefined,
      });

      this.logger.debug(
        `Updated question ${questionId} statistics: timesAsked=${timesAsked}, averageScore=${averageScore}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to update question statistics for ${questionId}: ${error.message}`);
    }
  }

  /**
   * Generate overall session feedback (Optimized Batch Processing)
   *
   * FIX #120: Added user position/profile context for position-aware evaluation.
   * FIX #121: Added system role with prompt injection protection.
   * FIX #122: Now saves authenticityWarning and pacingFeedback to DB.
   * FIX #123: Scoring changed from 0-10 to 0-100 scale.
   *
   * Pipeline:
   * 1. Analyzes answers in chunks (parallel) — detailed per-answer scores + feedback
   * 2. Generates overall session summary based on aggregated scores (lightweight)
   */
  async generateSessionFeedback(sessionId: string): Promise<void> {
    try {
      const session = await this.repository.findSessionById(sessionId);
      if (!session) return;

      const answers = await this.repository.findAnswersBySessionId(sessionId);
      if (answers.length === 0) {
        this.logger.warn(`No answers found for session ${sessionId}`);
        return;
      }

      // Context setup
      const user = await this.usersService.findById(session.userId.toString());
      const model = this.getModelByPlan(user.subscription?.plan);
      const language = user.preferences?.language || user.language || 'en';
      const BATCH_SIZE = 5;

      // FIX #120: Build user profile context for position-aware scoring
      const userProfile = this.buildUserProfileContext(user);

      // 1. CHUNK PROCESSING (Get Scores & Feedback)
      this.logger.log(
        `Starting batch analysis for session ${sessionId} with ${answers.length} answers`,
      );

      const chunks: any[][] = [];
      for (let i = 0; i < answers.length; i += BATCH_SIZE) {
        chunks.push(answers.slice(i, i + BATCH_SIZE));
      }

      const chunkResults = await Promise.all(
        chunks.map((chunk) =>
          this.analyzeAnswersBatch(chunk, session, model, language, userProfile),
        ),
      );

      // Flatten results
      const allAnalysis = chunkResults.flat();

      // Update answers in DB
      let totalScore = 0;
      let scoredCount = 0;

      const summaryForOverall: any[] = [];

      for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const analysis = allAnalysis[i];

        if (analysis && analysis.score !== undefined) {
          const score = Math.min(100, Math.max(0, analysis.score || 0));
          totalScore += score;
          scoredCount++;

          // FIX #122: Save authenticityWarning and pacingFeedback to DB
          const feedbackData = {
            score,
            strengths: analysis.strengths || [],
            improvements: analysis.improvements || [],
            suggestions: analysis.suggestions || [],
            keyPointsCovered: [],
            keyPointsMissed: [],
            exampleAnswer: analysis.feedback || '',
            authenticityWarning: analysis.authenticityWarning || false,
            pacingFeedback: analysis.pacingFeedback || '',
          };

          // Update DB
          await this.repository.updateAnswer(answer.id, {
            feedback: feedbackData,
            score,
            analyzed: true,
            aiModel: model,
          });

          await this.updateQuestionStatistics(answer.questionId.toString(), score);

          // Collect summary data
          summaryForOverall.push({
            question: answer.questionId?.['question'] || 'Question',
            score,
            strengths: analysis.strengths?.slice(0, 2) || [],
            weaknesses: analysis.improvements?.slice(0, 2) || [],
            authenticityWarning: analysis.authenticityWarning || false,
          });
        }
      }

      // 2. OVERALL SUMMARY GENERATION (Lightweight)
      const overallAnalysis = await this.generateOverallSummary(
        session,
        summaryForOverall,
        model,
        language,
        userProfile,
      );
      const overallScore = scoredCount > 0 ? totalScore / scoredCount : 0;
      const roundedScore = Math.round(overallScore);

      // 3. ENHANCED REPORT GENERATION (Phase 3)
      const isEnhanced = this.configService.get<boolean>('features.mockEnhancedEnabled');
      let report: any = undefined;

      if (isEnhanced) {
        try {
          report = await this.generateDetailedReport(
            session,
            summaryForOverall,
            roundedScore,
            model,
            language,
            userProfile,
          );
        } catch (reportError: any) {
          this.logger.warn(
            `Detailed report generation failed for ${sessionId}: ${reportError.message}`,
          );
          // Non-fatal: interview still has basic feedback
        }
      }

      // Build update payload
      const updatePayload: any = {
        feedback: overallAnalysis,
        overallScore: roundedScore,
        mockState: 'completed',
      };

      if (report) {
        updatePayload.report = report;
      }

      await this.repository.updateSession(sessionId, updatePayload);

      this.logger.log(`Session feedback generated for ${sessionId} (score: ${roundedScore}/100)${report ? ' [enhanced report]' : ''}`);
    } catch (error) {
      this.logger.error(`Failed to generate session feedback: ${error.message}`, error.stack);
    }
  }

  /**
   * Step 1: Analyze a small batch of answers (Detailed)
   *
   * FIX #120: Now includes user position/profile context for level-appropriate scoring.
   * FIX #121: Now uses system role with prompt injection protection.
   * FIX #123: Scoring scale changed from 0-10 to 0-100.
   */
  private async analyzeAnswersBatch(
    answers: any[],
    session: any,
    model: string,
    language: string,
    userProfile: string,
  ): Promise<any[]> {
    // Build enterprise-grade prompts from centralized constants
    const batchParams: AnswerAnalysisBatchParams = {
      answers: answers.map((a) => ({
        question: a.questionId?.question || 'Question',
        answer: a.content,
        duration: a.duration || 0,
      })),
      sessionType: session.type,
      sessionDifficulty: session.difficulty,
      userProfile,
      language,
    };

    const systemPrompt = buildAnswerAnalysisSystemPrompt();
    const userPrompt = buildAnswerAnalysisUserPrompt(batchParams);

    try {
      if (!this.openai) throw new BadRequestException('AI not configured');

      // FIX #121: System/user separation for prompt injection protection
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: AI_SERVICE_CONFIG.answerAnalysis.temperature,
        response_format: AI_SERVICE_CONFIG.answerAnalysis.responseFormat,
      });

      const content = JSON.parse(completion.choices[0].message.content || '{}');
      return content.results || Array(answers.length).fill({});
    } catch (e) {
      this.logger.error(`Batch analysis failed: ${e.message}`);
      return Array(answers.length).fill({});
    }
  }

  /**
   * Step 2: Generate overall summary from scores
   *
   * FIX #121: Added system role.
   * FIX #120: Added user profile context.
   * FIX #123: Updated score display to /100.
   */
  private async generateOverallSummary(
    session: any,
    summaries: any[],
    model: string,
    language: string,
    userProfile: string,
  ): Promise<any> {
    // Build enterprise-grade prompts from centralized constants
    const summaryParams: OverallSummaryParams = {
      summaries: summaries.map((s) => ({
        score: s.score,
        strengths: s.strengths || [],
        weaknesses: s.weaknesses || [],
        authenticityWarning: s.authenticityWarning || false,
      })),
      sessionType: session.type,
      sessionDifficulty: session.difficulty,
      userProfile,
      language,
    };

    const systemPrompt = buildOverallSummarySystemPrompt();
    const userPrompt = buildOverallSummaryUserPrompt(summaryParams);

    try {
      // FIX MOCK-15: Null check for this.openai — it can be null if OPENAI_API_KEY is not configured
      if (!this.openai) {
        this.logger.warn('OpenAI client not initialized, skipping overall summary generation');
        return {};
      }

      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: AI_SERVICE_CONFIG.overallSummary.temperature,
        response_format: AI_SERVICE_CONFIG.overallSummary.responseFormat,
      });
      return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e) {
      this.logger.error(`Overall summary generation failed: ${e.message}`);
      return {};
    }
  }

  /**
   * Phase 3: Generate detailed interview report with verdict, category scores,
   * action plan, comparison, and position readiness.
   *
   * Report structure (TZ section 6.5.1):
   *   1. Executive Summary (score, grade, verdict: HIRE/MAYBE/NO_HIRE)
   *   2. Category Breakdown (technical, communication, problem solving, behavioral, system design)
   *   3. Key Strengths (Top 3)
   *   4. Improvement Areas (Top 3)
   *   5. Action Plan (this week, 2 weeks, month)
   *   6. Comparison text & Position readiness %
   */
  private async generateDetailedReport(
    session: any,
    summaries: any[],
    overallScore: number,
    model: string,
    language: string,
    userProfile: string,
  ): Promise<any> {
    const verdict = getVerdictFromScore(overallScore);
    const mockType: MockInterviewType = session.mockType || 'quick_technical';
    const typeConfig = MOCK_TYPE_CONFIG[mockType];

    // Build enterprise-grade prompts from centralized constants
    const reportParams: DetailedReportParams = {
      sessionType: session.type,
      sessionDifficulty: session.difficulty,
      mockType,
      mockTypeLabel: typeConfig?.label || session.type,
      overallScore,
      verdict,
      company: session.company,
      domain: session.domain,
      userProfile,
      language,
      summaries: summaries.map((s) => ({
        score: s.score,
        strengths: s.strengths || [],
        weaknesses: s.weaknesses || [],
      })),
    };

    const systemPrompt = buildDetailedReportSystemPrompt();
    const userPrompt = buildDetailedReportUserPrompt(reportParams);

    try {
      if (!this.openai) throw new BadRequestException('AI not configured');

      const completion = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: AI_SERVICE_CONFIG.detailedReport.temperature,
        response_format: AI_SERVICE_CONFIG.detailedReport.responseFormat,
      });

      const reportData = JSON.parse(completion.choices[0].message.content || '{}');

      // Build final report object matching the schema
      return {
        totalScore: overallScore,
        verdict,
        categoryScores: reportData.categoryScores || {},
        strengths: (reportData.strengths || []).slice(0, 3),
        weaknesses: (reportData.weaknesses || []).slice(0, 3),
        recommendations: (reportData.recommendations || []).slice(0, 3),
        comparison: reportData.comparison || '',
        actionPlan: (reportData.actionPlan || []).slice(0, 3),
        positionReadiness: Math.min(100, Math.max(0, reportData.positionReadiness || 0)),
      };
    } catch (error: any) {
      this.logger.error(`Detailed report generation failed: ${error.message}`);
      // Return a minimal report with what we know
      return {
        totalScore: overallScore,
        verdict,
        categoryScores: {},
        strengths: [],
        weaknesses: [],
        recommendations: [],
        comparison: '',
        actionPlan: [],
        positionReadiness: 0,
      };
    }
  }

  /**
   * Build user profile context string for position-aware evaluation.
   * FIX #120: Ensures AI evaluates junior differently from senior.
   */
  private buildUserProfileContext(user: any): string {
    if (!user) return '';
    const parts: string[] = [];
    const profile = user.profile;
    if (profile?.position) parts.push(`Level: ${profile.position}`);
    if (profile?.domain) parts.push(`Domain: ${profile.domain}`);
    if (profile?.techStack?.length) parts.push(`Tech: ${profile.techStack.slice(0, 5).join(', ')}`);
    if (profile?.yearsOfExperience) parts.push(`Experience: ${profile.yearsOfExperience} years`);
    return parts.join(' | ');
  }

  /**
   * Get AI model based on subscription plan
   * Supports OpenRouter with automatic model mapping
   */
  private getModelByPlan(plan?: string): string {
    return getModelForPlan(this.configService, plan || 'free', AI_MODELS.GPT35, AI_MODELS.GPT4);
  }

  // getLanguageName() removed — use getLanguageNameSafe() from ai-prompts.constant.ts
}
