import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { OPENROUTER_MODELS } from '../../common/utils/openai-client.factory';
import { buildMultilingualQuestionGenerationPrompt } from '@common/constants/ai-prompts.constant';

/**
 * 🛡️ SAFE QUESTION PROVIDER SERVICE (MULTILINGUAL VERSION)
 * 
 * 3-LEVEL DEFENSE SYSTEM:
 * Level 1: Pool (fast, free, reliable) ⚡
 * Level 2: AI Generation (retry + timeout) 🤖
 * Level 3: Static Fallback (always works) 🛡️
 * 
 * Returns questions in ALL 3 languages:
 * - title_uz, title_ru, title_en
 * - question_uz, question_ru, question_en
 * 
 * Caller selects appropriate language at delivery time
 */
@Injectable()
export class SafeQuestionProviderService {
  private readonly logger = new Logger(SafeQuestionProviderService.name);
  private readonly openai: OpenAI | null;

  // Safety configurations
  private readonly MAX_RETRIES = 3;
  private readonly TIMEOUT_MS = 15000; // 15 seconds
  private readonly RETRY_DELAY_MS = 2000; // 2 seconds between retries

  constructor(
    @InjectModel(GeneratedQuestion.name)
    private readonly questionModel: Model<GeneratedQuestionDocument>,
    private readonly configService: ConfigService,
  ) {
    // Initialize OpenAI client
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim() && !apiKey.includes('your-')) {
      this.openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
          'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || 'https://getjobi.app',
          'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || 'Jobi',
        },
        timeout: this.TIMEOUT_MS,
      });
      this.logger.log('✅ AI client initialized with timeout protection');
    } else {
      this.logger.warn('⚠️  AI client not available - will use pool + fallback only');
    }
  }

  /**
   * 🎯 MAIN METHOD: Get question with 3-level safety
   * 
   * Returns question with ALL 3 languages - caller decides which to use
   * 
   * @param seenQuestionIds - Questions user has already seen (for sequential learning)
   * @param allowAI - Whether to allow AI generation (false for free users to save costs)
   * @param techStack - User's specific technologies (e.g., ['Node.js', 'Express', 'MongoDB'])
   * @returns Question object with all 3 languages
   */
  async getQuestionSafely(
    position: 'junior' | 'middle' | 'senior' | 'lead',
    type: 'technical' | 'behavioral' | 'system_design',
    domain: string,
    seenQuestionIds: any[] = [],
    allowAI: boolean = true,
    techStack: string[] = [],
  ): Promise<{
    title_uz?: string;
    title_ru?: string;
    title_en?: string;
    question_uz?: string;
    question_ru?: string;
    question_en?: string;
    questionId: any;
    source: 'pool' | 'ai' | 'fallback';
  }> {
    this.logger.debug(
      `Getting question: ${position}/${type}/${domain}/${techStack.join(',')} (${seenQuestionIds.length} seen, AI=${allowAI})`,
    );

    // ═══════════════════════════════════════════════════════
    // LEVEL 1: Try Pool First (Fast & Free)
    // ═══════════════════════════════════════════════════════
    try {
      const poolQuestion = await this.getFromPool(position, type, domain, techStack, seenQuestionIds);
      if (poolQuestion) {
        this.logger.debug(`✅ Found in pool: ${poolQuestion._id}`);

        // Increment usage counter (fire-and-forget)
        this.incrementUsageCount(poolQuestion._id).catch(() => {});

        return {
          title_uz: poolQuestion.title_uz,
          title_ru: poolQuestion.title_ru,
          title_en: poolQuestion.title_en,
          question_uz: poolQuestion.question_uz,
          question_ru: poolQuestion.question_ru,
          question_en: poolQuestion.question_en,
          questionId: poolQuestion._id,
          source: 'pool',
        };
      }
    } catch (error: any) {
      this.logger.warn(`Pool query failed: ${error.message}`);
    }

    // ═══════════════════════════════════════════════════════
    // LEVEL 2: AI Generation (With Retry + Timeout)
    // ═══════════════════════════════════════════════════════
    if (allowAI && this.openai) {
      this.logger.log(`⚠️  Pool empty for ${position}/${type}/${domain} - trying AI generation`);

      try {
        const aiResult = await this.generateWithAISafely(position, type, domain, techStack);
        if (aiResult) {
          this.logger.log(`✅ AI generated successfully: ${aiResult.questionId}`);
          return {
            title_uz: aiResult.title_uz,
            title_ru: aiResult.title_ru,
            title_en: aiResult.title_en,
            question_uz: aiResult.question_uz,
            question_ru: aiResult.question_ru,
            question_en: aiResult.question_en,
            questionId: aiResult.questionId,
            source: 'ai',
          };
        }
      } catch (error: any) {
        this.logger.error(`AI generation failed: ${error.message}`);
      }
    } else {
      this.logger.log(`💰 AI generation DISABLED - using fallback`);
    }

    // ═══════════════════════════════════════════════════════
    // LEVEL 3: Static Fallback (Always Works)
    // ═══════════════════════════════════════════════════════
    this.logger.warn(`⚠️  Using fallback for ${position}/${type}/${domain}`);
    const fallbacks = this.getStaticFallback(position, type, domain);

    return {
      title_uz: fallbacks.title_uz,
      title_ru: fallbacks.title_ru,
      title_en: fallbacks.title_en,
      question_uz: fallbacks.question_uz,
      question_ru: fallbacks.question_ru,
      question_en: fallbacks.question_en,
      questionId: null,
      source: 'fallback',
    };
  }

  /**
   * 📦 LEVEL 1: Get from Pool (excluding seen questions, with techStack matching)
   */
  // Maximum number of seen IDs to include in the $nin filter.
  // seenQuestionIds grows unboundedly over time. A $nin with 1000+ ObjectIds
  // forces MongoDB to scan every document in the index for exclusion, making
  // the query O(n * seenIds). Cap at the most-recent 200 to keep queries fast
  // while still providing meaningful deduplication within a rolling window.
  private readonly MAX_SEEN_IDS_FOR_QUERY = 200;

  private async getFromPool(
    position: string,
    type: string,
    domain: string,
    techStack: string[],
    seenQuestionIds: any[] = [],
  ): Promise<any> {
    const query: any = { position, type };

    // Use only the most-recent seen IDs to cap $nin list size
    if (seenQuestionIds.length > 0) {
      const recentSeenIds = seenQuestionIds.slice(-this.MAX_SEEN_IDS_FOR_QUERY);
      query._id = { $nin: recentSeenIds };
    }

    // Match by techStack or domain
    if (techStack.length > 0) {
      query.$or = [{ techStacks: { $in: techStack } }, { domain: domain }];
    } else {
      query.domain = domain;
    }

    // Get oldest question first (FIFO)
    return await this.questionModel.findOne(query).sort({ createdAt: 1 }).lean().exec();
  }

  /**
   * 🤖 LEVEL 2: Generate with AI (with retry + timeout)
   */
  private async generateWithAISafely(
    position: string,
    type: string,
    domain: string,
    techStack: string[],
  ): Promise<{
    title_uz: string;
    title_ru: string;
    title_en: string;
    question_uz: string;
    question_ru: string;
    question_en: string;
    questionId: any;
  } | null> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await Promise.race([
          this.generateQuestion(position, type, domain, techStack),
          this.timeoutPromise(),
        ]);

        if (result) {
          // Save to pool (fire-and-forget)
          this.saveToPool(result, position, type, domain, techStack).catch(() => {});
          return result;
        }
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt < this.MAX_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS * attempt);
        }
      }
    }

    this.logger.error(`All ${this.MAX_RETRIES} attempts failed`);
    return null;
  }

  /**
   * 🔧 Generate single question with AI in 3 languages
   */
  private async generateQuestion(
    position: string,
    type: string,
    domain: string,
    techStack: string[],
  ): Promise<{
    title_uz: string;
    title_ru: string;
    title_en: string;
    question_uz: string;
    question_ru: string;
    question_en: string;
    questionId: any;
  }> {
    if (!this.openai) {
      throw new Error('AI client not initialized');
    }

    const techStackStr = techStack.length > 0 ? techStack.join(', ') : domain;

    const prompt = buildMultilingualQuestionGenerationPrompt({
      type,
      position,
      techStackStr,
    });

    const completion = await this.openai.chat.completions.create({
      model: OPENROUTER_MODELS['glm-4-32b'],
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = completion.choices[0].message.content?.trim();
    if (!content) {
      throw new Error('Empty response from AI');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON in response');
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      title_uz: result.title_uz,
      title_ru: result.title_ru,
      title_en: result.title_en,
      question_uz: result.question_uz,
      question_ru: result.question_ru,
      question_en: result.question_en,
      questionId: null,
    };
  }

  /**
   * 💾 Save generated question to pool
   */
  private async saveToPool(
    result: {
      title_uz: string;
      title_ru: string;
      title_en: string;
      question_uz: string;
      question_ru: string;
      question_en: string;
      questionId: any;
    },
    position: string,
    type: string,
    domain: string,
    techStack: string[],
  ): Promise<void> {
    try {
      const doc = await this.questionModel.create({
        position,
        type,
        domain,
        techStacks: techStack.length > 0 ? techStack : [domain],
        title_uz: result.title_uz,
        title_ru: result.title_ru,
        title_en: result.title_en,
        question_uz: result.question_uz,
        question_ru: result.question_ru,
        question_en: result.question_en,
        metadata: {
          generatedBy: 'z-ai/glm-4-32b',
          tokensUsed: 0,
          generationTime: 0,
          cost: 0.00003, // 3x for 3 languages
        },
        timesUsed: 1,
      });

      result.questionId = doc._id;
      this.logger.debug(`Saved to pool: ${doc._id}`);
    } catch (error: any) {
      this.logger.warn(`Failed to save to pool: ${error.message}`);
    }
  }

  /**
   * 📊 Increment usage counter
   */
  private async incrementUsageCount(questionId: any): Promise<void> {
    await this.questionModel.updateOne({ _id: questionId }, { $inc: { timesUsed: 1 } });
  }

  /**
   * 🛡️ LEVEL 3: Static Fallback Questions (3 languages)
   */
  private getStaticFallback(
    position: string,
    type: string,
    domain: string,
  ): {
    title_uz: string;
    title_ru: string;
    title_en: string;
    question_uz: string;
    question_ru: string;
    question_en: string;
  } {
    const defaultFallback = {
      title_uz: "JavaScript o'zgaruvchilari",
      title_ru: 'Переменные JavaScript',
      title_en: 'JavaScript Variables',
      question_uz:
        "JavaScript'da `let`, `const` va `var` o'rtasidagi farqni tushuntiring. Har birini qachon ishlatgan ma'qul?",
      question_ru:
        'Объясните разницу между `let`, `const` и `var` в JavaScript. Когда следует использовать каждый из них?',
      question_en:
        'Explain the difference between `let`, `const`, and `var` in JavaScript. When would you use each one?',
    };

    const fallbacksByType = {
      technical: defaultFallback,
      behavioral: {
        title_uz: "Tez o'rganish",
        title_ru: 'Быстрое обучение',
        title_en: 'Quick Learning',
        question_uz:
          'Yangi texnologiyani tez o\'rganishingiz kerak bo\'lgan vaqt haqida gapiring. Qanday yondashuvda oldingiz?',
        question_ru:
          'Расскажите о времени, когда вам нужно было быстро освоить новую технологию. Как вы подошли к этому?',
        question_en:
          'Tell me about a time when you had to learn a new technology quickly. How did you approach it?',
      },
      system_design: {
        title_uz: 'URL qisqartiruvchi',
        title_ru: 'Сокращатель URL',
        title_en: 'URL Shortener',
        question_uz: 'Oddiy URL qisqartiruvchi xizmatini loyihalang. Asosiy komponentlar qanday?',
        question_ru: 'Спроектируйте простой сервис для сокращения URL. Какие основные компоненты?',
        question_en: 'Design a simple URL shortener service. What are the main components?',
      },
    };

    return fallbacksByType[type] || defaultFallback;
  }

  /**
   * ⏱️ Timeout promise
   */
  private timeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`AI request timeout after ${this.TIMEOUT_MS}ms`));
      }, this.TIMEOUT_MS);
    });
  }

  /**
   * ⏳ Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
