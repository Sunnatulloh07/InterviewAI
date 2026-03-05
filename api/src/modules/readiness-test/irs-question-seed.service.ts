import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import OpenAI from 'openai';
import { IrsQuestion, IrsQuestionDocument } from './schemas/irs-question-pool.schema';
import { IRS_CATEGORIES, IRS_DIFFICULTIES, IRS_TOTAL_QUESTIONS } from './constants/irs.constants';

/**
 * IRS Question Generator Service
 *
 * 3-LEVEL DEFENSE (same pattern as SafeQuestionProviderService):
 * 1. DB pool (fast, free)
 * 2. AI generation (on-demand, saves to DB for future)
 * 3. Static fallback (always works)
 *
 * Also seeds a minimal set of questions on first startup via AI.
 */
@Injectable()
export class IrsQuestionSeedService implements OnModuleInit {
  private readonly logger = new Logger(IrsQuestionSeedService.name);
  private readonly openai: OpenAI | null;
  private readonly MINIMUM_SEED_QUESTIONS = 20;

  constructor(
    @InjectModel(IrsQuestion.name)
    private readonly irsQuestionModel: Model<IrsQuestionDocument>,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey && apiKey.trim() && !apiKey.includes('your-')) {
      this.openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || 'https://getjobi.app',
          'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || 'Jobi',
        },
        timeout: 30000,
      });
    } else {
      this.openai = null;
    }
  }

  /**
   * On startup: seed minimal questions if pool is empty
   */
  async onModuleInit(): Promise<void> {
    try {
      const count = await this.irsQuestionModel.countDocuments();
      if (count >= this.MINIMUM_SEED_QUESTIONS) {
        this.logger.log(`IRS pool has ${count} questions. OK.`);
        return;
      }

      this.logger.log(`IRS pool has ${count} questions (need ${this.MINIMUM_SEED_QUESTIONS}). Seeding...`);

      // Seed top 3 tech stacks x 4 positions = 12 combos, 5 questions each = 60 questions
      const topTechStacks = ['javascript', 'python', 'react'];
      const positions = ['junior', 'middle', 'senior', 'lead'];

      let generated = 0;
      for (const tech of topTechStacks) {
        for (const pos of positions) {
          const existing = await this.irsQuestionModel.countDocuments({ position: pos, techStack: tech });
          if (existing >= IRS_TOTAL_QUESTIONS) continue;

          const needed = IRS_TOTAL_QUESTIONS - existing;
          const questions = await this.generateQuestionsWithAI(pos, tech, needed);
          if (questions.length > 0) {
            await this.irsQuestionModel.insertMany(questions, { ordered: false }).catch(() => {});
            generated += questions.length;
          }
          // Rate limit
          await this.delay(1500);
        }
      }

      this.logger.log(`IRS seed complete: generated ${generated} questions via AI.`);
    } catch (error: any) {
      this.logger.error(`IRS seed failed: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Generate questions on-demand (called from selectQuestions)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate IRS questions for a specific position + techStack.
   * Saves to DB and returns generated documents.
   *
   * Called when selectQuestions() can't find enough questions in the pool.
   */
  async generateAndSaveQuestions(
    position: string,
    techStack: string,
    count: number = IRS_TOTAL_QUESTIONS,
  ): Promise<IrsQuestionDocument[]> {
    this.logger.log(`Generating ${count} IRS questions for ${position}/${techStack} via AI...`);

    // Level 2: AI generation
    const generated = await this.generateQuestionsWithAI(position, techStack, count);
    if (generated.length > 0) {
      try {
        const docs = await this.irsQuestionModel.insertMany(generated, { ordered: false });
        this.logger.log(`Saved ${docs.length} AI-generated questions for ${position}/${techStack}`);
        return docs as IrsQuestionDocument[];
      } catch (error: any) {
        this.logger.error(`Failed to save generated questions: ${error.message}`);
      }
    }

    // Level 3: Static fallback
    this.logger.warn(`AI generation failed for ${position}/${techStack}. Using static fallback.`);
    const fallbacks = this.getStaticFallbackQuestions(position, techStack);
    try {
      const docs = await this.irsQuestionModel.insertMany(fallbacks, { ordered: false });
      return docs as IrsQuestionDocument[];
    } catch (error: any) {
      // If even insert fails (duplicates), just query what exists
      this.logger.warn(`Static fallback insert failed: ${error.message}`);
      return await this.irsQuestionModel
        .find({ position, isActive: true })
        .limit(count)
        .exec();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LEVEL 2: AI Generation
  // ═══════════════════════════════════════════════════════════════

  private async generateQuestionsWithAI(
    position: string,
    techStack: string,
    count: number,
  ): Promise<Partial<IrsQuestion>[]> {
    if (!this.openai) {
      this.logger.warn('OpenAI client not configured. Skipping AI generation.');
      return [];
    }

    const techLabel = this.getTechLabel(techStack);
    const posLabel = this.getPosLabel(position);

    const prompt = `Siz ekspert texnik intervyuer siz. ${posLabel} darajadagi ${techLabel} dasturchisi uchun ${count} ta intervyu savoli generatsiya qiling.

Har bir savol 3 tilda bo'lsin (O'zbek, Rus, Ingliz).

Savollar kategoriyalari:
- technical (texnik bilim)
- behavioral (xulq-atvor, jamoa ishlashi)
- problemSolving (muammo yechish, algoritm)
- systemDesign (tizim dizayni, arxitektura)

Qiyinchilik darajalari: easy, medium, hard
- ${position === 'junior' ? 'Ko\'proq easy va medium' : position === 'middle' ? 'Medium asosiy, easy va hard aralash' : 'Ko\'proq hard va medium'}

Talablar:
1. Har bir savol REAL intervyuda so'raladigan bo'lsin
2. ${techLabel} ga TEGISHLI texnik savollar
3. Har xil kategoriya va qiyinlik aralashtirilsin
4. Takrorlanmasin

FAQAT valid JSON massivi qaytaring:
[
  {
    "text_uz": "Savol o'zbek tilida",
    "text_ru": "Вопрос на русском",
    "text_en": "Question in English",
    "category": "technical|behavioral|problemSolving|systemDesign",
    "difficulty": "easy|medium|hard",
    "hints": ["maslahat1", "maslahat2"]
  }
]`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'z-ai/glm-4-32b',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return [];

      // Extract JSON array
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      // Validate and map
      const validCategories = ['technical', 'behavioral', 'problemSolving', 'systemDesign'];
      const validDifficulties = ['easy', 'medium', 'hard'];

      return parsed
        .filter((q: any) =>
          q.text_uz && q.text_ru && q.text_en &&
          validCategories.includes(q.category) &&
          validDifficulties.includes(q.difficulty),
        )
        .map((q: any) => ({
          text_uz: q.text_uz,
          text_ru: q.text_ru,
          text_en: q.text_en,
          category: q.category,
          difficulty: q.difficulty,
          position,
          techStack,
          hints: Array.isArray(q.hints) ? q.hints : [],
          isActive: true,
          timesUsed: 0,
          avgScore: 0,
        }));
    } catch (error: any) {
      this.logger.error(`AI question generation failed: ${error.message}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LEVEL 3: Static Fallback (always works, no AI needed)
  // ═══════════════════════════════════════════════════════════════

  private getStaticFallbackQuestions(position: string, techStack: string): Partial<IrsQuestion>[] {
    const techLabel = this.getTechLabel(techStack);
    const base = { position, techStack, isActive: true, timesUsed: 0, avgScore: 0, hints: [] };

    return [
      {
        ...base,
        text_uz: `${techLabel} ning asosiy xususiyatlarini va ularni real loyihada qanday ishlatganingizni tushuntiring.`,
        text_ru: `Объясните основные особенности ${techLabel} и как вы использовали их в реальном проекте.`,
        text_en: `Explain the core features of ${techLabel} and how you've used them in a real project.`,
        category: 'technical', difficulty: position === 'junior' ? 'easy' : 'medium',
      },
      {
        ...base,
        text_uz: `${techLabel} da eng ko'p uchraydigan xatoliklarni qanday debug qilasiz?`,
        text_ru: `Как вы отлаживаете наиболее частые ошибки в ${techLabel}?`,
        text_en: `How do you debug the most common errors in ${techLabel}?`,
        category: 'technical', difficulty: 'medium',
      },
      {
        ...base,
        text_uz: `Jamoada texnik qaror bo'yicha kelishmovchilik bo'lganini va uni qanday hal qilganingizni aytib bering.`,
        text_ru: `Расскажите о разногласиях в команде по техническому решению и как вы их разрешили.`,
        text_en: `Tell me about a technical disagreement in your team and how you resolved it.`,
        category: 'behavioral', difficulty: 'easy',
      },
      {
        ...base,
        text_uz: `Katta hajmdagi ma'lumotlarni qayta ishlashda performance muammosini qanday hal qilgan bo'lar edingiz?`,
        text_ru: `Как бы вы решили проблему производительности при обработке большого объёма данных?`,
        text_en: `How would you solve a performance problem when processing large amounts of data?`,
        category: 'problemSolving', difficulty: position === 'junior' ? 'easy' : 'hard',
      },
      {
        ...base,
        text_uz: `Oddiy URL qisqartiruvchi xizmatini loyihalang. Asosiy komponentlar va texnologiyalarni tushuntiring.`,
        text_ru: `Спроектируйте простой сервис для сокращения URL. Объясните основные компоненты и технологии.`,
        text_en: `Design a simple URL shortener service. Explain the main components and technologies.`,
        category: 'systemDesign', difficulty: position === 'lead' ? 'hard' : 'medium',
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private getTechLabel(tech: string): string {
    const labels: Record<string, string> = {
      javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
      java: 'Java', csharp: 'C#', golang: 'Go', php: 'PHP', ruby: 'Ruby',
      swift: 'Swift', kotlin: 'Kotlin', rust: 'Rust', react: 'React',
      angular: 'Angular', vue: 'Vue.js', node: 'Node.js', django: 'Django',
      spring: 'Spring', dotnet: '.NET', flutter: 'Flutter', react_native: 'React Native',
    };
    return labels[tech] || tech;
  }

  private getPosLabel(position: string): string {
    const labels: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead' };
    return labels[position] || position;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
