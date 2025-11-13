import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { InterviewsRepository } from './interviews.repository';
import { UsersService } from '../users/users.service';
import { OPENAI_MAX_TOKENS_FEEDBACK, OPENAI_TEMPERATURE, AI_MODELS } from '@common/constants';

@Injectable()
export class InterviewsFeedbackService {
  private readonly logger = new Logger(InterviewsFeedbackService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly repository: InterviewsRepository,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const siteUrl = this.configService.get<string>('OPENAI_SITE_URL');
    const siteName = this.configService.get<string>('OPENAI_SITE_NAME');

    const config: {
      apiKey: string;
      baseURL?: string;
      defaultHeaders?: Record<string, string>;
    } = {
      apiKey: apiKey || '',
    };

    // OpenRouter configuration
    if (baseURL && baseURL.includes('openrouter')) {
      config.baseURL = baseURL;
      config.defaultHeaders = {};

      // Add optional headers for OpenRouter rankings
      if (siteUrl) {
        config.defaultHeaders['HTTP-Referer'] = siteUrl;
      }
      if (siteName) {
        config.defaultHeaders['X-Title'] = siteName;
      }
    }

    this.openai = new OpenAI(config);
    this.logger.log('OpenAI client initialized via OpenRouter');
  }

  /**
   * Generate feedback for answer
   */
  async generateAnswerFeedback(answerId: string, questionId: string): Promise<void> {
    try {
      const answer = await this.repository.findAnswerById(answerId);
      const question = await this.repository.findQuestionById(questionId);

      if (!answer || !question) {
        this.logger.warn(`Answer or question not found: ${answerId}, ${questionId}`);
        return;
      }

      // Get session to determine user plan
      const session = await this.repository.findSessionById(answer.sessionId.toString());
      if (!session) {
        return;
      }

      // Get user for plan-based model selection and language preference
      // PRIORITY: user.preferences.language > user.language > 'en'
      const user = await this.usersService.findById(session.userId.toString());
      const model = this.getModelByPlan(user.subscription?.plan);
      const language = user.preferences?.language || user.language || 'en';

      const feedback = await this.analyzeAnswer(
        question.question,
        answer.content,
        question.expectedKeyPoints,
        question.category,
        model,
        language,
      );

      // Update answer with feedback
      await this.repository.updateAnswer(answerId, {
        feedback,
        score: feedback.score,
        analyzed: true,
        aiModel: model,
      });

      // Update question statistics for analytics
      await this.updateQuestionStatistics(questionId, feedback.score);

      this.logger.log(`Feedback generated for answer ${answerId}`);
    } catch (error) {
      this.logger.error(`Failed to generate answer feedback: ${error.message}`, error.stack);
    }
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

      // Get all answers for this question to calculate average score
      const answers = await this.repository.findAnswersByQuestionId(questionId);
      const scores = answers
        .filter((a) => a.score !== undefined && a.score !== null)
        .map((a) => a.score!);

      const timesAsked = answers.length;
      const averageScore =
        scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : undefined;

      // Update question statistics
      await this.repository.updateQuestion(questionId, {
        timesAsked,
        averageScore: averageScore ? Math.round(averageScore * 10) / 10 : undefined,
      });

      this.logger.debug(
        `Updated question ${questionId} statistics: timesAsked=${timesAsked}, averageScore=${averageScore}`,
      );
    } catch (error) {
      // Don't fail the feedback generation if statistics update fails
      this.logger.warn(`Failed to update question statistics for ${questionId}: ${error.message}`);
    }
  }

  /**
   * Generate overall session feedback
   */
  async generateSessionFeedback(sessionId: string): Promise<void> {
    try {
      const session = await this.repository.findSessionById(sessionId);
      if (!session) {
        return;
      }

      const answers = await this.repository.findAnswersBySessionId(sessionId);

      if (answers.length === 0) {
        this.logger.warn(`No answers found for session ${sessionId}`);
        return;
      }

      // Calculate overall metrics
      const scores = answers.map((a) => a.score || 0);
      const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      // Get user for plan-based model selection and language preference
      // PRIORITY: user.preferences.language > user.language > 'en'
      const user = await this.usersService.findById(session.userId.toString());
      const model = this.getModelByPlan(user.subscription?.plan);
      const language = user.preferences?.language || user.language || 'en';

      // Generate comprehensive feedback
      const feedback = await this.analyzeSession(session, answers, model, language);

      // Update session with feedback
      await this.repository.updateSession(sessionId, {
        feedback,
        overallScore: Math.round(overallScore * 10) / 10,
      });

      this.logger.log(`Session feedback generated for ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to generate session feedback: ${error.message}`, error.stack);
    }
  }

  /**
   * Analyze single answer
   * Professional Senior Prompt Engineer Logic: Comprehensive feedback with CV context, scoring rubric, personalized recommendations
   */
  private async analyzeAnswer(
    question: string,
    answer: string,
    expectedKeyPoints: string[],
    category: string,
    model: string,
    language: string = 'en',
  ): Promise<any> {
    const languageName = this.getLanguageName(language);
    let prompt = `You are an expert interview coach with 10+ years of experience evaluating candidates. Analyze the following interview answer comprehensively and provide detailed, constructive feedback.\n\n`;

    // CRITICAL: Language instruction must be at the beginning
    prompt += `## LANGUAGE REQUIREMENT\n`;
    prompt += `IMPORTANT: You MUST respond in ${languageName} (${language.toUpperCase()}). All your output, including strengths, improvements, suggestions, example answer, and all text fields, must be in ${languageName}.\n\n`;

    prompt += `## INTERVIEW QUESTION\n`;
    prompt += `${question}\n\n`;

    prompt += `## QUESTION CATEGORY\n`;
    prompt += `${category}\n\n`;

    prompt += `## EXPECTED KEY POINTS\n`;
    prompt += `The answer should cover these key points: ${expectedKeyPoints.join(', ')}\n\n`;

    prompt += `## CANDIDATE'S ANSWER\n`;
    prompt += `${answer}\n\n`;

    prompt += `## EVALUATION CRITERIA\n\n`;

    prompt += `### 1. Content Quality (40%)\n`;
    prompt += `- **Accuracy:** Is the information correct and relevant?\n`;
    prompt += `- **Completeness:** Does the answer address all aspects of the question?\n`;
    prompt += `- **Key Points Coverage:** How many expected key points are covered?\n`;
    prompt += `- **Depth:** Is the answer detailed enough or too superficial?\n\n`;

    prompt += `### 2. Communication Skills (25%)\n`;
    prompt += `- **Clarity:** Is the answer clear and easy to understand?\n`;
    prompt += `- **Structure:** Is the answer well-organized with logical flow?\n`;
    prompt += `- **Conciseness:** Is the answer appropriately concise or too verbose?\n`;
    prompt += `- **Professional Language:** Is the language professional and appropriate?\n\n`;

    prompt += `### 3. Technical/Behavioral Accuracy (20%)\n`;
    prompt += `- **Technical Correctness:** For technical questions, is the information accurate?\n`;
    prompt += `- **STAR Method:** For behavioral questions, does it follow STAR (Situation, Task, Action, Result)?\n`;
    prompt += `- **Examples:** Are real examples provided from experience?\n`;
    prompt += `- **Metrics:** Are achievements quantified with specific numbers/results?\n\n`;

    prompt += `### 4. Engagement & Confidence (15%)\n`;
    prompt += `- **Confidence:** Does the answer demonstrate confidence?\n`;
    prompt += `- **Enthusiasm:** Is there appropriate enthusiasm and engagement?\n`;
    prompt += `- **Authenticity:** Does the answer feel genuine and authentic?\n\n`;

    prompt += `## SCORING RUBRIC\n`;
    prompt += `Score the answer on a scale of 0-10:\n`;
    prompt += `- **9-10 (Excellent):** Comprehensive, accurate, well-structured, covers all key points, demonstrates expertise\n`;
    prompt += `- **7-8 (Good):** Solid answer, covers most key points, minor gaps or areas for improvement\n`;
    prompt += `- **5-6 (Average):** Adequate answer, covers some key points, needs significant improvement\n`;
    prompt += `- **3-4 (Below Average):** Weak answer, misses key points, lacks depth or accuracy\n`;
    prompt += `- **0-2 (Poor):** Very weak answer, incorrect or irrelevant, major gaps\n\n`;

    prompt += `## OUTPUT FORMAT\n`;
    prompt += `Provide your comprehensive feedback in the following JSON format (strictly valid JSON):\n`;
    prompt += `{\n`;
    prompt += `  "score": <number 0-10, based on scoring rubric above>,\n`;
    prompt += `  "strengths": [<array of 3-5 specific strengths, e.g., "Clear structure with logical flow", "Covers all key technical points">],\n`;
    prompt += `  "improvements": [<array of 3-5 specific areas for improvement, e.g., "Add more specific examples", "Quantify achievements with metrics">],\n`;
    prompt += `  "keyPointsCovered": [<array of expected key points that were mentioned in the answer>],\n`;
    prompt += `  "keyPointsMissed": [<array of expected key points that were not mentioned>],\n`;
    prompt += `  "suggestions": [<array of 3-5 actionable, specific suggestions for improvement>],\n`;
    prompt += `  "exampleAnswer": "<optional improved version of the answer demonstrating best practices>"\n`;
    prompt += `}\n\n`;

    prompt += `## FINAL INSTRUCTIONS\n`;
    prompt += `1. **CRITICAL:** Generate ALL content in ${languageName} (${language.toUpperCase()}) - strengths, improvements, suggestions, example answer, all text fields\n`;
    prompt += `2. Be constructive and specific in your feedback\n`;
    prompt += `3. Provide actionable suggestions for improvement\n`;
    prompt += `4. Highlight both strengths and areas for improvement\n`;
    prompt += `5. Ensure the score is justified by the evaluation criteria\n`;
    prompt += `6. If providing an example answer, make it realistic and achievable\n`;
    prompt += `7. **REMEMBER:** All JSON output fields must be in ${languageName}\n`;

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert interview coach providing constructive feedback on interview answers.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS_FEEDBACK,
      temperature: OPENAI_TEMPERATURE,
      response_format: { type: 'json_object' },
    });

    const feedbackText = completion.choices[0].message.content || '{}';
    return JSON.parse(feedbackText);
  }

  /**
   * Analyze overall session
   * Professional Senior Prompt Engineer Logic: Comprehensive session analysis with trends, personalized recommendations
   */
  private async analyzeSession(
    session: any,
    answers: any[],
    model: string,
    language: string = 'en',
  ): Promise<any> {
    const answersSummary = answers
      .map((a, i) => {
        const question = a.questionId?.question || 'Question';
        const answerPreview =
          a.content.length > 300 ? `${a.content.substring(0, 300)}...` : a.content;
        const score = a.score !== undefined && a.score !== null ? a.score.toFixed(1) : 'N/A';
        const feedback = a.feedback?.improvements?.slice(0, 2).join(', ') || 'No feedback yet';
        return `**Question ${i + 1}:** ${question}\n**Answer:** ${answerPreview}\n**Score:** ${score}/10\n**Feedback:** ${feedback}`;
      })
      .join('\n\n---\n\n');

    const averageScore = answers.reduce((sum, a) => sum + (a.score || 0), 0) / answers.length;
    const scoreDistribution = {
      excellent: answers.filter((a) => (a.score || 0) >= 8).length,
      good: answers.filter((a) => (a.score || 0) >= 6 && (a.score || 0) < 8).length,
      average: answers.filter((a) => (a.score || 0) >= 4 && (a.score || 0) < 6).length,
      belowAverage: answers.filter((a) => (a.score || 0) < 4).length,
    };

    const languageName = this.getLanguageName(language);
    let prompt = `You are an expert interview coach providing comprehensive analysis of a mock interview session. Analyze the overall performance, identify patterns, and provide personalized recommendations.\n\n`;

    // CRITICAL: Language instruction must be at the beginning
    prompt += `## LANGUAGE REQUIREMENT\n`;
    prompt += `IMPORTANT: You MUST respond in ${languageName} (${language.toUpperCase()}). All your output, including strengths, weaknesses, recommendations, next steps, and all text fields, must be in ${languageName}.\n\n`;

    prompt += `## SESSION OVERVIEW\n`;
    prompt += `- **Interview Type:** ${session.type}\n`;
    prompt += `- **Difficulty Level:** ${session.difficulty}\n`;
    prompt += `- **Domain:** ${session.domain || 'N/A'}\n`;
    prompt += `- **Technology:** ${session.technology || 'N/A'}\n`;
    prompt += `- **Total Questions:** ${session.numQuestions || answers.length}\n`;
    prompt += `- **Average Score:** ${averageScore.toFixed(1)}/10\n\n`;

    prompt += `## SCORE DISTRIBUTION\n`;
    prompt += `- **Excellent (8-10):** ${scoreDistribution.excellent} answers\n`;
    prompt += `- **Good (6-7.9):** ${scoreDistribution.good} answers\n`;
    prompt += `- **Average (4-5.9):** ${scoreDistribution.average} answers\n`;
    prompt += `- **Below Average (<4):** ${scoreDistribution.belowAverage} answers\n\n`;

    prompt += `## DETAILED ANSWERS ANALYSIS\n`;
    prompt += `${answersSummary}\n\n`;

    prompt += `## EVALUATION CRITERIA\n\n`;

    prompt += `### 1. Technical Accuracy (25%)\n`;
    prompt += `- Correctness of technical information\n`;
    prompt += `- Understanding of concepts\n`;
    prompt += `- Problem-solving approach\n`;
    prompt += `- Use of best practices\n\n`;

    prompt += `### 2. Communication Skills (25%)\n`;
    prompt += `- Clarity and articulation\n`;
    prompt += `- Structure and organization\n`;
    prompt += `- Conciseness\n`;
    prompt += `- Professional language\n\n`;

    prompt += `### 3. Structured Thinking (20%)\n`;
    prompt += `- Logical flow of answers\n`;
    prompt += `- Ability to break down complex problems\n`;
    prompt += `- Systematic approach\n`;
    prompt += `- STAR method usage (for behavioral questions)\n\n`;

    prompt += `### 4. Confidence & Engagement (15%)\n`;
    prompt += `- Confidence level\n`;
    prompt += `- Enthusiasm\n`;
    prompt += `- Authenticity\n`;
    prompt += `- Professional presence\n\n`;

    prompt += `### 5. Problem-Solving Ability (15%)\n`;
    prompt += `- Analytical thinking\n`;
    prompt += `- Creative solutions\n`;
    prompt += `- Handling edge cases\n`;
    prompt += `- Real-world application\n\n`;

    prompt += `## PATTERN ANALYSIS\n`;
    prompt += `Identify patterns across all answers:\n`;
    prompt += `- **Consistent Strengths:** What does the candidate consistently do well?\n`;
    prompt += `- **Repeated Weaknesses:** What areas need improvement across multiple answers?\n`;
    prompt += `- **Score Trends:** Are scores improving, declining, or stable throughout the session?\n`;
    prompt += `- **Category Performance:** How does the candidate perform in different question categories?\n\n`;

    prompt += `## OUTPUT FORMAT\n`;
    prompt += `Provide your comprehensive analysis in the following JSON format (strictly valid JSON):\n`;
    prompt += `{\n`;
    prompt += `  "overallScore": <number 0-100, calculated as weighted average of all criteria>,\n`;
    prompt += `  "ratings": {\n`;
    prompt += `    "technicalAccuracy": <number 0-10, based on technical correctness across all answers>,\n`;
    prompt += `    "communication": <number 0-10, based on clarity and structure across all answers>,\n`;
    prompt += `    "structuredThinking": <number 0-10, based on logical flow and organization>,\n`;
    prompt += `    "confidence": <number 0-10, based on confidence and engagement level>,\n`;
    prompt += `    "problemSolving": <number 0-10, based on analytical thinking and solutions>\n`;
    prompt += `  },\n`;
    prompt += `  "summary": {\n`;
    prompt += `    "strengths": [<array of 5-7 overall strengths identified across the session>],\n`;
    prompt += `    "weaknesses": [<array of 5-7 areas for improvement identified across the session>],\n`;
    prompt += `    "topConcerns": [<array of 3-5 critical issues that need immediate attention>],\n`;
    prompt += `    "improvementTrends": "<description of whether performance improved, declined, or remained stable>",\n`;
    prompt += `    "bestCategory": "<category where candidate performed best>",\n`;
    prompt += `    "weakestCategory": "<category where candidate needs most improvement>"\n`;
    prompt += `  },\n`;
    prompt += `  "recommendations": [<array of 5-7 specific, actionable recommendations for improvement>],\n`;
    prompt += `  "nextSteps": [<array of 3-5 concrete next steps the candidate should take>]\n`;
    prompt += `}\n\n`;

    prompt += `## FINAL INSTRUCTIONS\n`;
    prompt += `1. **CRITICAL:** Generate ALL content in ${languageName} (${language.toUpperCase()}) - strengths, weaknesses, recommendations, next steps, all text fields\n`;
    prompt += `2. Provide a comprehensive, holistic analysis of the entire session\n`;
    prompt += `3. Identify patterns and trends across all answers\n`;
    prompt += `4. Be specific and actionable in recommendations\n`;
    prompt += `5. Balance strengths and areas for improvement\n`;
    prompt += `6. Provide realistic, achievable next steps\n`;
    prompt += `7. **REMEMBER:** All JSON output fields must be in ${languageName}\n`;

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert interview coach providing comprehensive session analysis.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS_FEEDBACK,
      temperature: OPENAI_TEMPERATURE,
      response_format: { type: 'json_object' },
    });

    const feedbackText = completion.choices[0].message.content || '{}';
    return JSON.parse(feedbackText);
  }

  /**
   * Get AI model based on subscription plan
   */
  private getModelByPlan(plan?: string): string {
    if (plan === 'elite' || plan === 'pro' || plan === 'enterprise') {
      return AI_MODELS.GPT4;
    }
    return AI_MODELS.GPT35;
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
}
