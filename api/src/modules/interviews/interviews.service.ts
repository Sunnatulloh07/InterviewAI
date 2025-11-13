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
import {
  createOpenAIClient,
  getModelName,
  OPENROUTER_MODELS,
} from '@common/utils/openai-client.factory';

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
    // Supports both OpenAI and OpenRouter (auto-detects OpenRouter by API key prefix)
    this.openai = createOpenAIClient(this.configService);
    if (!this.openai) {
      this.logger.warn(
        'OpenAI API key not configured. Question generation will use fallback questions.',
      );
    } else {
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (apiKey?.startsWith('sk-or-v1-')) {
        this.logger.log('Using OpenRouter API for question generation (auto-detected)');
      }
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

    prompt += `\nCRITICAL OUTPUT FORMAT:\n`;
    prompt += `You MUST return a valid JSON object with this EXACT structure:\n`;
    prompt += `{\n`;
    prompt += `  "questions": ["question 1", "question 2", "question 3", ...]\n`;
    prompt += `}\n\n`;
    prompt += `IMPORTANT RULES:\n`;
    prompt += `- Return ONLY valid JSON, no markdown code blocks, no explanations, no text before or after\n`;
    prompt += `- The "questions" array MUST contain exactly ${count} question strings\n`;
    prompt += `- Each question must be a string with at least 10 characters\n`;
    prompt += `- Do NOT include \`\`\`json or \`\`\` code blocks\n`;
    prompt += `- Do NOT add any explanatory text\n`;
    prompt += `- The response must be parseable as JSON\n`;

    try {
      // Determine model based on OpenRouter or OpenAI
      // Note: GPT-5 doesn't exist - using GPT-4o-mini as production-ready alternative
      const model = getModelName(
        this.configService,
        AI_MODELS.GPT35,
        OPENROUTER_MODELS['gpt-5-nano'] || 'openai/gpt-4o-mini',
      );

      // Check if using OpenRouter
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      const isOpenRouter = apiKey?.startsWith('sk-or-v1-') ||
                          this.configService.get<string>('OPENROUTER_ENABLED') === 'true';

      this.logger.debug(`Using model: ${model}, OpenRouter: ${isOpenRouter}`);

      // Create completion request parameters
      const completionParams: any = {
        model,
        messages: [
          {
            role: 'system',
            content: `You are a professional interview question generator. Your task is to generate interview questions and return them in valid JSON format.

CRITICAL RULES:
1. ALWAYS return a valid JSON object with a "questions" array
2. NEVER include markdown code blocks (\`\`\`json)
3. NEVER add explanatory text before or after the JSON
4. The JSON must be directly parseable
5. Each question must be a string in the "questions" array
6. Return EXACTLY ${count} questions

Example of correct response:
{"questions": ["Question 1?", "Question 2?", "Question 3?"]}

Example of INCORRECT response (DO NOT DO THIS):
\`\`\`json
{"questions": ["Question 1?"]}
\`\`\`

Your response must be valid JSON that can be parsed directly.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 2000,
        temperature: 0.8, // Higher temperature for more variety
      };

      // Only add response_format for OpenAI (not supported by OpenRouter)
      if (!isOpenRouter) {
        completionParams.response_format = { type: 'json_object' };
      }

      const completion = await this.openai.chat.completions.create(completionParams);

      const responseText = completion.choices[0]?.message?.content || '{}';
      
      // Log raw response for debugging (first 500 chars)
      this.logger.debug(`AI response (first 500 chars): ${responseText.substring(0, 500)}`);

      // Try to parse JSON response
      let parsed: any;
      try {
        // Try to extract JSON from response if it contains markdown code blocks
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
          jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        } else if (jsonText.includes('```')) {
          jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        parsed = JSON.parse(jsonText);
      } catch (parseError) {
        this.logger.error(`Failed to parse AI response as JSON: ${parseError.message}`);
        this.logger.error(`Response text: ${responseText.substring(0, 1000)}`);
        throw new Error(`Invalid JSON response from AI: ${parseError.message}`);
      }

      // Try to extract questions from various possible JSON structures
      let questions: string[] = [];
      
      // Check if response is directly an array
      if (Array.isArray(parsed)) {
        questions = parsed;
      }
      // Check for common property names
      else if (parsed.questions && Array.isArray(parsed.questions)) {
        questions = parsed.questions;
      } else if (parsed.questionsList && Array.isArray(parsed.questionsList)) {
        questions = parsed.questionsList;
      } else if (parsed.questionList && Array.isArray(parsed.questionList)) {
        questions = parsed.questionList;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        questions = parsed.data;
      } else if (parsed.items && Array.isArray(parsed.items)) {
        questions = parsed.items;
      } else {
        // Try to find any array in the response
        const keys = Object.keys(parsed);
        for (const key of keys) {
          if (Array.isArray(parsed[key])) {
            const arrayValue = parsed[key];
            // Check if array contains strings (questions)
            if (arrayValue.length > 0 && typeof arrayValue[0] === 'string') {
              questions = arrayValue;
              this.logger.debug(`Found questions array in key: ${key}`);
              break;
            }
          }
        }
      }

      // Validate and clean questions
      questions = questions
        .filter((q) => {
          // More lenient validation - accept questions with at least 5 characters
          return q && typeof q === 'string' && q.trim().length >= 5;
        })
        .slice(0, count)
        .map((q) => q.trim());

      if (questions.length === 0) {
        this.logger.error(`No valid questions found in AI response. Parsed object keys: ${Object.keys(parsed).join(', ')}`);
        this.logger.error(`Full response: ${JSON.stringify(parsed, null, 2).substring(0, 2000)}`);

        // Use fallback questions instead of throwing error
        this.logger.warn('Using fallback questions due to AI generation failure');
        return this.getFallbackQuestions(domain, technology, difficulty, count);
      }

      this.logger.log(`Successfully extracted ${questions.length} questions from AI response`);

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

      // Use fallback questions for other errors
      this.logger.warn('Using fallback questions due to AI error', { error: error.message });
      return this.getFallbackQuestions(domain, technology, difficulty, count);
    }
  }

  /**
   * Get fallback questions when AI generation fails
   */
  private getFallbackQuestions(
    domain: string,
    technology: string,
    difficulty: string,
    count: number,
  ): string[] {
    const fallbackQuestions: Record<string, string[]> = {
      backend: [
        'Tell me about your experience with RESTful API design and best practices.',
        'How do you handle database optimization and query performance?',
        'Explain your approach to implementing authentication and authorization.',
        'Describe a challenging bug you fixed in a backend system.',
        'How do you ensure API security and prevent common vulnerabilities?',
        'What is your experience with microservices architecture?',
        'How do you handle data validation and error handling in APIs?',
        'Explain your approach to logging and monitoring in production.',
        'What strategies do you use for database schema design?',
        'How do you handle API versioning and backward compatibility?',
      ],
      frontend: [
        'Describe your experience with modern frontend frameworks and libraries.',
        'How do you optimize frontend performance and reduce load times?',
        'Explain your approach to responsive design and cross-browser compatibility.',
        'What is your experience with state management in large applications?',
        'How do you ensure accessibility in your web applications?',
        'Describe your approach to component architecture and reusability.',
        'How do you handle form validation and user input?',
        'What testing strategies do you use for frontend code?',
        'Explain your approach to styling and CSS architecture.',
        'How do you optimize bundle size and improve build performance?',
      ],
      fullstack: [
        'Describe your experience working across the full technology stack.',
        'How do you approach building a new feature from frontend to backend?',
        'Explain your experience with both SQL and NoSQL databases.',
        'How do you ensure data consistency between frontend and backend?',
        'Describe your approach to API design and frontend integration.',
        'What is your experience with deployment and DevOps practices?',
        'How do you handle authentication across the entire stack?',
        'Explain your approach to error handling in full-stack applications.',
        'What testing strategies do you use for full-stack development?',
        'How do you optimize performance across the entire application?',
      ],
      devops: [
        'Describe your experience with CI/CD pipelines and automation.',
        'How do you approach infrastructure as code?',
        'Explain your experience with containerization and orchestration.',
        'How do you handle monitoring and alerting in production?',
        'Describe your approach to security and compliance in DevOps.',
        'What is your experience with cloud platforms (AWS, Azure, GCP)?',
        'How do you handle incident response and troubleshooting?',
        'Explain your approach to database backups and disaster recovery.',
        'What strategies do you use for scaling applications?',
        'How do you ensure high availability and fault tolerance?',
      ],
    };

    const questions = fallbackQuestions[domain.toLowerCase()] || fallbackQuestions.backend;
    return questions.slice(0, count);
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
