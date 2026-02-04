import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { OPENROUTER_MODELS } from '../../common/utils/openai-client.factory';

/**
 * 🛡️ SAFE QUESTION PROVIDER SERVICE
 * 
 * 3-LEVEL DEFENSE SYSTEM:
 * Level 1: Pool (fast, free, reliable) ⚡
 * Level 2: AI Generation (retry + timeout) 🤖
 * Level 3: Static Fallback (always works) 🛡️
 * 
 * BENEFITS:
 * - 100% uptime guarantee
 * - Cost optimization (pool first, AI second)
 * - No token waste (smart retry logic)
 * - No money loss (timeout protection)
 * - Sequential learning (when pool available)
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
          'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || 'https://interviewai.pro',
          'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || 'InterviewAI Pro',
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
   * @returns Always returns a question (never fails!)
   */
  async getQuestionSafely(
    position: 'junior' | 'middle' | 'senior' | 'lead',
    type: 'technical' | 'behavioral' | 'system_design',
    domain: string,
  ): Promise<{ question: string; questionId: any; source: 'pool' | 'ai' | 'fallback' }> {
    this.logger.debug(`Getting question: ${position}/${type}/${domain}`);

    // ═══════════════════════════════════════════════════════
    // LEVEL 1: Try Pool First (Fast & Free)
    // ═══════════════════════════════════════════════════════
    try {
      const poolQuestion = await this.getFromPool(position, type, domain);
      if (poolQuestion) {
        this.logger.debug(`✅ Found in pool: ${poolQuestion._id}`);
        
        // Increment usage counter (fire-and-forget)
        this.incrementUsageCount(poolQuestion._id).catch(() => {});
        
        return {
          question: poolQuestion.question,
          questionId: poolQuestion._id,
          source: 'pool',
        };
      }
    } catch (error: any) {
      this.logger.warn(`Pool query failed: ${error.message}`);
      // Continue to next level (don't fail here)
    }

    this.logger.log(`⚠️  Pool empty for ${position}/${type}/${domain} - trying AI generation`);

    // ═══════════════════════════════════════════════════════
    // LEVEL 2: AI Generation (With Retry + Timeout)
    // ═══════════════════════════════════════════════════════
    if (this.openai) {
      try {
        const aiResult = await this.generateWithAISafely(position, type, domain);
        if (aiResult) {
          this.logger.log(`✅ AI generated successfully: ${aiResult.questionId}`);
          return {
            question: aiResult.question,
            questionId: aiResult.questionId,
            source: 'ai',
          };
        }
      } catch (error: any) {
        this.logger.error(`AI generation failed after retries: ${error.message}`);
        // Continue to fallback (don't fail here)
      }
    }

    // ═══════════════════════════════════════════════════════
    // LEVEL 3: Static Fallback (Always Works)
    // ═══════════════════════════════════════════════════════
    this.logger.warn(`⚠️  Using fallback for ${position}/${type}/${domain}`);
    const fallbackQuestion = this.getStaticFallback(position, type, domain);
    
    return {
      question: fallbackQuestion,
      questionId: null,
      source: 'fallback',
    };
  }

  /**
   * 📦 LEVEL 1: Get from Pool
   */
  private async getFromPool(
    position: string,
    type: string,
    domain: string,
  ): Promise<any> {
    return await this.questionModel
      .findOne({ position, type, domain })
      .sort({ createdAt: 1 }) // FIFO - oldest first
      .select('question _id')
      .lean()
      .exec();
  }

  /**
   * 🤖 LEVEL 2: AI Generation with Retry Logic
   */
  private async generateWithAISafely(
    position: string,
    type: string,
    domain: string,
  ): Promise<{ question: string; questionId: any } | null> {
    let lastError: Error | null = null;

    // Retry loop
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(`AI generation attempt ${attempt}/${this.MAX_RETRIES}`);

        // Generate with timeout
        const result = await Promise.race([
          this.generateQuestion(position, type, domain),
          this.timeoutPromise(),
        ]);

        if (result && result.question) {
          // Save to pool for future use (fire-and-forget)
          this.saveToPool(result, position, type, domain).catch(() => {});
          
          return result;
        }
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Attempt ${attempt} failed: ${error.message}`);

        // Wait before retry (except last attempt)
        if (attempt < this.MAX_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    this.logger.error(`All ${this.MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`);
    return null;
  }

  /**
   * 🔧 Generate single question with AI
   */
  private async generateQuestion(
    position: string,
    type: string,
    domain: string,
  ): Promise<{ question: string; questionId: any }> {
    if (!this.openai) {
      throw new Error('AI client not initialized');
    }

    const prompt = this.buildPrompt(position, type, domain);

    const completion = await this.openai.chat.completions.create({
      model: OPENROUTER_MODELS['gpt-4o-mini'],
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 150,
    });

    const questionText = completion.choices[0].message.content?.trim();
    
    if (!questionText) {
      throw new Error('Empty response from AI');
    }

    return {
      question: questionText,
      questionId: null, // Will be set after saving
    };
  }

  /**
   * 💾 Save generated question to pool
   */
  private async saveToPool(
    result: { question: string; questionId: any },
    position: string,
    type: string,
    domain: string,
  ): Promise<void> {
    try {
      const doc = await this.questionModel.create({
        position,
        type,
        domain,
        question: result.question,
        metadata: {
          generatedBy: 'gpt-4o-mini',
          tokensUsed: 0,
          generationTime: 0,
          cost: 0,
        },
        timesUsed: 1,
      });

      result.questionId = doc._id;
      this.logger.debug(`Saved to pool: ${doc._id}`);
    } catch (error: any) {
      this.logger.warn(`Failed to save to pool: ${error.message}`);
      // Don't throw - this is fire-and-forget
    }
  }

  /**
   * 📊 Increment usage counter
   */
  private async incrementUsageCount(questionId: any): Promise<void> {
    await this.questionModel.updateOne(
      { _id: questionId },
      { $inc: { timesUsed: 1 } },
    );
  }

  /**
   * 🛡️ LEVEL 3: Static Fallback Questions
   */
  private getStaticFallback(position: string, type: string, domain: string): string {
    const fallbacks: Record<string, Record<string, Record<string, string>>> = {
      junior: {
        technical: {
          frontend: 'Explain the difference between `let`, `const`, and `var` in JavaScript. When would you use each one?',
          backend: 'What is the difference between SQL and NoSQL databases? Give an example of when to use each.',
          mobile: 'Explain the activity lifecycle in Android or the view controller lifecycle in iOS.',
          general: 'What is version control and why is it important? Explain Git basics.',
        },
        behavioral: {
          general: 'Tell me about a time when you had to learn a new technology quickly. How did you approach it?',
        },
      },
      middle: {
        technical: {
          frontend: 'Explain React Hooks (useState, useEffect). How do they differ from class component lifecycle methods?',
          backend: 'What is the difference between authentication and authorization? How would you implement them?',
          mobile: 'Explain the differences between synchronous and asynchronous programming in mobile development.',
          fullstack: 'Describe the flow of data in a full-stack application from frontend to backend to database.',
          general: 'What are design patterns? Explain Singleton, Factory, and Observer patterns.',
        },
        behavioral: {
          general: 'Describe a challenging bug you fixed. What was your debugging process?',
        },
        system_design: {
          general: 'Design a simple URL shortener service. What are the main components?',
        },
      },
      senior: {
        technical: {
          frontend: 'How would you optimize the performance of a large React application? Discuss code splitting, lazy loading, and memoization.',
          backend: 'Explain microservices architecture. What are the advantages and challenges?',
          mobile: 'How would you handle offline data synchronization in a mobile app?',
          fullstack: 'Design a real-time notification system for a social media platform.',
          devops: 'Explain CI/CD pipeline. What are the key stages and tools?',
          general: 'What is SOLID principles? Explain each principle with examples.',
        },
        behavioral: {
          general: 'Tell me about a time when you had to make a difficult technical decision. How did you evaluate the trade-offs?',
        },
        system_design: {
          general: 'Design a scalable chat application that supports millions of users. Consider data storage, real-time messaging, and load balancing.',
        },
      },
      lead: {
        technical: {
          architecture: 'How would you migrate a monolithic application to microservices? What are the key considerations?',
          fullstack: 'Design a multi-tenant SaaS platform architecture. How would you handle data isolation and scalability?',
          devops: 'Explain infrastructure as code. What are the benefits and best practices?',
          general: 'What are the key principles of building maintainable and scalable systems?',
        },
        behavioral: {
          general: 'Describe your approach to mentoring junior developers and conducting code reviews.',
        },
        system_design: {
          general: 'Design a distributed system for processing millions of transactions per day. Consider fault tolerance, consistency, and scalability.',
        },
      },
    };

    try {
      return fallbacks[position]?.[type]?.[domain] || this.getDefaultFallback(type);
    } catch {
      return this.getDefaultFallback(type);
    }
  }

  /**
   * 🆘 Ultimate fallback (should never reach here)
   */
  private getDefaultFallback(type: string): string {
    const defaults = {
      technical: 'Describe a challenging technical problem you solved recently and explain your approach.',
      behavioral: 'Tell me about a time when you had to work with a difficult team member. How did you handle it?',
      system_design: 'Design a system that can handle high traffic. Explain your architecture choices.',
    };
    return defaults[type] || defaults.technical;
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

  /**
   * 📝 Build AI prompt
   */
  private buildPrompt(position: string, type: string, domain: string): string {
    const roleMap = {
      junior: 'Junior',
      middle: 'Middle',
      senior: 'Senior',
      lead: 'Lead/Architect',
    };

    const typeMap = {
      technical: 'technical interview',
      behavioral: 'behavioral interview',
      system_design: 'system design interview',
    };

    return `Generate 1 ${typeMap[type]} question for a ${roleMap[position]} ${domain} developer.

Requirements:
- Professional and challenging
- Real-world scenario
- Clear and concise
- One question only
- No quotes or markdown

Return ONLY the question text.`;
  }
}
