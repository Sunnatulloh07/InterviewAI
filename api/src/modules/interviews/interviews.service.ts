import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { InterviewsRepository } from './interviews.repository';
import { AiContextService } from '../ai/ai-context.service';
import { AiSttService } from '../ai/ai-stt.service';
import { UsersService } from '../users/users.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { StartInterviewDto } from './dto/start-interview.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { InterviewSessionDocument } from './schemas/interview-session.schema';
import { InterviewQuestionDocument } from './schemas/interview-question.schema';
import { InterviewAnswerDocument } from './schemas/interview-answer.schema';
import { USAGE_LIMITS, QUEUE_INTERVIEW_FEEDBACK, AI_MODELS } from '@common/constants';

@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly repository: InterviewsRepository,
    private readonly contextService: AiContextService,
    private readonly sttService: AiSttService,
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_INTERVIEW_FEEDBACK)
    private readonly feedbackQueue: Queue,
  ) {
    // Initialize OpenAI client for question generation
    // Supports both OpenAI and OpenRouter APIs
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const organization = this.configService.get<string>('OPENAI_ORGANIZATION');
    const baseUrl = this.configService.get<string>('OPENAI_BASE_URL');
    const siteUrl = this.configService.get<string>('OPENAI_SITE_URL');
    const siteTitle = this.configService.get<string>('OPENAI_SITE_TITLE');

    // Only initialize OpenAI if API key is provided and valid
    if (apiKey && apiKey.trim() && !apiKey.includes('your-') && !apiKey.includes('sk-***')) {
      const config: {
        apiKey: string;
        organization?: string;
        baseURL?: string;
        defaultHeaders?: Record<string, string>;
      } = {
        apiKey: apiKey.trim(),
      };

      // Add base URL if provided (for OpenRouter or other providers)
      if (baseUrl && baseUrl.trim() && !baseUrl.includes('your-')) {
        config.baseURL = baseUrl.trim();
        this.logger.log(`Using custom OpenAI base URL: ${baseUrl.trim()}`);

        // Add OpenRouter-specific headers if using OpenRouter
        if (baseUrl.includes('openrouter.ai')) {
          config.defaultHeaders = {};
          if (siteUrl && siteUrl.trim()) {
            config.defaultHeaders['HTTP-Referer'] = siteUrl.trim();
          }
          if (siteTitle && siteTitle.trim()) {
            config.defaultHeaders['X-Title'] = siteTitle.trim();
          }
          this.logger.log('OpenRouter integration enabled with custom headers');
        }
      }

      // Organization header is OPTIONAL - only needed if you have multiple organizations
      // Most users don't need this parameter at all
      // If you're using a personal API key or single organization, DON'T include organization header
      // Including wrong organization will cause 401 errors
      //
      // Only add organization if:
      // 1. It's provided and not empty
      // 2. It's not a placeholder
      // 3. It looks like a valid organization ID (starts with 'org-' and has proper length)
      if (
        organization &&
        organization.trim() &&
        !organization.includes('your-') &&
        !organization.includes('org-***') &&
        organization.trim().startsWith('org-') &&
        organization.trim().length > 4
      ) {
        config.organization = organization.trim();
      }
      // If organization is not provided or invalid, just use API key alone (this is normal)
      this.openai = new OpenAI(config);
      this.logger.log('OpenAI client initialized successfully');
    } else {
      this.openai = null;
      this.logger.warn(
        'OpenAI API key not configured. Question generation will use fallback questions.',
      );
    }
  }

  /**
   * Start mock interview
   */
  async startInterview(userId: string, dto: StartInterviewDto): Promise<InterviewSessionDocument> {
    try {
      // Check usage limits
      await this.checkUsageLimits(userId);

      // Generate questions
      const questions = await this.generateQuestions(dto);

      if (questions.length === 0) {
        throw new BadRequestException('No questions available for the selected criteria');
      }

      // Create AI session for context
      const aiSession = await this.contextService.createSession(userId, 'interview');

      // Create interview session
      const session = await this.repository.createSession({
        userId: userId as any,
        type: dto.type,
        difficulty: dto.difficulty,
        domain: dto.domain,
        technology: dto.technology || [],
        numQuestions: dto.numQuestions,
        mode: dto.mode,
        timeLimit: dto.timeLimit,
        status: 'active',
        currentQuestionIndex: 0,
        questions: questions.map((q) => q._id) as any,
        answers: [],
        startedAt: new Date(),
        aiSessionId: aiSession.id,
      });

      // Increment usage counter
      await this.usersService.incrementUsage(userId, 'mockInterview');

      this.logger.log(`Interview started: ${session.id} for user ${userId}`);
      return session;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(
        `Failed to start interview for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to start interview. Please try again.');
    }
  }

  /**
   * Get interview session
   */
  async getSession(userId: string, sessionId: string): Promise<InterviewSessionDocument> {
    try {
      const session = await this.repository.findSessionById(sessionId);

      if (!session) {
        throw new NotFoundException('Interview session not found');
      }

      if (session.userId.toString() !== userId) {
        throw new ForbiddenException('Access denied');
      }

      return session;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(
        `Failed to get session ${sessionId} for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to retrieve interview session. Please try again.');
    }
  }

  /**
   * Submit answer
   */
  async submitAnswer(
    userId: string,
    sessionId: string,
    dto: SubmitAnswerDto,
  ): Promise<InterviewAnswerDocument> {
    try {
      const session = await this.getSession(userId, sessionId);

      if (session.status !== 'active' && session.status !== 'paused') {
        throw new BadRequestException('Interview session is not active');
      }

      // Verify question belongs to session
      const questionExists = session.questions.some((q: any) => q.toString() === dto.questionId);
      if (!questionExists) {
        throw new BadRequestException('Question not found in this session');
      }

      let content = dto.answerText || '';
      let audioUrl = dto.audioUrl;

      // If audio answer, transcribe it
      if (dto.answerType === 'audio') {
        if (!dto.transcript && dto.audioUrl) {
          // Note: In production, you'd fetch audio from URL and transcribe
          // For now, use provided transcript
          content = dto.transcript || '';
        } else {
          content = dto.transcript || '';
        }
        audioUrl = dto.audioUrl;
      }

      // Create answer
      const answer = await this.repository.createAnswer({
        sessionId: sessionId as any,
        questionId: dto.questionId as any,
        answerType: dto.answerType,
        content,
        audioUrl,
        duration: dto.duration,
        submittedAt: new Date(),
        analyzed: false,
      });

      // Add answer to session
      await this.repository.addAnswerToSession(sessionId, answer.id);

      // Update current question index
      await this.repository.updateSession(sessionId, {
        currentQuestionIndex: session.currentQuestionIndex + 1,
      });

      // Queue feedback generation
      await this.feedbackQueue.add(
        'generate-answer-feedback',
        {
          answerId: answer.id,
          questionId: dto.questionId,
          sessionId,
          userId,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      );

      this.logger.log(`Answer submitted for session ${sessionId}`);
      return answer;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to submit answer for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to submit answer. Please try again.');
    }
  }

  /**
   * Complete interview session
   */
  async completeSession(userId: string, sessionId: string): Promise<InterviewSessionDocument> {
    try {
      const session = await this.getSession(userId, sessionId);

      if (session.status === 'completed') {
        throw new BadRequestException('Interview already completed');
      }

      // Update session status
      await this.repository.updateSession(sessionId, {
        status: 'completed',
        completedAt: new Date(),
      });

      // Queue overall feedback generation
      await this.feedbackQueue.add(
        'generate-session-feedback',
        {
          sessionId,
          userId,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      );

      // Archive AI session
      if (session.aiSessionId) {
        await this.contextService.archiveSession(session.aiSessionId);
      }

      this.logger.log(`Interview completed: ${sessionId}`);
      return await this.getSession(userId, sessionId);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(`Failed to complete session ${sessionId}: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to complete interview. Please try again.');
    }
  }

  /**
   * Update current question index in session
   */
  async updateSessionIndex(userId: string, sessionId: string, newIndex: number): Promise<void> {
    try {
      const session = await this.getSession(userId, sessionId);

      // Validate index
      if (newIndex < 0 || newIndex > session.questions.length) {
        throw new BadRequestException('Invalid question index');
      }

      await this.repository.updateSession(sessionId, {
        currentQuestionIndex: newIndex,
      });

      this.logger.debug(`Updated session ${sessionId} question index to ${newIndex}`);
    } catch (error) {
      this.logger.error(`Failed to update session index: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get interview history
   */
  async getHistory(userId: string, limit = 10, skip = 0): Promise<InterviewSessionDocument[]> {
    try {
      return await this.repository.findSessionsByUserId(userId, limit, skip);
    } catch (error) {
      this.logger.error(
        `Failed to get interview history for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to retrieve interview history. Please try again.');
    }
  }

  /**
   * Get analytics
   */
  async getAnalytics(userId: string): Promise<any> {
    try {
      const totalInterviews = await this.repository.countSessionsByUserId(userId);
      const completedInterviews = await this.repository.countSessionsByUserId(userId, 'completed');
      const averageScore = await this.repository.getAverageScore(userId);

      // Get recent sessions for topic analysis
      const recentSessions = await this.repository.findSessionsByUserId(userId, 20, 0);
      const practicedTopics = this.extractPracticedTopics(recentSessions);

      return {
        totalInterviews,
        completedInterviews,
        averageScore: Math.round(averageScore * 10) / 10,
        practicedTopics,
        progressOverTime: await this.calculateProgress(userId),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get analytics for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to retrieve analytics. Please try again.');
    }
  }

  /**
   * Generate interview questions
   * ALWAYS generates questions using AI - no hardcode or DB lookup
   */
  private async generateQuestions(dto: StartInterviewDto): Promise<InterviewQuestionDocument[]> {
    // Always generate questions using AI
    const questions = await this.generateSeedQuestions(dto, dto.numQuestions);
    return questions;
  }

  /**
   * Generate questions using AI only
   * No hardcode or DB lookup - always generates fresh questions
   */
  private async generateSeedQuestions(
    dto: StartInterviewDto,
    count: number,
  ): Promise<InterviewQuestionDocument[]> {
    const questions: InterviewQuestionDocument[] = [];

    // Generate questions using AI
    if (!this.openai) {
      throw new BadRequestException(
        'AI question generation is not available. Please configure OPENAI_API_KEY.',
      );
    }

    try {
      const aiQuestions = await this.generateQuestionsWithAI(dto, count);
      for (let i = 0; i < aiQuestions.length; i++) {
        const question = await this.repository.createQuestion({
          order: i + 1,
          category: dto.type,
          difficulty: dto.difficulty,
          question: aiQuestions[i],
          expectedKeyPoints: [],
          hints: [],
          tags: dto.technology || [],
          domain: dto.domain,
          technology: dto.technology,
          createdBy: 'system',
        });
        questions.push(question);
      }
      this.logger.log(`Generated ${aiQuestions.length} AI questions for ${dto.type} interview`);
      return questions;
    } catch (error: any) {
      this.logger.error(`Failed to generate AI questions: ${error.message}`, error.stack);

      // If it's already a BadRequestException with a specific message, re-throw it
      // This preserves the original error message (e.g., quota limit, authentication, etc.)
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, throw a generic message
      throw new BadRequestException(
        `Failed to generate interview questions. Please try again later.`,
      );
    }
  }

  /**
   * Generate interview questions using AI
   */
  private async generateQuestionsWithAI(dto: StartInterviewDto, count: number): Promise<string[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const language = dto.language || 'en';
    const languageName = this.getLanguageName(language);
    const difficultyName = this.getDifficultyName(dto.difficulty);
    const categoryName = this.getCategoryName(dto.type);

    // Build prompt for question generation
    let prompt = `You are an expert interview question generator. Generate ${count} unique, professional interview questions for a ${difficultyName}-level ${categoryName} interview.\n\n`;

    if (dto.domain) {
      prompt += `Domain: ${dto.domain}\n`;
    }

    if (dto.technology && dto.technology.length > 0) {
      prompt += `Technologies: ${dto.technology.join(', ')}\n`;
    }

    prompt += `\nRequirements:\n`;
    prompt += `- Generate ${count} unique questions\n`;
    prompt += `- Questions should be appropriate for ${difficultyName} level\n`;
    prompt += `- Questions should be ${categoryName} type\n`;
    prompt += `- All questions must be in ${languageName} language\n`;
    prompt += `- Questions should be specific and relevant to the domain/technologies mentioned\n`;
    prompt += `- Avoid generic questions, make them specific and practical\n\n`;

    prompt += `Return your response as a JSON object with a "questions" array containing ${count} question strings:\n`;
    prompt += `{\n`;
    prompt += `  "questions": ["question 1", "question 2", ...]\n`;
    prompt += `}\n`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: AI_MODELS.GPT5_NANO, // Using GPT-5 Nano via OpenRouter (cheaper & faster)
        messages: [
          {
            role: 'system',
            content: `You are a professional interview question generator. Generate unique, relevant interview questions based on the requirements. Always respond in valid JSON format with a "questions" array.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 2000,
        temperature: 0.8, // Higher temperature for more variety
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(responseText) as any;

      // Try to extract questions from various possible JSON structures
      let questions: string[] = [];
      if (Array.isArray(parsed)) {
        questions = parsed;
      } else if (parsed.questions && Array.isArray(parsed.questions)) {
        questions = parsed.questions;
      } else if (parsed.questionsList && Array.isArray(parsed.questionsList)) {
        questions = parsed.questionsList;
      } else {
        // Try to find any array in the response
        const keys = Object.keys(parsed);
        for (const key of keys) {
          if (Array.isArray(parsed[key])) {
            questions = parsed[key];
            break;
          }
        }
      }

      // Validate and clean questions
      questions = questions
        .filter((q) => q && typeof q === 'string' && q.trim().length > 10)
        .slice(0, count)
        .map((q) => q.trim());

      if (questions.length === 0) {
        throw new Error('No valid questions generated from AI response');
      }

      return questions;
    } catch (error: any) {
      this.logger.error(`AI question generation failed: ${error.message}`, error.stack);

      // Handle specific OpenAI API errors
      if (
        error.status === 429 ||
        error.message?.includes('quota') ||
        error.message?.includes('exceeded')
      ) {
        throw new BadRequestException(
          'OpenAI API quota limit reached. Please check your OpenAI account billing or try again later.',
        );
      }

      if (error.status === 401 || error.message?.includes('401')) {
        throw new BadRequestException(
          'OpenAI API authentication failed. Please check your API key configuration.',
        );
      }

      if (error.status === 503 || error.message?.includes('overloaded')) {
        throw new BadRequestException(
          'OpenAI API is currently overloaded. Please try again in a few moments.',
        );
      }

      // Generic error
      throw new BadRequestException(
        `Failed to generate interview questions: ${error.message || 'Unknown error'}. Please try again later.`,
      );
    }
  }

  /**
   * Get language name from code
   */
  private getLanguageName(language: string): string {
    const names: Record<string, string> = {
      uz: 'Uzbek',
      ru: 'Russian',
      en: 'English',
    };
    return names[language] || 'English';
  }

  /**
   * Get difficulty name
   */
  private getDifficultyName(difficulty: string): string {
    const names: Record<string, string> = {
      junior: 'junior/entry-level',
      mid: 'mid-level',
      senior: 'senior',
    };
    return names[difficulty] || difficulty;
  }

  /**
   * Get category name
   */
  private getCategoryName(category: string): string {
    const names: Record<string, string> = {
      technical: 'technical',
      behavioral: 'behavioral',
      case_study: 'case study',
      mixed: 'mixed',
    };
    return names[category] || category;
  }

  /**
   * Check usage limits
   */
  private async checkUsageLimits(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free';
    const limit = USAGE_LIMITS[plan]?.mockInterviews || USAGE_LIMITS.free.mockInterviews;

    if (limit === -1) {
      return; // Unlimited
    }

    if (user.usage.mockInterviewsThisMonth >= limit) {
      throw new ForbiddenException(
        `Mock interview limit reached for ${plan} plan. Upgrade to practice more.`,
      );
    }
  }

  /**
   * Extract practiced topics from sessions
   */
  private extractPracticedTopics(sessions: InterviewSessionDocument[]): Record<string, number> {
    const topics: Record<string, number> = {};

    sessions.forEach((session) => {
      if (session.domain) {
        topics[session.domain] = (topics[session.domain] || 0) + 1;
      }
      session.technology?.forEach((tech) => {
        topics[tech] = (topics[tech] || 0) + 1;
      });
    });

    return topics;
  }

  /**
   * Calculate progress over time
   */
  private async calculateProgress(userId: string): Promise<any[]> {
    const sessions = await this.repository.findSessionsByUserId(userId, 50, 0);

    const completed = sessions
      .filter((s) => s.status === 'completed' && s.overallScore)
      .map((s) => ({
        date: s.completedAt,
        score: s.overallScore,
        type: s.type,
      }))
      .reverse();

    return completed;
  }
}
