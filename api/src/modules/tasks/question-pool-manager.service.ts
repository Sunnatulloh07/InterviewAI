import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { GeneratedQuestion, GeneratedQuestionDocument } from './schemas/generated-question.schema';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENROUTER_MODELS } from '../../common/utils/openai-client.factory';

/**
 * 🏭 QUESTION POOL MANAGER SERVICE
 * 
 * Background service that maintains a pool of pre-generated questions
 * to enable sequential learning without real-time AI generation
 * 
 * ARCHITECTURE:
 * 1. Runs every 30 minutes (24/7)
 * 2. Generates questions for each position/type/domain combination
 * 3. Stores in database for sequential distribution
 * 4. New users get oldest questions first (FIFO)
 * 5. Pool auto-refills when running low
 * 
 * BENEFITS:
 * - 🚀 Fast delivery (no AI wait at 09:00)
 * - 💰 Cost efficient (batch generation cheaper)
 * - 📚 Sequential learning (all users same path)
 * - ⚡ Scalable (1M users no problem)
 */
@Injectable()
export class QuestionPoolManagerService {
  private readonly logger = new Logger(QuestionPoolManagerService.name);
  private readonly openai: OpenAI;

  // 🎯 SMART POOL SIZING: Based on expected user distribution
  // High-traffic combinations get more questions
  private readonly POOL_SIZES = {
    high: { target: 150, min: 50 },    // Junior/Middle (70% users)
    medium: { target: 80, min: 30 },   // Senior (25% users)
    low: { target: 40, min: 15 },      // Lead (5% users)
  };
  
  private readonly BATCH_SIZE = 10; // Generate 10 at a time

  // Position/Type/Domain combinations with traffic priority
  private readonly COMBINATIONS = [
    // Junior (HIGH traffic - 40% of users)
    { position: 'junior', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'general'], priority: 'high' },
    { position: 'junior', type: 'behavioral', domains: ['general'], priority: 'high' },
    
