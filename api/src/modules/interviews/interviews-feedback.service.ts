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
   * Generate feedback for answer
   */
  // Individual answer feedback is disabled in favor of batch processing
  // async generateAnswerFeedback(answerId: string, questionId: string): Promise<void> { ... }

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
   * Generate overall session feedback (Batch Processing)
   * Analyzes all answers in one go to save tokens and optimize performance
   */
  /**
   * Generate overall session feedback (Optimized Batch Processing)
   * 1. Analyzes answers in chunks (parallel) to get scores and specific feedback
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
      const BATCH_SIZE = 5; // Process 5 answers at a time to be safe with tokens

      // 1. CHUNK PROCESSING (Get Scores & Feedback)
      this.logger.log(`Starting batch analysis for session ${sessionId} with ${answers.length} answers`);
      
      const chunks: any[][] = [];
      for (let i = 0; i < answers.length; i += BATCH_SIZE) {
        chunks.push(answers.slice(i, i + BATCH_SIZE));
      }

      const chunkResults = await Promise.all(
        chunks.map(chunk => this.analyzeAnswersBatch(chunk, session, model, language))
      );

      // Flatten results
      const allAnalysis = chunkResults.flat();
      
      // Update answers in DB
      let totalScore = 0;
      let scoredCount = 0;
      
      const summaryForOverall: any[] = []; // Data for step 2

      for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        // Match analysis to answer (assuming strict order preservation in chunks and arrays)
        // To be safer, we could map by index, but Promise.all preserves order of chunks, 
        // and map preserves order within chunk. So allAnalysis[i] corresponds to answers[i].
        const analysis = allAnalysis[i];

        if (analysis) {
          const score = analysis.score || 0;
          totalScore += score;
          scoredCount++;

          // Construct valid feedback object
          const feedbackData = {
              score,
              strengths: analysis.strengths || [],
              improvements: analysis.improvements || [],
              suggestions: analysis.suggestions || [],
              keyPointsCovered: [],
              keyPointsMissed: [],
              exampleAnswer: analysis.feedback || '', // Map 'feedback' from AI to 'exampleAnswer' or just generic field
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
            question: answer.questionId?.['question'] || 'Question', // Handle populated field safely
            score,
            strengths: analysis.strengths?.slice(0, 2) || [],
            weaknesses: analysis.improvements?.slice(0, 2) || []
          });
        }
      }

      // 2. OVERALL SUMMARY GENERATION (Lightweight)
      const overallAnalysis = await this.generateOverallSummary(session, summaryForOverall, model, language);
      const overallScore = scoredCount > 0 ? totalScore / scoredCount : 0;

      await this.repository.updateSession(sessionId, {
        feedback: overallAnalysis,
        overallScore: Math.round(overallScore * 10) / 10,
      });

      this.logger.log(`Session feedback generated for ${sessionId} (Chuncked Batch mode)`);
    } catch (error) {
      this.logger.error(`Failed to generate session feedback: ${error.message}`, error.stack);
    }
  }

  /**
   * Step 1: Analyze a small batch of answers (Detailed)
   */
  private async analyzeAnswersBatch(
    answers: any[],
    session: any,
    model: string,
    language: string
  ): Promise<any[]> {
    const languageName = this.getLanguageName(language);
    
    const answersText = answers.map((a, i) => {
      const q = a.questionId?.question || 'Question';
      const ans = a.content;
      const dur = a.duration || 0;
      return `Q${i + 1}: ${q}\nA${i + 1}: ${ans}\n[Time Taken: ${dur} seconds]\n`;
    }).join('\n---\n');

    let prompt = `Analyze these ${answers.length} interview answers. Context: ${session.type}, Level: ${session.difficulty}.\n\n`;
    prompt += `QUESTIONS & ANSWERS:\n${answersText}\n\n`;
    prompt += `Respond in specific JSON format. LANGUAGE: ${languageName} (${language.toUpperCase()}).\n`;
    
    prompt += `ANALYSIS RULES:\n`;
    prompt += `1. **Time Analysis:** Consider 'Time Taken'. If a complex technical question is answered in <5 seconds, flag it as 'Too Fast'. If >120s, flag as 'Too Slow'.\n`;
    prompt += `2. **Authenticity Check (AI Detection):** Analyze if the answer sounds natural (human) or purely AI-generated (ChatGPT style). Look for: perfect grammar without pauses, generic lists, unnatural structure.\n`;
    prompt += `3. **Scoring:** Rate 0-10 based on technical accuracy AND communication.\n\n`;

    prompt += `OUTPUT FORMAT:\n`;
    prompt += `{\n`;
    prompt += `  "results": [\n`;
    prompt += `    {\n`;
    prompt += `      "score": number,\n`;
    prompt += `      "feedback": "string",\n`;
    prompt += `      "strengths": [],\n`;
    prompt += `      "improvements": [],\n`;
    prompt += `      "suggestions": [],\n`;
    prompt += `      "authenticityWarning": boolean, // true if looks like AI or cheated\n`;
    prompt += `      "pacingFeedback": "string" // e.g., "Good pace", "Too fast (suspicious)", "Long pauses"\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}`;

    try {
      if (!this.openai) throw new BadRequestException('AI not configured');
      
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      
      const content = JSON.parse(completion.choices[0].message.content || '{}');
      return content.results || Array(answers.length).fill({}); // Fallback to empty objects if parsing fails
    } catch (e) {
      this.logger.error(`Batch analysis failed: ${e.message}`);
      return Array(answers.length).fill({}); // Graceful degradation
    }
  }

  /**
   * Step 2: Generate overall summary from scores
   */
  private async generateOverallSummary(
    session: any,
    summaries: any[],
    model: string,
    language: string
  ): Promise<any> {
     // Reuse logic from analyzeSession but with summaries instead of full text
     // (Simplified implementation for brevity, follows previous analyzeSession logic)
     // ... logic to build prompt using summaries ...
     // For now, let's call the existing analyzeSession but passing lighter data if possible,
     // or just reimplement the prompt builder here efficiently.
     
     // Creating a highly optimized prompt using summaries
     const languageName = this.getLanguageName(language);
     const summaryText = summaries.map((s, i) => 
       `Q${i+1}: Score ${s.score}/10. Str: ${s.strengths.join(', ')}. Weak: ${s.weaknesses.join(', ')}`
     ).join('\n');

     let prompt = `Provide overall interview feedback based on these summaries:\n${summaryText}\n\n`;
     prompt += `Context: ${session.type}, ${session.difficulty}.\n`;
     prompt += `LANGUAGE: ${languageName}.\n`;
     prompt += `OUTPUT JSON: { "summary": { "strengths": [], "weaknesses": [], "topConcerns": [] }, "recommendations": [], "ratings": { "technicalAccuracy": 0, "communication": 0, "structuredThinking": 0 } }`;

     try {
       const completion = await this.openai!.chat.completions.create({
         model,
         messages: [{ role: 'user', content: prompt }],
         response_format: { type: 'json_object' },
       });
       return JSON.parse(completion.choices[0].message.content || '{}');
     } catch (e) {
       return {};
     }
  }



  /**
   * Get AI model based on subscription plan
   * Supports OpenRouter with automatic model mapping
   */
  private getModelByPlan(plan?: string): string {
    return getModelForPlan(this.configService, plan || 'free', AI_MODELS.GPT35, AI_MODELS.GPT4);
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
