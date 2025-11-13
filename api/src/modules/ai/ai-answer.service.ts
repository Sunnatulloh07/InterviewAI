import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OpenAI } from 'openai';
import {
  GenerateAnswerDto,
  AnswerResponseDto,
  GeneratedAnswerDto,
} from './dto/generate-answer.dto';
import { AiContextService } from './ai-context.service';
import { UsersService } from '../users/users.service';
import { CvService } from '../cv/cv.service';
import { InterviewsService } from '../interviews/interviews.service';
import { OPENAI_TEMPERATURE, AI_MODELS, CACHE_TTL_MEDIUM } from '@common/constants';
import * as crypto from 'crypto';

@Injectable()
export class AiAnswerService {
  private readonly logger = new Logger(AiAnswerService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly contextService: AiContextService,
    private readonly usersService: UsersService,
    private readonly cvService: CvService,
    private readonly interviewsService: InterviewsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
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
      // Only add if it's a valid organization ID (starts with 'org-' and has proper length)
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
      this.openai = new OpenAI(config);
      this.logger.log('OpenAI client initialized successfully for AI Answer Service');
    } else {
      this.openai = null;
      this.logger.warn('OpenAI API key not configured. AI features will be disabled.');
    }
  }

  /**
   * Generate interview answer using AI
   */
  async generateAnswer(userId: string, dto: GenerateAnswerDto): Promise<AnswerResponseDto> {
    // Check if OpenAI is configured
    if (!this.openai) {
      throw new BadRequestException(
        'AI service is not configured. Please configure OPENAI_API_KEY in environment variables.',
      );
    }

    const startTime = Date.now();

    // Check cache with error handling
    const cacheKey = this.generateCacheKey(dto);
    let cached: AnswerResponseDto | undefined;
    try {
      cached = await this.cacheManager.get<AnswerResponseDto>(cacheKey);
      if (cached) {
        this.logger.log(`Answer retrieved from cache: ${cacheKey}`);
        return { ...cached, cached: true };
      }
    } catch (error) {
      // Graceful degradation: If cache fails, continue without cache
      this.logger.warn(`Cache GET failed for key ${cacheKey}: ${error.message}`);
      // Continue to generate answer
    }

    // Get user for plan-based model selection and language preference
    const user = await this.usersService.findById(userId);
    const model = this.getModelByPlan(user.subscription?.plan);

    // Get user language preference (PRIORITY: DTO > user.preferences.language > user.language > 'en')
    // Always prioritize DB values over defaults
    const language = dto.language || user.preferences?.language || user.language || 'en';

    // Log language for debugging
    this.logger.debug(
      `Generating answer for user ${userId} in language: ${language} (from: ${dto.language ? 'DTO' : user.preferences?.language ? 'preferences' : user.language ? 'user.language' : 'default'})`,
    );

    // Get or create session context
    let context: any = {};
    if (dto.sessionId) {
      context = await this.contextService.getContext(dto.sessionId);
    }

    // Get user CV data if available
    const cvData = await this.getUserCvData(userId);

    // Get user interview history for context
    const interviewHistory = await this.getUserInterviewHistory(userId);

    try {
      const answers: GeneratedAnswerDto[] = [];
      const variations = dto.variations || 1;

      for (let i = 0; i < variations; i++) {
        const answer = await this.generateSingleAnswer(
          dto,
          model,
          context,
          cvData,
          interviewHistory,
          language,
          i,
        );
        answers.push(answer);
      }

      const processingTime = Date.now() - startTime;
      const tokensUsed = this.estimateTokens(dto.question, answers);

      // Update context if session ID provided
      if (dto.sessionId) {
        await this.contextService.addMessage(dto.sessionId, {
          role: 'user',
          content: dto.question,
          type: 'question',
          timestamp: new Date(),
        });
        await this.contextService.addMessage(dto.sessionId, {
          role: 'assistant',
          content: answers[0].content,
          type: 'answer',
          timestamp: new Date(),
        });
      }

      const response: AnswerResponseDto = {
        answers,
        processingTime,
        tokensUsed,
        model,
        cached: false,
        sessionId: dto.sessionId,
      };

      // Cache response with error handling
      try {
        await this.cacheManager.set(cacheKey, response, CACHE_TTL_MEDIUM * 1000);
      } catch (error) {
        // Graceful degradation: If cache fails, log but don't fail request
        this.logger.warn(`Cache SET failed for key ${cacheKey}: ${error.message}`);
        // Continue - response is still returned to user
      }

      this.logger.log(`Answer generated in ${processingTime}ms using ${model}`);
      return response;
    } catch (error) {
      this.logger.error(`Answer generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate single answer variant
   */
  private async generateSingleAnswer(
    dto: GenerateAnswerDto,
    model: string,
    context: any,
    cvData: any,
    interviewHistory: any,
    language: string,
    variantIndex: number,
  ): Promise<GeneratedAnswerDto> {
    if (!this.openai) {
      throw new BadRequestException('OpenAI service is not configured');
    }

    const style = dto.style || 'professional';
    const length = dto.length || 'medium';
    const variant =
      variantIndex === 0 ? style : ['professional', 'balanced', 'simple'][variantIndex % 3];

    const prompt = this.buildPrompt(
      dto,
      style,
      length,
      context,
      cvData,
      interviewHistory,
      language,
    );

    // Adjust temperature based on language to ensure consistency
    // Lower temperature for non-English to ensure language adherence
    const temperature = language !== 'en' ? Math.min(OPENAI_TEMPERATURE, 0.5) : OPENAI_TEMPERATURE;

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(variant, language),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: this.getMaxTokensByLength(length),
      temperature,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0].message.content || '{}';
    const parsed = JSON.parse(responseText) as any;

    // Validate that response is in the correct language (basic check)
    // If answer contains mostly English words and language is not English, log a warning
    if (language !== 'en' && parsed.answer) {
      const englishWordCount = (
        parsed.answer.match(
          /\b(the|is|are|was|were|have|has|had|will|would|can|could|should|this|that|with|from|for|and|or|but|in|on|at|to|of|a|an)\b/gi,
        ) || []
      ).length;
      const totalWordCount = parsed.answer.split(/\s+/).length;
      const englishRatio = totalWordCount > 0 ? englishWordCount / totalWordCount : 0;

      if (englishRatio > 0.3) {
        this.logger.warn(
          `Possible language mismatch: Answer for user language ${language} contains ${(englishRatio * 100).toFixed(1)}% English words. Response: ${parsed.answer.substring(0, 100)}...`,
        );
      }
    }

    return {
      variant,
      content: parsed.answer || '',
      keyPoints: parsed.keyPoints || [],
      starMethod: parsed.starMethod,
      confidence: parsed.confidence || 0.9,
      suggestedFollowups: parsed.suggestedFollowups || [],
    };
  }

  /**
   * Build prompt for answer generation
   * Professional Senior Prompt Engineer Logic: Comprehensive context, structured data, clear instructions
   */
  private buildPrompt(
    dto: GenerateAnswerDto,
    style: string,
    length: string,
    context: any,
    cvData: any,
    interviewHistory: any,
    language: string,
  ): string {
    const languageName = this.getLanguageName(language);
    let prompt = `You are an expert interview coach helping a candidate prepare for job interviews. Generate a ${style}, ${length}-length answer that is professional, authentic, and tailored to the candidate's background.\n\n`;

    // CRITICAL: Language instruction must be at the beginning and very explicit
    // Use target language examples to reinforce the requirement
    const languageExamples: Record<string, string> = {
      uz: `Masalan: "Men Node.js bo'yicha 3 yil tajribaga egaman" (to'g'ri), "I have 3 years of experience" (noto'g'ri)`,
      ru: `Например: "У меня 3 года опыта работы с Node.js" (правильно), "I have 3 years of experience" (неправильно)`,
      en: `Example: "I have 3 years of experience with Node.js" (correct)`,
    };

    prompt += `## CRITICAL LANGUAGE REQUIREMENT - READ THIS FIRST\n`;
    prompt += `**MANDATORY:** You MUST respond EXCLUSIVELY in ${languageName} (${language.toUpperCase()}).\n`;
    prompt += `**DO NOT** use English or any other language.\n`;
    prompt += `${languageExamples[language] || languageExamples['en']}\n\n`;
    prompt += `**ALL** output must be in ${languageName}:\n`;
    prompt += `- The "answer" field in JSON: ${languageName}\n`;
    prompt += `- The "keyPoints" array: ${languageName}\n`;
    prompt += `- The "starMethod" object (if applicable): ${languageName}\n`;
    prompt += `- The "suggestedFollowups" array: ${languageName}\n`;
    prompt += `**If you respond in English or any other language, the response will be rejected and you must regenerate it.**\n\n`;

    // Question Section
    prompt += `## INTERVIEW QUESTION\n${dto.question}\n\n`;

    // Job Description Section (if provided)
    if (dto.jobDescription) {
      prompt += `## TARGET JOB DESCRIPTION\n${dto.jobDescription}\n\n`;
      prompt += `IMPORTANT: Align your answer with the job requirements and demonstrate how the candidate's experience matches the role.\n\n`;
    }

    // Comprehensive Candidate Background (CV Data)
    if (cvData) {
      prompt += `## CANDIDATE BACKGROUND\n`;

      // Personal Information
      if (cvData.personalInfo) {
        prompt += `**Personal Information:**\n`;
        if (cvData.personalInfo.name) {
          prompt += `- Name: ${cvData.personalInfo.name}\n`;
        }
        if (cvData.personalInfo.email) {
          prompt += `- Email: ${cvData.personalInfo.email}\n`;
        }
        if (cvData.personalInfo.phone) {
          prompt += `- Phone: ${cvData.personalInfo.phone}\n`;
        }
        if (cvData.personalInfo.location) {
          prompt += `- Location: ${cvData.personalInfo.location}\n`;
        }
        prompt += `\n`;
      }

      // Professional Summary
      if (cvData.summary && cvData.summary.trim()) {
        prompt += `**Professional Summary:**\n${cvData.summary}\n\n`;
      }

      // Experience (Detailed)
      if (cvData.experience && cvData.experience.length > 0) {
        prompt += `**Work Experience (${cvData.experience.length} positions):**\n`;
        cvData.experience.slice(0, 5).forEach((exp: any, idx: number) => {
          prompt += `${idx + 1}. ${exp.title || 'Position'} at ${exp.company || 'Company'}`;
          if (exp.startDate || exp.endDate) {
            prompt += ` (${exp.startDate || 'Start'} - ${exp.endDate || 'Present'})`;
          }
          prompt += `\n`;
          if (exp.description) {
            prompt += `   ${exp.description.substring(0, 200)}${exp.description.length > 200 ? '...' : ''}\n`;
          }
          if (exp.achievements && exp.achievements.length > 0) {
            prompt += `   Key Achievements: ${exp.achievements.slice(0, 3).join(', ')}\n`;
          }
        });
        prompt += `\n`;
      }

      // Education
      if (cvData.education && cvData.education.length > 0) {
        prompt += `**Education:**\n`;
        cvData.education.slice(0, 3).forEach((edu: any) => {
          prompt += `- ${edu.degree || 'Degree'} in ${edu.field || 'Field'}`;
          if (edu.institution) {
            prompt += ` from ${edu.institution}`;
          }
          if (edu.graduationYear) {
            prompt += ` (${edu.graduationYear})`;
          }
          prompt += `\n`;
        });
        prompt += `\n`;
      }

      // Skills (Technical & Soft)
      if (cvData.skills && cvData.skills.length > 0) {
        prompt += `**Skills:** ${cvData.skills.join(', ')}\n\n`;
      }

      // Certifications
      if (cvData.certifications && cvData.certifications.length > 0) {
        prompt += `**Certifications:** ${cvData.certifications.map((c: any) => c.name || c).join(', ')}\n\n`;
      }

      // Projects
      if (cvData.projects && cvData.projects.length > 0) {
        prompt += `**Notable Projects:**\n`;
        cvData.projects.slice(0, 3).forEach((proj: any) => {
          prompt += `- ${proj.name || 'Project'}: ${proj.description?.substring(0, 150) || ''}\n`;
        });
        prompt += `\n`;
      }

      // Languages
      if (cvData.languages && cvData.languages.length > 0) {
        prompt += `**Languages:** ${cvData.languages.map((l: any) => (typeof l === 'string' ? l : `${l.name} (${l.level})`)).join(', ')}\n\n`;
      }

      // CV Analysis Insights
      if (cvData.analysis) {
        prompt += `**CV Analysis Insights:**\n`;
        prompt += `- ATS Score: ${cvData.analysis.atsScore}/100\n`;
        if (cvData.analysis.strengths && cvData.analysis.strengths.length > 0) {
          prompt += `- Key Strengths: ${cvData.analysis.strengths.slice(0, 5).join(', ')}\n`;
        }
        prompt += `\n`;
      }
    }

    // Interview History & Performance Context
    if (interviewHistory && interviewHistory.totalInterviews > 0) {
      prompt += `## INTERVIEW PERFORMANCE HISTORY\n`;
      prompt += `- Total Mock Interviews Completed: ${interviewHistory.totalInterviews}\n`;
      prompt += `- Completed Interviews: ${interviewHistory.completedInterviews}\n`;
      prompt += `- Average Score: ${interviewHistory.averageScore.toFixed(1)}/10\n\n`;

      if (interviewHistory.weakAreas && interviewHistory.weakAreas.length > 0) {
        prompt += `**Areas Needing Improvement:** ${interviewHistory.weakAreas.slice(0, 5).join(', ')}\n`;
        prompt += `IMPORTANT: Address these areas in your answer to help the candidate improve.\n\n`;
      }

      if (interviewHistory.strongAreas && interviewHistory.strongAreas.length > 0) {
        prompt += `**Strong Areas:** ${interviewHistory.strongAreas.slice(0, 5).join(', ')}\n`;
        prompt += `IMPORTANT: Leverage these strengths in your answer.\n\n`;
      }

      if (
        interviewHistory.practicedTopics &&
        Object.keys(interviewHistory.practicedTopics).length > 0
      ) {
        prompt += `**Practiced Topics:** ${Object.keys(interviewHistory.practicedTopics).slice(0, 5).join(', ')}\n\n`;
      }
    }

    // Previous Conversation Context (Full Messages, Not Truncated)
    if (context.messages && context.messages.length > 0) {
      prompt += `## PREVIOUS CONVERSATION CONTEXT\n`;
      prompt += `The following is the recent conversation history to maintain context and continuity:\n\n`;
      const recentMessages = context.messages.slice(-6); // Last 6 messages for better context
      recentMessages.forEach((msg: any, idx: number) => {
        const role = msg.role === 'user' ? 'Candidate' : 'Assistant';
        const content =
          msg.content.length > 500 ? `${msg.content.substring(0, 500)}...` : msg.content;
        prompt += `${idx + 1}. [${role}]: ${content}\n\n`;
      });
    }

    // Answer Requirements
    prompt += `## ANSWER REQUIREMENTS\n`;
    prompt += `- **Style:** ${style} (${this.getStyleDescription(style)})\n`;
    prompt += `- **Length:** ${length} (${this.getLengthDescription(length)})\n`;
    prompt += `- **Key Points:** ${dto.includeKeyPoints !== false ? 'Include 3-5 key points to highlight' : 'Not required'}\n`;
    prompt += `- **Follow-up Questions:** ${dto.includeFollowups !== false ? 'Suggest 2-3 potential follow-up questions' : 'Not required'}\n`;
    prompt += `- **Authenticity:** Use the candidate's actual experience from their CV. Do not fabricate experiences.\n`;
    prompt += `- **Relevance:** Connect the answer directly to the job description if provided.\n`;
    prompt += `- **Structure:** Organize the answer logically with clear introduction, body, and conclusion.\n\n`;

    // Behavioral Question Detection (STAR Method)
    const isBehavioral = this.isBehavioralQuestion(dto.question);
    if (isBehavioral) {
      prompt += `## BEHAVIORAL QUESTION DETECTED - USE STAR METHOD\n`;
      prompt += `This is a behavioral interview question. Structure your answer using the STAR method:\n`;
      prompt += `- **Situation:** Set the context and background (1-2 sentences)\n`;
      prompt += `- **Task:** Describe the specific task or challenge you faced (1-2 sentences)\n`;
      prompt += `- **Action:** Explain the actions you took to address the task (3-5 sentences, most important part)\n`;
      prompt += `- **Result:** Describe the outcome and what you learned (2-3 sentences)\n\n`;
      prompt += `IMPORTANT: Use a real example from the candidate's experience. Be specific with metrics and outcomes.\n\n`;
    }

    // Technical Question Detection
    const isTechnical = this.isTechnicalQuestion(dto.question);
    if (isTechnical) {
      prompt += `## TECHNICAL QUESTION DETECTED\n`;
      prompt += `This is a technical question. Provide:\n`;
      prompt += `- Clear, accurate technical explanation\n`;
      prompt += `- Real-world examples from the candidate's experience if applicable\n`;
      prompt += `- Code examples or diagrams if relevant (use markdown code blocks)\n`;
      prompt += `- Best practices and industry standards\n\n`;
    }

    // Output Format
    prompt += `## OUTPUT FORMAT\n`;
    prompt += `Provide your response in the following JSON format (strictly valid JSON):\n`;
    prompt += `{\n`;
    prompt += `  "answer": "<the complete, well-structured answer in ${length} length>",\n`;
    prompt += `  "keyPoints": [<array of 3-5 key points or takeaways>],\n`;
    if (isBehavioral) {
      prompt += `  "starMethod": {\n`;
      prompt += `    "situation": "<situation description>",\n`;
      prompt += `    "task": "<task description>",\n`;
      prompt += `    "action": "<detailed action taken>",\n`;
      prompt += `    "result": "<result achieved with metrics if possible>"\n`;
      prompt += `  },\n`;
    }
    prompt += `  "confidence": <number 0-1, representing confidence in the answer quality>,\n`;
    prompt += `  "suggestedFollowups": [<array of 2-3 potential follow-up questions the interviewer might ask>]\n`;
    prompt += `}\n\n`;

    prompt += `## FINAL INSTRUCTIONS\n`;
    prompt += `1. **CRITICAL - LANGUAGE:** Generate ALL content EXCLUSIVELY in ${languageName} (${language.toUpperCase()}). This includes:\n`;
    prompt += `   - The "answer" field: ${languageName}\n`;
    prompt += `   - The "keyPoints" array: ${languageName}\n`;
    prompt += `   - The "starMethod" object (if applicable): ${languageName}\n`;
    prompt += `   - The "suggestedFollowups" array: ${languageName}\n`;
    prompt += `   **DO NOT use English or any other language. If you use English, regenerate the entire response.**\n\n`;
    prompt += `2. Generate a professional, authentic answer based on the candidate's actual background\n`;
    prompt += `3. Ensure the answer is ${length} in length (${this.getLengthWordCount(length)} words approximately)\n`;
    prompt += `4. Make the answer relevant to the job description if provided\n`;
    prompt += `5. Use specific examples from the candidate's CV when possible\n`;
    prompt += `6. Address any identified weak areas from interview history\n`;
    prompt += `7. Maintain conversation context if previous messages exist\n`;
    prompt += `8. Ensure the answer is ${style} in tone and style\n`;
    prompt += `9. **FINAL REMINDER:** Before sending the JSON response, verify that ALL text fields are in ${languageName}. If any field contains English, translate it to ${languageName} immediately.\n`;

    return prompt;
  }

  /**
   * Get style description
   */
  private getStyleDescription(style: string): string {
    const descriptions: Record<string, string> = {
      professional: 'polished, articulate, demonstrating leadership and expertise',
      balanced: 'clear, natural, balancing professionalism with authenticity',
      simple: 'straightforward, easy-to-understand, honest and relatable',
    };
    return descriptions[style] || descriptions['balanced'];
  }

  /**
   * Get length description
   */
  private getLengthDescription(length: string): string {
    const descriptions: Record<string, string> = {
      short: 'concise, 30-60 seconds when spoken',
      medium: 'moderate, 1-2 minutes when spoken',
      long: 'detailed, 2-3 minutes when spoken',
    };
    return descriptions[length] || descriptions['medium'];
  }

  /**
   * Get length word count
   */
  private getLengthWordCount(length: string): string {
    const counts: Record<string, string> = {
      short: '50-100',
      medium: '150-250',
      long: '300-500',
    };
    return counts[length] || counts['medium'];
  }

  /**
   * Check if question is technical
   */
  private isTechnicalQuestion(question: string): boolean {
    const technicalKeywords = [
      'algorithm',
      'data structure',
      'design pattern',
      'architecture',
      'database',
      'api',
      'framework',
      'language',
      'code',
      'programming',
      'implementation',
      'optimize',
      'performance',
      'scalability',
      'security',
      'testing',
      'debugging',
      'system design',
      'how would you',
      'explain',
      'what is',
      'difference between',
    ];
    const lowerQuestion = question.toLowerCase();
    return technicalKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  /**
   * Get system prompt based on style and language
   */
  private getSystemPrompt(style: string, language: string = 'en'): string {
    const languageName = this.getLanguageName(language);
    const languageCode = language.toUpperCase();

    // Language-specific system prompts for better adherence
    const languageInstructions: Record<string, string> = {
      uz: `Siz professional intervyu murabbiysi. Barcha javoblarni O'ZBEK TILIDA berishingiz kerak. Hech qachon ingliz yoki boshqa tillarda javob bermang.`,
      ru: `Вы профессиональный тренер по собеседованиям. Вы ДОЛЖНЫ отвечать на РУССКОМ ЯЗЫКЕ. Никогда не отвечайте на английском или других языках.`,
      en: `You are a professional interview coach. You MUST respond in ENGLISH. Never respond in other languages.`,
    };

    const basePrompts: Record<string, string> = {
      professional:
        'You are an expert interview coach helping professionals prepare for job interviews. Provide articulate, polished answers that demonstrate leadership and expertise.',
      balanced:
        'You are an interview coach helping candidates prepare for interviews. Provide clear, natural answers that balance professionalism with authenticity.',
      simple:
        'You are an interview coach helping entry-level candidates. Provide straightforward, easy-to-understand answers that are honest and relatable.',
    };
    const basePrompt = basePrompts[style] || basePrompts['balanced'];

    // Add explicit language instruction in the target language itself
    const languageInstruction = languageInstructions[language] || languageInstructions['en'];

    return `${basePrompt}\n\n${languageInstruction}\n\nCRITICAL RULE: All JSON response fields (answer, keyPoints, starMethod, suggestedFollowups) MUST be in ${languageName} (${languageCode}). If you respond in English or any other language, the response will be rejected.`;
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
   * Check if question is behavioral
   */
  private isBehavioralQuestion(question: string): boolean {
    const behavioralKeywords = [
      'tell me about a time',
      'describe a situation',
      'give me an example',
      'have you ever',
      'can you share',
      'when did you',
      'conflict',
      'challenge',
      'difficult',
      'mistake',
      'failure',
      'success',
    ];
    const lowerQuestion = question.toLowerCase();
    return behavioralKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  /**
   * Get max tokens by length
   */
  private getMaxTokensByLength(length: string): number {
    const tokens: Record<string, number> = {
      short: 300,
      medium: 600,
      long: 1000,
    };
    return tokens[length] || tokens['medium'];
  }

  /**
   * Get user CV data
   */
  private async getUserCvData(userId: string): Promise<any> {
    try {
      // Get user's latest CV
      const cvs = await this.cvService.getUserCvs(userId, 1, 0);
      if (cvs.length === 0) {
        return null;
      }

      const cv = cvs[0];
      if (!cv.parsedData) {
        return null;
      }

      // Return structured CV data for prompt
      return {
        personalInfo: cv.parsedData.personalInfo || {},
        summary: cv.parsedData.summary || '',
        experience: cv.parsedData.experience || [],
        education: cv.parsedData.education || [],
        skills: cv.parsedData.skills || [],
        languages: cv.parsedData.languages || [],
        certifications: cv.parsedData.certifications || [],
        projects: cv.parsedData.projects || [],
        analysis: cv.analysis
          ? {
              atsScore: cv.analysis.atsScore,
              strengths: cv.analysis.strengths || [],
            }
          : null,
      };
    } catch (error) {
      this.logger.warn(`Failed to get CV data for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(dto: GenerateAnswerDto): string {
    const key = `answer:${crypto
      .createHash('md5')
      .update(
        JSON.stringify({
          question: dto.question,
          style: dto.style,
          length: dto.length,
          jobDesc: dto.jobDescription?.substring(0, 100),
        }),
      )
      .digest('hex')}`;
    return key;
  }

  /**
   * Estimate tokens used
   */
  private estimateTokens(question: string, answers: GeneratedAnswerDto[]): number {
    const questionTokens = Math.ceil(question.length / 4);
    const answerTokens = answers.reduce((sum, a) => sum + Math.ceil(a.content.length / 4), 0);
    return questionTokens + answerTokens;
  }

  /**
   * Get AI model based on subscription plan
   * Free plan: GPT-5 Nano (via OpenRouter - cheaper and faster)
   * Pro/Elite/Enterprise: GPT-4 for better quality
   */
  private getModelByPlan(plan?: string): string {
    if (plan === 'elite' || plan === 'pro' || plan === 'enterprise') {
      return AI_MODELS.GPT4;
    }
    // Use GPT-5 Nano for free plan (if using OpenRouter)
    // Falls back to GPT-3.5 if using OpenAI direct
    return AI_MODELS.GPT5_NANO;
  }

  /**
   * Get user interview history for context
   */
  private async getUserInterviewHistory(userId: string): Promise<any> {
    try {
      const analytics = await this.interviewsService.getAnalytics(userId);

      if (!analytics || analytics.totalInterviews === 0) {
        return null;
      }

      // Get recent sessions to identify weak/strong areas
      const recentSessions = await this.interviewsService.getHistory(userId, 10, 0);

      const weakAreas: string[] = [];
      const strongAreas: string[] = [];

      // Analyze feedback from recent sessions
      recentSessions.forEach((session: any) => {
        if (session.feedback?.summary?.weaknesses) {
          weakAreas.push(...session.feedback.summary.weaknesses);
        }
        if (session.feedback?.summary?.strengths) {
          strongAreas.push(...session.feedback.summary.strengths);
        }
      });

      return {
        totalInterviews: analytics.totalInterviews,
        completedInterviews: analytics.completedInterviews,
        averageScore: analytics.averageScore || 0,
        weakAreas: [...new Set(weakAreas)].slice(0, 5),
        strongAreas: [...new Set(strongAreas)].slice(0, 5),
        practicedTopics: analytics.practicedTopics || {},
      };
    } catch (error) {
      this.logger.warn(`Failed to get interview history for user ${userId}: ${error.message}`);
      return null;
    }
  }
}