    // Middle (HIGH traffic - 30% of users)
    { position: 'middle', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'fullstack', 'general'], priority: 'high' },
    { position: 'middle', type: 'behavioral', domains: ['general'], priority: 'high' },
    { position: 'middle', type: 'system_design', domains: ['general'], priority: 'high' },
    
    // Senior (MEDIUM traffic - 25% of users)
    { position: 'senior', type: 'technical', domains: ['frontend', 'backend', 'mobile', 'fullstack', 'devops', 'general'], priority: 'medium' },
    { position: 'senior', type: 'behavioral', domains: ['general'], priority: 'medium' },
    { position: 'senior', type: 'system_design', domains: ['general'], priority: 'medium' },
    
    // Lead (LOW traffic - 5% of users)
    { position: 'lead', type: 'technical', domains: ['architecture', 'fullstack', 'devops', 'general'], priority: 'low' },
    { position: 'lead', type: 'behavioral', domains: ['general'], priority: 'low' },
    { position: 'lead', type: 'system_design', domains: ['general'], priority: 'low' },
  ];

  constructor(
    @InjectModel(GeneratedQuestion.name)
    private readonly questionModel: Model<GeneratedQuestionDocument>,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    // Initialize OpenRouter client
    // 🔧 FIX: Use OPENAI_API_KEY instead of OPENROUTER_API_KEY (consistent with daily-tasks.service.ts)
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim() && !apiKey.includes('your-')) {
      this.openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
          'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || 'https://interviewai.pro',
          'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || 'InterviewAI Pro',
        },
      });
      this.logger.log('✅ OpenAI/OpenRouter client initialized successfully');
    } else {
      this.logger.warn('⚠️  OPENAI_API_KEY not configured - pool generation will be skipped!');
    }
  }

  /**
   * 🕐 CRON: Background Question Generation
   * 
   * ⚠️  DISABLED - Replaced by UserAwarePoolManagerService
   * This service generates questions WITHOUT checking if users actually need them
   * UserAwarePoolManagerService tracks real user consumption and generates on-demand
   * 
   * Runs every 30 minutes to maintain question pool
   * Generates questions for position/type/domain combinations that are running low
   */
  // @Cron('*/30 * * * *', { // 🚫 DISABLED - Use UserAwarePoolManagerService instead
  //   name: 'refill_question_pool',
  //   timeZone: 'Asia/Tashkent',
  // })
  async refillQuestionPool(): Promise<void> {
    const lockKey = 'cron:question-pool:refill';
    const lockTTL = 1800; // 30 minutes

    try {
      // Distributed lock
      const lockAcquired = await this.redis.set(
        lockKey,
        Date.now().toString(),
        'EX',
        lockTTL,
        'NX',
      );

      if (!lockAcquired) {
        this.logger.warn('Question pool refill already running, skipping');
        return;
      }

      this.logger.log('🏭 Starting question pool refill...');

      let totalGenerated = 0;
      let totalSkipped = 0;

      // Check each combination (language is baked into question fields, no separate loop needed)
      for (const combo of this.COMBINATIONS) {
        // Get dynamic pool size based on priority
        const poolConfig = this.POOL_SIZES[combo.priority];
        
        for (const domain of combo.domains) {
          try {
            const count = await this.questionModel.countDocuments({
              position: combo.position,
              type: combo.type,
              domain: domain,
            });

            this.logger.debug(
              `Pool status: ${combo.position}/${combo.type}/${domain} (${combo.priority}) = ${count}/${poolConfig.target} (min: ${poolConfig.min})`,
            );

            // Refill if below minimum
            if (count < poolConfig.min) {
              const needed = poolConfig.target - count;
              const toGenerate = Math.min(needed, this.BATCH_SIZE);

              this.logger.log(
                `🔥 Pool low! Generating ${toGenerate} questions for ${combo.position}/${combo.type}/${domain} (${combo.priority} priority)`,
              );

              // Generate in English as base; question_uz and question_ru stubs are seeded
              // with the same text. A separate translation pipeline can refine them.
              const generated = await this.generateQuestionsForCombination(
                combo.position,
                combo.type,
                domain,
                'en',
                toGenerate,
              );

              totalGenerated += generated;
            } else {
              totalSkipped++;
            }

            // Rate limiting: 500ms between batches
            await this.delay(500);
          } catch (error: any) {
            this.logger.error(
              `Failed to refill ${combo.position}/${combo.type}/${domain}: ${error.message}`,
            );
          }
        }
      }

      this.logger.log(
        `✅ Question pool refill complete: ${totalGenerated} generated, ${totalSkipped} skipped`,
      );
    } catch (error: any) {
      this.logger.error(`Question pool refill failed: ${error.message}`, error.stack);
    } finally {
      try {
        await this.redis.del(lockKey);
      } catch (lockError: any) {
        this.logger.error(`Failed to release lock: ${lockError.message}`);
      }
    }
  }

  /**
   * Generate multiple questions for a specific combination
   */
  private async generateQuestionsForCombination(
    position: string,
    type: string,
    domain: string,
    language: string, // 🌍 New parameter
    count: number,
  ): Promise<number> {
    if (!this.openai) {
      this.logger.warn('OpenRouter not configured, skipping generation');
      return 0;
    }

    let generated = 0;

    for (let i = 0; i < count; i++) {
      try {
        const question = await this.generateSingleQuestion(position, type, domain, language);

        if (question) {
          // Map the generated single-language string to the correct schema field.
          // The other language fields are seeded with the same text as a stub;
          // a dedicated multilingual generation pipeline can overwrite them later.
          const questionFields: Record<string, string> = {
            question_uz: question,
            question_ru: question,
            question_en: question,
          };
          // Overwrite only the generated language field to mark the canonical one
          const langField = `question_${language}` as keyof typeof questionFields;
          if (langField in questionFields) {
            questionFields[langField] = question;
          }

          await this.questionModel.create({
            ...questionFields,
            position: position,
            type: type,
            domain: domain,
            techStacks: [domain], // Simplified
            timesUsed: 0,
            metadata: {
              generatedBy: 'z-ai/glm-4-32b',
              tokensUsed: 0, // Unknown (OpenRouter doesn't return this)
              generationTime: 0,
              cost: 0.00001, // Estimated: ~$0.01 per 1K questions
            },
            // createdAt is auto-added by Mongoose timestamps
          });

          generated++;
          this.logger.debug(`✅ Generated question ${i + 1}/${count} (${language})`);
        }

        // Rate limiting: 1 second between API calls
        await this.delay(1000);
      } catch (error: any) {
        this.logger.error(`Failed to generate question ${i + 1}: ${error.message}`);
      }
    }

    return generated;
  }

  /**
   * Generate a single question using AI (with language support)
   */
  private async generateSingleQuestion(
    position: string,
    type: string,
    domain: string,
    language: string, // 🌍 Language parameter
  ): Promise<string | null> {
    const prompt = this.buildPrompt(position, type, domain, language);

    try {
      const response = await this.openai.chat.completions.create({
        model: OPENROUTER_MODELS['glm-4-32b'], // Very cheap: $0.10 per 1M tokens (6x cheaper than GPT-4o-mini)
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(language), // 🌍 Language-specific system prompt
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.9, // High creativity for diverse questions
        max_tokens: 200,
      });

      const question = response.choices[0]?.message?.content?.trim();

      // Validation
      if (!question || question.length < 20 || question.length > 1000) {
        this.logger.warn('Generated question invalid length');
        return null;
      }

      return question;
    } catch (error: any) {
      this.logger.error(`AI generation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🌍 Get language-specific system prompt
   */
  private getSystemPrompt(language: string): string {
    const prompts = {
      uz: "Siz professional intervyu mutaxassisısız. Realistik va amaliy intervyu savollarini yarating. " +
          "FAQAT savol matnini qaytaring, boshqa hech narsa yo'q.",
      ru: "Вы эксперт по техническим интервью. Создайте реалистичные, практические вопросы для интервью. " +
          "Верните ТОЛЬКО текст вопроса, без дополнительного форматирования или объяснений.",
      en: "You are an expert technical interviewer. Generate realistic, practical interview questions. " +
          "Return ONLY the question text, no additional formatting or explanation.",
    };
    return prompts[language] || prompts.en;
  }

  /**
   * 🌍 Build prompt for question generation (multilingual)
   */
  private buildPrompt(position: string, type: string, domain: string, language: string): string {
    const positionContext = {
      uz: {
        junior: '1-2 yillik tajriba, boshlang\'ich daraja',
        middle: '3-5 yillik tajriba, o\'rta daraja',
        senior: '5+ yillik tajriba, yuqori daraja',
        lead: '7+ yillik tajriba, leadership',
      },
      ru: {
        junior: '1-2 года опыта, начальный уровень',
        middle: '3-5 лет опыта, средний уровень',
        senior: '5+ лет опыта, продвинутый уровень',
        lead: '7+ лет опыта, лидерство',
      },
      en: {
        junior: '1-2 years experience, entry-level',
        middle: '3-5 years experience, intermediate',
        senior: '5+ years experience, advanced',
        lead: '7+ years experience, leadership',
      },
    };

    const levelText = positionContext[language]?.[position] || positionContext.en[position];

    const prompts = {
      uz: {
        technical: `${domain} dasturchisi uchun texnik intervyu savolini yarating (daraja: ${levelText}). 
Savol amaliy dasturlash bilimini, muammo yechish yoki tizim tushunishni tekshirishi kerak. 
Zamonaviy ${domain} dasturlashga mos va realistik bo'lsin.`,
        behavioral: `Dasturchi uchun xulq-atvor (behavioral) intervyu savolini yarating (daraja: ${levelText}). 
Jamoa ishlashi, muloqot, nizolarni hal qilish yoki kasbiy o'sishga e'tibor bering. 
Vaziyatga asoslangan (STAR metodiga mos) bo'lsin.`,
        system_design: `Muhandis uchun tizim dizayni (system design) savolini yarating (daraja: ${levelText}). 
Kengaytiriladigan tizim dizayn qilishni so'rang, arxitektura, ma'lumotlar bazasi, API va kengaytirilishni hisobga oling. 
${position} darajasiga mos va realistik bo'lsin.`,
      },
      ru: {
        technical: `Создайте технический вопрос для интервью ${domain} разработчика (уровень: ${levelText}). 
Вопрос должен проверять практические знания программирования, решение задач или понимание системы. 
Сделайте его реалистичным и актуальным для современной ${domain} разработки.`,
        behavioral: `Создайте поведенческий (behavioral) вопрос для интервью программиста (уровень: ${levelText}). 
Сосредоточьтесь на командной работе, коммуникации, разрешении конфликтов или профессиональном росте. 
Сделайте его основанным на ситуации (совместимым с методом STAR).`,
        system_design: `Создайте вопрос по проектированию систем для инженера (уровень: ${levelText}). 
Попросите спроектировать масштабируемую систему, учитывая архитектуру, базы данных, API и масштабируемость. 
Сделайте его реалистичным и подходящим для уровня ${position}.`,
      },
      en: {
        technical: `Generate a technical interview question for a ${domain} developer (level: ${levelText}). 
The question should test practical coding knowledge, problem-solving, or system understanding. 
Make it realistic and relevant to modern ${domain} development.`,
        behavioral: `Generate a behavioral interview question for a software engineer (level: ${levelText}). 
Focus on teamwork, communication, conflict resolution, or professional growth. 
Make it situation-based (STAR method compatible).`,
        system_design: `Generate a system design question for an engineer (level: ${levelText}). 
Ask them to design a scalable system, considering architecture, databases, APIs, and scalability. 
Make it realistic and suitable for ${position} level.`,
      },
    };

    return prompts[language]?.[type] || prompts.en[type] || `Generate an interview question for ${position} ${type} developer.`;
  }

  /**
   * Helper: delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 🔍 DEBUG: Check pool status
   */
  async getPoolStatus(): Promise<any> {
    const stats: Array<{
      position: string;
      type: string;
      domain: string;
      priority: string;
      count: number;
      min: number;
      target: number;
      percentage: number;
      status: string;
    }> = [];

    for (const combo of this.COMBINATIONS) {
      const poolConfig = this.POOL_SIZES[combo.priority];
      
      for (const domain of combo.domains) {
        const count = await this.questionModel.countDocuments({
          position: combo.position,
          type: combo.type,
          domain: domain,
        });

        stats.push({
          position: combo.position,
          type: combo.type,
          domain: domain,
          priority: combo.priority,
          count: count,
          min: poolConfig.min,
          target: poolConfig.target,
          percentage: Math.round((count / poolConfig.target) * 100),
          status: count >= poolConfig.min ? '✅' : '⚠️',
        });
      }
    }

    return stats;
  }
}
