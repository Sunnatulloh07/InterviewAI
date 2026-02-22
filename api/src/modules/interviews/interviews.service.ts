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
import {
  USAGE_LIMITS,
  QUEUE_INTERVIEW_FEEDBACK,
  AI_MODELS,
  INTERVIEW_QUESTION_COUNTS,
  COMPLETE_PLAN_LIMITS,
  getMockInterviewMonthlyLimit,
} from '@common/constants';
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
      // OPTIMIZATION: Get user once at the beginning
      const user = await this.usersService.findById(userId);

      // Check usage limits
      await this.checkUsageLimits(userId);

      // Calculate question count from duration + difficulty (or use provided value)
      const numQuestions =
        dto.numQuestions ??
        this.getQuestionCount(dto.interviewDuration || 'standard', dto.difficulty);

      // Set language from user preferences if not in DTO
      if (!dto.language) {
        dto.language = user?.preferences?.language || user?.language || 'en';
      }

      // Generate questions
      const questions = await this.generateQuestions(userId, dto, numQuestions);

      if (questions.length === 0) {
        throw new BadRequestException('No questions available for the selected criteria');
      }

      // Get user profile to set time limits based on position
      const position = user?.profile?.position || 'junior';

      // Set time limit based on position (in minutes per question)
      const questionTimeLimit = {
        junior: 3,
        middle: 4,
        senior: 5,
        lead: 6,
      }[position];

      // Create AI session for context
      const aiSession = await this.contextService.createSession(userId, 'interview');

      // Create interview session
      const session = await this.repository.createSession({
        userId: userId as any,
        type: dto.type,
        difficulty: dto.difficulty,
        domain: dto.domain,
        technology: dto.technology || [],
        numQuestions,
        interviewDuration: dto.interviewDuration || 'standard',
        mode: dto.mode,
        timeLimit: dto.timeLimit || questionTimeLimit, // Use position-based time limit if not provided
        status: 'active',
        currentQuestionIndex: 0,
        questions: questions.map((q) => q._id) as any,
        answers: [],
        startedAt: new Date(),
        aiSessionId: aiSession.id,
      });

      // Usage counter already incremented by caller (telegram-commands.service.ts:3298)
      // No need to increment again here to avoid double counting
      // await this.usersService.incrementUsage(userId, 'mockInterview'); // ❌ REMOVED: Duplicate

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
      // Handle both populated objects and ObjectId strings
      const questionExists = session.questions.some((q: any) => {
        if (!q) return false;
        // If q is a populated object, check _id or id
        if (typeof q === 'object' && q._id) {
          return q._id.toString() === dto.questionId || q.id?.toString() === dto.questionId;
        }
        // If q is an ObjectId or string, compare directly
        return q.toString() === dto.questionId;
      });
      if (!questionExists) {
        this.logger.error(
          `Question ${dto.questionId} not found in session ${sessionId}. Session questions: ${JSON.stringify(
            session.questions.map((q: any) => {
              if (typeof q === 'object' && q._id) {
                return q._id.toString();
              }
              return q.toString();
            }),
          )}`,
        );
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

      // Feedback generation is now deferred to the end of the session (Batch Processing)
      // to save tokens and optimize performance.
      // See generateSessionFeedback implementation.

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
   * Get simple stats for a user (used by EngagementService)
   */
  async getStats(userId: string): Promise<{ totalInterviews: number; averageScore: number }> {
    try {
      const totalInterviews = await this.repository.countSessionsByUserId(userId, 'completed');
      const averageScore = await this.repository.getAverageScore(userId);
      return { totalInterviews, averageScore };
    } catch (error) {
      this.logger.error(`Failed to get stats for user ${userId}: ${error.message}`);
      return { totalInterviews: 0, averageScore: 0 };
    }
  }

  /**
   * Find paused/in-progress interview session for a user (used by EngagementService)
   */
  async findPausedSessionForUser(userId: string): Promise<InterviewSessionDocument | null> {
    try {
      const sessions = await this.repository.findSessionsByUserId(userId, 5, 0);
      // Find the most recent paused or in_progress session
      return sessions.find((s) => s.status === 'paused' || s.status === 'in_progress') || null;
    } catch (error) {
      this.logger.error(`Failed to find paused session for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate interview questions
   * ALWAYS generates questions using AI - no hardcode or DB lookup
   */
  private async generateQuestions(
    userId: string,
    dto: StartInterviewDto,
    numQuestions: number,
  ): Promise<InterviewQuestionDocument[]> {
    // Always generate questions using AI
    const questions = await this.generateSeedQuestions(userId, dto, numQuestions);
    return questions;
  }

  /**
   * Calculate question count based on interview duration and difficulty
   */
  private getQuestionCount(duration: string, difficulty: string): number {
    const durationKey = duration as keyof typeof INTERVIEW_QUESTION_COUNTS;
    const counts = INTERVIEW_QUESTION_COUNTS[durationKey] || INTERVIEW_QUESTION_COUNTS.standard;

    // Map interview difficulty ('mid') to question count key ('middle')
    const difficultyToCountKey: Record<string, keyof typeof counts> = {
      junior: 'junior',
      mid: 'middle',
      middle: 'middle',
      senior: 'senior',
    };
    const countKey = difficultyToCountKey[difficulty] || 'middle';
    return counts[countKey];
  }

  /**
   * Generate questions using AI only
   * No hardcode or DB lookup - always generates fresh questions
   */
  private async generateSeedQuestions(
    userId: string,
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
      const aiQuestions = await this.generateQuestionsWithAI(userId, dto, count);
      const questionsData = aiQuestions.map((q, i) => ({
        order: i + 1,
        category: dto.type,
        difficulty: dto.difficulty,
        question: q,
        expectedKeyPoints: [],
        hints: [],
        tags: dto.technology || [],
        domain: dto.domain,
        technology: dto.technology,
        createdBy: 'system',
      }));

      const createdQuestions = await this.repository.createQuestions(questionsData);
      questions.push(...createdQuestions);
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
  private async generateQuestionsWithAI(
    userId: string,
    dto: StartInterviewDto,
    count: number,
  ): Promise<string[]> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    // OPTIMIZATION: Language now set in startInterview, no need to fetch user again
    const language = dto.language || 'en';
    const languageName = this.getLanguageName(language);
    const difficultyName = this.getDifficultyName(dto.difficulty);
    const categoryName = this.getCategoryName(dto.type);

    // Get user interview context for personalized questions
    const historyContext = await this.getUserInterviewContext(userId);
    const { incorrectQuestions, allQuestions } = historyContext;

    // Build prompt for question generation
    // CRITICAL: Language instruction MUST be at the beginning for maximum enforcement
    let prompt = `You are an expert interview question generator with 10+ years of experience in technical recruitment and interview design. Generate ${count} unique, professional interview questions for a ${difficultyName}-level ${categoryName} interview.\n\n`;

    // CRITICAL LANGUAGE REQUIREMENT - Must be at the beginning
    prompt += `## CRITICAL LANGUAGE REQUIREMENT - READ THIS FIRST\n`;
    prompt += `**MANDATORY:** You MUST generate ALL questions EXCLUSIVELY in ${languageName} (${language.toUpperCase()}).\n`;
    prompt += `**DO NOT** use English or any other language for the questions.\n`;

    // Language-specific examples
    const languageExamples: Record<string, string> = {
      uz: `Masalan: "Node.js da event loop qanday ishlaydi?" (to'g'ri), "How does event loop work in Node.js?" (noto'g'ri)`,
      ru: `Например: "Как работает event loop в Node.js?" (правильно), "How does event loop work in Node.js?" (неправильно)`,
      en: `Example: "How does event loop work in Node.js?" (correct)`,
    };
    prompt += `${languageExamples[language] || languageExamples['en']}\n\n`;
    prompt += `**ALL** questions in the "questions" array MUST be in ${languageName}.\n`;
    prompt += `**If you generate any question in English or another language, the response will be rejected.**\n\n`;

    // Interview Context
    prompt += `## INTERVIEW CONTEXT\n`;
    prompt += `- **Interview Type:** ${categoryName}\n`;
    prompt += `- **Difficulty Level:** ${difficultyName}\n`;

    if (dto.domain) {
      prompt += `- **Domain:** ${dto.domain}\n`;
    }

    if (dto.technology && dto.technology.length > 0) {
      prompt += `- **Technologies:** ${dto.technology.join(', ')}\n`;
    }

    // ADAPTIVE DIFFICULTY LOGIC
    // Use average score to determine if we should ramp up difficulty or focus on basics
    // 0-50%: Foundational/Remedial
    // 50-80%: Progressive/Standard
    // 80-100%: Advanced/Challenging
    const averageScore = historyContext.averageScore * 10; // Convert 0-10 to 0-100 scale for easier logic

    prompt += `\n## ADAPTIVE DIFFICULTY INSTRUCTIONS (USER LEVEL: ${averageScore}%)\n`;

    if (averageScore >= 80) {
      // High performer - Challenge them
      prompt += `\n🔥 **STRATEGY: ADVANCED CHALLENGE**\n`;
      prompt += `The candidate has a high performance history (${averageScore}% avg). DO NOT ask basic questions.\n`;
      prompt += `- Focus on **System Design, Architecture, Optimization, and Edge Cases**.\n`;
      prompt += `- Ask "How would you design..." or "How to optimize..." style questions.\n`;
      prompt += `- Test deep understanding of the core mechanics, not just syntax.\n`;
    } else if (averageScore >= 50) {
      // Average performer - Progressive growth
      prompt += `\n📈 **STRATEGY: PROGRESSIVE GROWTH**\n`;
      prompt += `The candidate is performing well (${averageScore}% avg). Challenge them to level up.\n`;
      prompt += `- Mix 70% standard questions with 30% advanced concepts.\n`;
      prompt += `- Push them slightly beyond standard "textbook" answers.\n`;
      prompt += `- Focus on "Why" and "When" to use specific technologies.\n`;
    } else {
      // Struggling or New - Foundational
      prompt += `\n🌱 **STRATEGY: FOUNDATIONAL REINFORCEMENT**\n`;
      prompt += `The candidate needs to build stronger basics (Avg: ${averageScore}%).\n`;
      prompt += `- Focus on **Core Concepts, Basic Syntax, and Fundamental Principles**.\n`;
      prompt += `- ensure questions are clear and about the most essential parts of the technology.\n`;
      prompt += `- Avoid obscure edge cases or complex architecture questions for now.\n`;
    }

    // Add CV Context if available (personalized questions based on candidate's CV)
    if (dto.cvContext) {
      prompt += `\n## CANDIDATE CV CONTEXT (CRITICAL - Personalize questions based on this)\n`;
      if (dto.cvContext.skills && dto.cvContext.skills.length > 0) {
        prompt += `- **Candidate Technologies:** ${dto.cvContext.skills.slice(0, 15).join(', ')}\n`;
      }
      if (dto.cvContext.experience) {
        prompt += `- **Work Experience:** ${dto.cvContext.experience.substring(0, 500)}\n`;
      }
      if (dto.cvContext.strengths && dto.cvContext.strengths.length > 0) {
        prompt += `- **Key Strengths:** ${dto.cvContext.strengths.slice(0, 5).join(', ')}\n`;
      }
      if (dto.cvContext.summary) {
        prompt += `- **Areas to Improve:** ${dto.cvContext.summary}\n`;
      }
      prompt += `\n**PERSONALIZATION RULES:**\n`;
      prompt += `1. At least 60% of questions MUST test the candidate's listed technologies directly\n`;
      prompt += `2. If weak areas are listed, generate 1-2 questions targeting those weaknesses\n`;
      prompt += `3. Reference specific technologies from the CV — do NOT ask generic questions\n`;
      prompt += `4. For experienced candidates, ask about architecture decisions and trade-offs in their tech stack\n`;
    }
    prompt += `\n`;

    // Add History Context - Intelligent Question Generation
    if (allQuestions.length > 0) {
      prompt += `\n## PREVIOUS INTERVIEW HISTORY (INTELLIGENT GENERATION)\n`;

      // 1. Avoid repetition - STRICT
      prompt += `### ⛔ DO NOT REPEAT THESE QUESTIONS:\n`;
      prompt += `The candidate has recently answered these. You MUST generate COMPLETELY NEW questions:\n`;
      // Limit to last 30 questions to save tokens, but enough to avoid recents
      const recentQuestions = allQuestions.slice(0, 30);
      prompt += recentQuestions.map((q, i) => `${i + 1}. "${q}"`).join('\n') + '\n\n';

      // 2. Focus on weak areas - TARGETED IMPROVEMENT
      if (incorrectQuestions.length > 0) {
        prompt += `### 🎯 TARGET AREAS FOR IMPROVEMENT:\n`;
        prompt += `The candidate struggled with these specific questions/topics in the past:\n`;
        const recentWeaknesses = incorrectQuestions.slice(0, 8);
        prompt += recentWeaknesses.map((q, i) => `- Failed: "${q}"`).join('\n') + '\n';
        prompt += `\n**INSTRUCTION:** Generate at least 2 questions that test the SAME underlying concepts as the failed questions above, but use **DIFFERENT wording, scenarios, or angles**. Do not simply repeat the failed question.\n\n`;
      }
    }
    prompt += `\n`;

    // Requirements
    prompt += `## REQUIREMENTS\n`;
    prompt += `- Generate exactly ${count} unique, non-repetitive questions\n`;
    prompt += `- Questions must be appropriate for ${difficultyName} level candidates\n`;
    prompt += `- Questions must be ${categoryName} type (technical, behavioral, case study, or mixed)\n`;
    prompt += `- Questions should be specific and relevant to the domain/technologies mentioned\n`;
    prompt += `- Avoid generic questions - make them practical, real-world, and interview-relevant\n`;
    prompt += `- Questions should test both knowledge and problem-solving ability\n`;
    prompt += `- For technical questions: focus on concepts, implementation, and best practices\n`;
    prompt += `- For behavioral questions: focus on past experiences, teamwork, and leadership\n`;
    prompt += `- For case study questions: provide realistic scenarios with clear problem statements\n\n`;

    prompt += `## CRITICAL OUTPUT FORMAT\n`;
    prompt += `You MUST return a valid JSON object with this EXACT structure:\n`;
    prompt += `{\n`;
    prompt += `  "questions": ["question 1 in ${languageName}", "question 2 in ${languageName}", "question 3 in ${languageName}", ...]\n`;
    prompt += `}\n\n`;
    prompt += `## IMPORTANT RULES\n`;
    prompt += `- Return ONLY valid JSON, no markdown code blocks (\`\`\`json), no explanations, no text before or after\n`;
    prompt += `- The "questions" array MUST contain exactly ${count} question strings\n`;
    prompt += `- Each question must be a string with at least 10 characters\n`;
    prompt += `- Each question MUST be in ${languageName} (${language.toUpperCase()})\n`;
    prompt += `- Do NOT include \`\`\`json or \`\`\` code blocks\n`;
    prompt += `- Do NOT add any explanatory text\n`;
    prompt += `- The response must be parseable as JSON\n`;
    prompt += `- **FINAL CHECK:** Before returning, verify ALL questions are in ${languageName}. If any question is in English or another language, translate it to ${languageName}.\n\n`;

    try {
      // Determine model based on OpenRouter or OpenAI
      // Note: GPT-5 doesn't exist - using GPT-4o-mini as production-ready alternative
      // IMPORTANT: gpt-5-nano uses reasoning mode which can exhaust tokens, so we use gpt-4o-mini instead
      let model = getModelName(
        this.configService,
        AI_MODELS.GPT35,
        'openai/gpt-4o-mini', // Use gpt-4o-mini instead of gpt-5-nano to avoid reasoning mode issues
      );

      // If user explicitly wants gpt-5-nano, warn them about reasoning mode
      const requestedModel = getModelName(
        this.configService,
        AI_MODELS.GPT35,
        OPENROUTER_MODELS['gpt-5-nano'] || 'openai/gpt-4o-mini',
      );
      if (requestedModel.includes('gpt-5')) {
        this.logger.warn(
          `Model ${requestedModel} uses reasoning mode which may cause token limit issues. Using ${model} instead.`,
        );
      }

      this.logger.debug(`Generating ${count} questions using model: ${model}`);
      this.logger.debug(`Prompt preview: ${prompt.substring(0, 200)}...`);

      // Check if model supports JSON mode (OpenRouter models may vary)
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      const isOpenRouter =
        apiKey?.startsWith('sk-or-v1-') ||
        this.configService.get<string>('OPENROUTER_ENABLED') === 'true';

      // Some models don't support response_format, so we'll try with it first, then without if it fails
      const requestConfig: any = {
        model,
        messages: [
          {
            role: 'system',
            content: `You are a professional interview question generator with expertise in technical recruitment. Your task is to generate interview questions and return them in valid JSON format.

CRITICAL RULES:
1. ALWAYS return a valid JSON object with a "questions" array
2. NEVER include markdown code blocks (\`\`\`json)
3. NEVER add explanatory text before or after the JSON
4. The JSON must be directly parseable
5. Each question must be a string in the "questions" array
6. ALL questions MUST be in the language specified in the user prompt (${languageName})
7. DO NOT use English or any other language unless explicitly requested

Example of correct response:
{"questions": ["Question 1?", "Question 2?", "Question 3?"]}

Example of INCORRECT response (DO NOT DO THIS):
\`\`\`json
{"questions": ["Question 1?"]}
\`\`\`

Your response must be valid JSON that can be parsed directly. All questions must be in ${languageName}.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 4000, // Increased for reasoning models and longer responses
        temperature: 0.8, // Higher temperature for more variety
      };

      // For reasoning models (like gpt-5-nano), we need to handle them differently
      // Reasoning models use tokens for "thinking" which can exhaust the limit before generating content
      if (isOpenRouter && model.includes('gpt-5')) {
        // Increase max_tokens significantly for reasoning models
        requestConfig.max_tokens = 8000; // Much higher for reasoning models
        // Note: Reasoning models may still have issues, so we prefer gpt-4o-mini
        this.logger.warn(
          `Using reasoning model ${model} - this may cause token limit issues. Consider using gpt-4o-mini instead.`,
        );
      }

      // Try to use JSON mode if supported (OpenAI models support it, but some OpenRouter models may not)
      // We'll try with JSON mode first, and if we get an empty response, retry without it
      requestConfig.response_format = { type: 'json_object' };

      let completion;
      try {
        completion = await this.openai.chat.completions.create(requestConfig);
      } catch (jsonModeError: any) {
        // If JSON mode is not supported, try without it
        if (jsonModeError.message?.includes('response_format') || jsonModeError.status === 400) {
          this.logger.warn(
            `Model ${model} may not support JSON mode, retrying without response_format`,
          );
          delete requestConfig.response_format;
          completion = await this.openai.chat.completions.create(requestConfig);
        } else {
          throw jsonModeError;
        }
      }

      // Log full completion object for debugging
      this.logger.debug(
        `Completion object: ${JSON.stringify(completion, null, 2).substring(0, 1000)}`,
      );

      // Check if completion has choices
      if (!completion.choices || completion.choices.length === 0) {
        this.logger.error(
          `No choices in completion response. Full response: ${JSON.stringify(completion, null, 2)}`,
        );
        throw new Error('AI API returned no choices in response');
      }

      const choice = completion.choices[0];
      const responseText = choice?.message?.content || '{}';

      // Log raw response for debugging
      this.logger.debug(`AI response (first 500 chars): ${responseText.substring(0, 500)}`);

      // CRITICAL: Warn if response was truncated due to token limit
      if (choice?.finish_reason === 'length') {
        this.logger.warn(
          `⚠️ AI RESPONSE TRUNCATED! Model: ${completion.model}, Tokens: ${completion.usage?.total_tokens || 'unknown'}`,
        );
        this.logger.warn(`Full truncated response: ${responseText}`);
      }

      this.logger.debug(
        `Response length: ${responseText.length}, isEmpty: ${responseText === '{}' || responseText.trim() === ''}`,
      );

      // Check if response is actually empty
      if (!responseText || responseText.trim() === '' || responseText === '{}') {
        // If we used JSON mode and got empty response, try again without JSON mode
        if (requestConfig.response_format) {
          this.logger.warn(
            `Empty response with JSON mode, retrying without JSON mode for model: ${model}`,
          );
          delete requestConfig.response_format;

          try {
            completion = await this.openai.chat.completions.create(requestConfig);
            const retryChoice = completion.choices[0];
            const retryResponseText = retryChoice?.message?.content || '';

            if (
              retryResponseText &&
              retryResponseText.trim() !== '' &&
              retryResponseText !== '{}'
            ) {
              this.logger.log(`Successfully got response without JSON mode`);
              // Use the retry response
              const retryParsed = JSON.parse(retryResponseText.trim());
              if (retryParsed.questions && Array.isArray(retryParsed.questions)) {
                const retryQuestions = retryParsed.questions
                  .filter((q: any) => q && typeof q === 'string' && q.trim().length >= 5)
                  .slice(0, count)
                  .map((q: string) => q.trim());

                if (retryQuestions.length > 0) {
                  this.logger.log(
                    `Successfully extracted ${retryQuestions.length} questions from retry response`,
                  );
                  return retryQuestions;
                }
              }
            }
          } catch (retryError: any) {
            this.logger.error(`Retry without JSON mode also failed: ${retryError.message}`);
          }
        }

        this.logger.error(
          `Empty AI response. Completion details: ${JSON.stringify(
            {
              finish_reason: choice?.finish_reason,
              index: choice?.index,
              message: choice?.message,
              model: completion.model,
              usage: completion.usage,
            },
            null,
            2,
          )}`,
        );

        // Check finish_reason to understand why response is empty
        if (choice?.finish_reason === 'length') {
          throw new Error(
            'AI response was cut off due to token limit. Try reducing the number of questions or increasing max_tokens.',
          );
        } else if (choice?.finish_reason === 'content_filter') {
          throw new Error('AI response was filtered by content policy. Please adjust your prompt.');
        } else if (choice?.finish_reason === 'stop' && !responseText) {
          throw new Error(
            'AI API returned empty response. The model may not support JSON mode or there may be a configuration issue. Please check your API key and model configuration.',
          );
        } else {
          throw new Error(
            'AI API returned empty response. This might be due to API configuration, model limitations, or quota issues.',
          );
        }
      }

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
        this.logger.error(`FULL Raw Response: ${responseText}`); // Log full response on error
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
        this.logger.error(
          `No valid questions found in AI response. Parsed object keys: ${Object.keys(parsed).join(', ')}`,
        );
        this.logger.error(`Full response: ${JSON.stringify(parsed, null, 2).substring(0, 2000)}`);
        throw new Error('No valid questions generated from AI response');
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
      middle: 'mid-level',
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
  /**
   * CRITICAL: Check mock interview usage limits based on plan
   * ✅ STEP 2 FIX: Now uses COMPLETE_PLAN_LIMITS for accurate enforcement
   *
   * NOTE: This method is now ONLY used for API/direct calls.
   * Telegram bot uses TelegramSubscriptionService.checkMockInterviewLimit()
   * for proper multilingual messages and user experience.
   */
  private async checkUsageLimits(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free_trial';
    const now = new Date();

    // FIX #106: Check subscription expiry FIRST (trial + paid plans)
    // Previously only checked monthly limits — expired users could still proceed
    if (plan === 'free_trial') {
      const trialEnd = user.subscription?.trialEndsAt;
      if (trialEnd && now > new Date(trialEnd)) {
        throw new ForbiddenException(
          'Your free trial has expired. Please upgrade to continue using mock interviews.',
        );
      }
    } else {
      // Paid plan: check status + endDate
      const status = user.subscription?.status;
      const endDate = user.subscription?.endDate;
      if (
        status === 'expired' ||
        status === 'cancelled' ||
        (endDate && now > new Date(endDate))
      ) {
        throw new ForbiddenException(
          'Your subscription has expired. Please renew to continue using mock interviews.',
        );
      }
    }

    // ✅ Use COMPLETE_PLAN_LIMITS (single source of truth)
    const monthlyLimit = getMockInterviewMonthlyLimit(plan);

    // Check if limit reached (-1 means unlimited)
    if (monthlyLimit !== -1 && user.usage.mockInterviewsThisMonth >= monthlyLimit) {
      // Multi-language upgrade messages for better UX
      // ✅ FIX: Updated limits to match COMPLETE_PLAN_LIMITS (free_trial: 3→5)
      const upgradeMessages = {
        free_trial: {
          uz: `Mock intervyu limiti tugadi (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Starter tarifiga o'ting - 10 ta/oy.`,
          ru: `Лимит mock-интервью исчерпан (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Переходите на Starter - 10/мес.`,
          en: `Mock interview limit reached (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Upgrade to Starter for 10/month.`,
        },
        starter: {
          uz: `Mock intervyu limiti tugadi (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Pro tarifiga o'ting - 30 ta/oy.`,
          ru: `Лимит mock-интервью исчерпан (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Переходите на Pro - 30/мес.`,
          en: `Mock interview limit reached (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Upgrade to Pro for 30/month.`,
        },
        pro: {
          uz: `Mock intervyu limiti tugadi (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Elite tarifiga o'ting - cheksiz intervyu.`,
          ru: `Лимит mock-интервью исчерпан (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Переходите на Elite - безлимит.`,
          en: `Mock interview limit reached (${user.usage.mockInterviewsThisMonth}/${monthlyLimit}). Upgrade to Elite for unlimited interviews.`,
        },
      };

      // Use user's language preference or default to English
      const userLang = user.preferences?.language || user.language || 'en';
      const planMessages = upgradeMessages[plan as keyof typeof upgradeMessages];
      const message = planMessages
        ? planMessages[userLang as keyof typeof planMessages] || planMessages.en
        : `Mock interview limit reached for ${plan} plan. Upgrade to practice more.`;

      throw new ForbiddenException(message);
    }

    this.logger.debug(
      `Mock interview usage check passed: ${user.usage.mockInterviewsThisMonth}/${monthlyLimit === -1 ? 'unlimited' : monthlyLimit} for ${plan} plan`,
    );
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
   * Get user interview history for context
   * Analyzes previous sessions to identify correct/incorrect answers and avoid repetition
   */
  async getUserInterviewContext(
    userId: string,
    limit = 5,
  ): Promise<{
    correctQuestions: string[];
    incorrectQuestions: string[];
    allQuestions: string[]; // To avoid repetition
    averageScore: number;
    lastScore?: number;
  }> {
    try {
      // Get last N sessions
      const sessions = await this.repository.findSessionsByUserId(userId, limit);

      const correctQuestions: string[] = [];
      const incorrectQuestions: string[] = [];
      const allQuestions: string[] = [];

      let totalScore = 0;
      let scoredSessionsCount = 0;
      let lastScore: number | undefined;

      // Sessions are sorted by createdAt desc (newest first)
      if (sessions.length > 0 && sessions[0].overallScore !== undefined) {
        lastScore = sessions[0].overallScore;
      }

      // OPTIMIZATION: Batch fetch all answers for these sessions to avoid N+1 problem
      const sessionIds = sessions.map((s) => s.id);
      const allAnswers = await this.repository.findAnswersBySessionIds(sessionIds);

      // Map answers to sessions for easier processing if needed, or process flat list
      // We need to process session scores separately from answers

      for (const session of sessions) {
        // Calculate average score trend
        if (session.overallScore !== undefined) {
          totalScore += session.overallScore;
          scoredSessionsCount++;
        }
      }

      // Process answers
      for (const answer of allAnswers) {
        // Safe access to question text (populated)
        const questionObj = answer.questionId as any;
        const questionText = questionObj?.question || '';

        if (!questionText) continue;

        allQuestions.push(questionText);

        // Categorize based on score (if analyzed)
        // Score >= 7: Considered correct (Mastered)
        // Score < 7: Considered incorrect/partial (needs improvement)
        if (answer.score !== undefined) {
          if (answer.score >= 7) {
            correctQuestions.push(questionText);
          } else {
            incorrectQuestions.push(questionText);
          }
        }
      }

      return {
        correctQuestions: [...new Set(correctQuestions)], // Unique
        incorrectQuestions: [...new Set(incorrectQuestions)], // Unique
        allQuestions: [...new Set(allQuestions)], // Unique
        averageScore:
          scoredSessionsCount > 0 ? Number((totalScore / scoredSessionsCount).toFixed(1)) : 0,
        lastScore,
      };
    } catch (error) {
      this.logger.error(`Failed to get interview context for user ${userId}: ${error.message}`);
      // Return empty context on error
      return {
        correctQuestions: [],
        incorrectQuestions: [],
        allQuestions: [],
        averageScore: 0,
      };
    }
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
