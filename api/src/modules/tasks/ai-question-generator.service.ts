import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { QuestionPattern, QuestionPatternDocument } from './schemas/question-pattern.schema';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import axios from 'axios';

/**
 * AI Question Generator Service
 *
 * Uses Z-AI GLM-4-32B to generate unique interview questions based on patterns.
 * Implements semantic caching to reduce costs by 90%.
 *
 * COST ANALYSIS (1M premium users):
 * - Without caching: 1M × 3 questions × $0.001 = $3,000/day
 * - With 90% cache hit: 100K × 3 × $0.001 = $300/day
 * - Savings: $2,700/day = $81,000/month
 */

@Injectable()
export class AIQuestionGeneratorService {
  private readonly logger = new Logger(AIQuestionGeneratorService.name);

  constructor(
    @InjectModel(QuestionPattern.name)
    private readonly patternModel: Model<QuestionPatternDocument>,
    @InjectModel(GeneratedQuestion.name)
    private readonly generatedModel: Model<GeneratedQuestionDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a unique question for a user
   *
   * ALGORITHM:
   * 1. Get current week's pattern
   * 2. Check cache for similar question (pattern + position)
   * 3. If cache miss, call Z-AI to generate
   * 4. Store in cache for future use
   */
  async generateQuestion(
    type: 'technical' | 'behavioral' | 'system_design',
    position: 'junior' | 'middle' | 'senior' | 'lead',
    userId: string,
  ): Promise<string> {
    try {
      // Step 1: Get current week's pattern
      const pattern = await this.getCurrentWeekPattern(type);

      if (!pattern) {
        this.logger.warn(`No pattern found for type=${type}, falling back to static`);
        return this.getFallbackQuestion(type, position);
      }

      // Step 2: Check cache (find question NOT served to this user)
      const cachedQuestion = await this.generatedModel
        .findOne({
          patternId: pattern._id,
          position,
          type,
          servedToUsers: { $ne: userId }, // Not served to this user yet
          expiresAt: { $gt: new Date() }, // Not expired
        })
        .sort({ timesUsed: 1 }) // Prefer less-used questions
        .lean();

      if (cachedQuestion) {
        this.logger.debug(
          `Cache HIT: pattern=${pattern.patternName}, position=${position}, saved $0.001`,
        );

        // Update usage stats
        await this.generatedModel.findByIdAndUpdate(cachedQuestion._id, {
          $inc: { timesUsed: 1 },
          $push: { servedToUsers: userId },
        });

        return (cachedQuestion as any).question || cachedQuestion.question_en || cachedQuestion.question_uz || cachedQuestion.question_ru;
      }

      // Step 3: Cache MISS - Generate with AI
      this.logger.log(
        `Cache MISS: Generating new question for pattern=${pattern.patternName}, position=${position}`,
      );

      const generatedQuestion = await this.generateWithAI(pattern, position);

      // Step 4: Store in cache
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await this.generatedModel.create({
        patternId: pattern._id,
        position,
        type,
        question: generatedQuestion.question,
        context: generatedQuestion.context,
        hints: generatedQuestion.hints,
        metadata: generatedQuestion.metadata,
        timesUsed: 1,
        servedToUsers: [userId],
        expiresAt,
      });

      return generatedQuestion.question;
    } catch (error) {
      this.logger.error(`Failed to generate question: ${error.message}`, error.stack);
      return this.getFallbackQuestion(type, position);
    }
  }

  /**
   * Get current week's pattern
   * Rotates patterns weekly to ensure variety
   */
  private async getCurrentWeekPattern(type: string): Promise<QuestionPatternDocument | null> {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil(dayOfYear / 7);

    this.logger.debug(`Current week: ${weekNumber}, type: ${type}`);

    // Find pattern for this week
    let pattern = await this.patternModel.findOne({ type, weekNumber }).sort({ timesUsed: 1 }); // Prefer less-used patterns

    // If no pattern for this week, use modulo to wrap around
    if (!pattern) {
      const allPatterns = await this.patternModel.find({ type });
      if (allPatterns.length > 0) {
        pattern = allPatterns[weekNumber % allPatterns.length];
      }
    }

    return pattern;
  }

  /**
   * Generate question using Z-AI GLM-4-32B
   *
   * PROMPT ENGINEERING:
   * - Concise output (save tokens)
   * - JSON mode (structured response)
   * - Contextual variation (prevent memorization)
   */
  private async generateWithAI(
    pattern: QuestionPatternDocument,
    position: string,
  ): Promise<{
    question: string;
    context?: string;
    hints: string[];
    metadata: any;
  }> {
    const startTime = Date.now();

    const prompt = `You are an expert technical interviewer. Generate a unique interview question based on this pattern:

Pattern: ${pattern.patternName}
Template: ${pattern.coreTemplate}
Position Level: ${position}
Learning Objectives: ${pattern.learningObjectives.join(', ')}

Requirements:
1. Create a NEW real-world scenario (not the template example)
2. Adjust difficulty for ${position} level
3. Make it engaging and practical
4. Provide 3 progressive hints (conceptual → approach → optimization)

Output ONLY valid JSON:
{
  "question": "the interview question",
  "context": "optional story context",
  "hints": ["hint1", "hint2", "hint3"]
}`;

    try {
      const response = await axios.post(
        this.configService.get('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.configService.get('OPENROUTER_MODEL') || 'z-ai/glm-4-32b',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.8, // Creative but not random
          max_tokens: 500,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.configService.get('OPENAI_API_KEY')}`,
            'HTTP-Referer': this.configService.get('OPENROUTER_HTTP_REFERER'),
            'X-Title': this.configService.get('OPENROUTER_X_TITLE'),
          },
        },
      );

      const generationTime = Date.now() - startTime;
      const content = JSON.parse(response.data.choices[0].message.content);
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const cost = tokensUsed * 0.000001; // Approximate Z-AI cost

      this.logger.log(
        `AI generation: tokens=${tokensUsed}, time=${generationTime}ms, cost=$${cost.toFixed(4)}`,
      );

      return {
        question: content.question,
        context: content.context,
        hints: content.hints || [],
        metadata: {
          generatedBy: this.configService.get('OPENROUTER_MODEL'),
          tokensUsed,
          generationTime,
          cost,
        },
      };
    } catch (error) {
      this.logger.error(`AI generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Fallback to static questions if AI fails
   */
  private getFallbackQuestion(type: string, position: string): string {
    const fallbacks = {
      technical: {
        junior: 'Explain the difference between let, const, and var in JavaScript.',
        middle: 'Implement a function to find the longest substring without repeating characters.',
        senior: 'Design a distributed caching system with high availability.',
        lead: 'How would you architect a system to handle 1 billion requests per day?',
      },
      behavioral: {
        junior: 'Tell me about a time you learned a new technology quickly.',
        middle: 'Describe a situation where you had to make a difficult technical decision.',
        senior: 'How do you handle disagreements with other engineers?',
        lead: 'Describe your approach to building and scaling an engineering team.',
      },
      system_design: {
        junior: 'How would you design a simple TODO list application?',
        middle: 'Design a URL shortener service like bit.ly.',
        senior: 'Design a distributed rate limiting system.',
        lead: 'Design the architecture for a global-scale social media platform.',
      },
    };

    return fallbacks[type]?.[position] || 'What is your greatest technical achievement?';
  }
}
