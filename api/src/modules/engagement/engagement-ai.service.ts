import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { NotificationTrigger } from './schemas/notification-log.schema';
import { EngagementUserContext, GeneratedMessage } from './dto/engagement.dto';

/**
 * Configuration constants
 */
const AI_CONFIG = {
  /** Request timeout in milliseconds */
  TIMEOUT_MS: 10000,
  /** Maximum retry attempts */
  MAX_RETRIES: 2,
  /** Base delay for exponential backoff (ms) */
  RETRY_DELAY_MS: 500,
  /** Temperature for variety (0-1) */
  TEMPERATURE: 0.9,
  /** Maximum tokens for response */
  MAX_TOKENS: 300,
};

/**
 * Prompt templates for different notification triggers
 * These provide structure while allowing AI creativity
 */
const TRIGGER_PROMPTS: Record<NotificationTrigger, string> = {
  [NotificationTrigger.INCOMPLETE_INTERVIEW]: `
Foydalanuvchi intervyuni yarim qoldirgan. Uni davom ettirishga undash kerak.
- Chala qolgan texnologiya: {pausedInterviewTechnology}
- Qolgan savollar bor
Samimiy, do'stona ohangda yoz.`,

  [NotificationTrigger.LONG_ABSENCE]: `
Foydalanuvchi {daysSinceActive} kun botga kirmagan. Uni qaytarishga motivatsiya ber.
- Ohirgi texnologiya: {lastTechnology}
- O'rtacha ball: {averageScore}%
Sog'inganlik hissini ifodalab, lekin bosim o'tkazmasdan yoz.`,

  [NotificationTrigger.SCORE_DECLINE]: `
Foydalanuvchining ohirgi intervyu natijalari pasaygan. Uni ruhlantir va mashq qilishga undash.
- Ohirgi 3 ta ball: {recentScores}
- O'rtacha ball: {averageScore}%
Muvaffaqiyatsizlikni normal deb tushuntir, davom etishga motivatsiya ber.`,

  [NotificationTrigger.ACHIEVEMENT]: `
Foydalanuvchi yangi yutuqqa erishdi! Uni tabriklash kerak.
- Yutuq turi: {achievementType}
- Yangi rekord yoki streak
Quvnoq, g'ayratli ohangda tabriklash xabarini yoz.`,

  [NotificationTrigger.WEEKLY_PROGRESS]: `
Haftalik progress xulosasi tayyorlash kerak.
- Bu hafta tugallangan intervyular: {weeklyInterviews}
- O'rtacha ball: {averageScore}%
- Kuchli tomonlar: {strengths}
- Yaxshilash kerak: {improvements}
Qisqa, foydali xulosalar ber.`,

  [NotificationTrigger.FIRST_INTERVIEW]: `
Foydalanuvchi birinchi intervyusini tugatdi! Bu muhim qadam.
- Texnologiya: {lastTechnology}
- Ball: {firstScore}%
Tabrikla va keyingi qadamlarni ayt.`,

  [NotificationTrigger.TRIAL_ENDING]: `
Foydalanuvchining trial muddati {trialDaysRemaining} kunda tugaydi.
- Hozirgi plan: {subscriptionPlan}
- Tugallangan intervyular: {completedInterviews}
Spamga o'xshamaydigan, samimiy tarzda eslatish yoz.`,

  [NotificationTrigger.ONBOARDING_SURVEY]: `
Yangi foydalanuvchiga sodda savol ber: hozirda qaysi bosqichda?
Variantlar: faol ish izlash, tayyorgarlik, bilim oshirish.
Juda qisqa (1 jumla), do'stona, samimiy ohangda.`,

  [NotificationTrigger.JOBSEEKER_INACTIVE]: `
Faol ish izlayotgan foydalanuvchi 1 kun botga kirmagan.
Qisqa motivatsiya ber: mock interview yoki skill oshirishga undov.
MAKSIMUM 2 jumla! G'ayratli, lekin bosim o'tkazmasdan.`,
};

/**
 * System prompts per language (internationalized)
 */
const SYSTEM_PROMPTS: Record<string, string> = {
  uz: `Siz InterviewAI Pro botining do'stona, samimiy assistentisiz. Faqat O'ZBEK tilida javob bering.

QOIDALAR:
1. Faqat xabar matnini yoz, boshqa hech narsa yo'q
2. Xabarlaringiz qisqa bo'lsin (2-3 jumla)
3. 1-2 ta emoji ishlat (haddan tashqari ko'p emas)
4. Spam yoki reklama kabi ko'rinmasin
5. Shaxsiylashtirilgan bo'lsin (ismni ishlat)
6. Har safar BOSHQACHA uslubda yoz - ba'zan hazil, ba'zan jiddiy, ba'zan do'stona`,

  ru: `Вы дружелюбный ассистент бота InterviewAI Pro. Отвечайте ТОЛЬКО на РУССКОМ языке.

ПРАВИЛА:
1. Пишите только текст сообщения, ничего лишнего
2. Сообщения должны быть короткими (2-3 предложения)
3. Используйте 1-2 эмодзи (не больше)
4. Не должно выглядеть как спам или реклама
5. Персонализируйте (используйте имя)
6. Каждый раз пишите в РАЗНОМ стиле - иногда шутливо, иногда серьёзно, иногда дружелюбно`,

  en: `You are a friendly assistant of InterviewAI Pro bot. Reply ONLY in ENGLISH.

RULES:
1. Write only the message text, nothing else
2. Keep messages short (2-3 sentences)
3. Use 1-2 emojis (not too many)
4. Don't sound like spam or advertising
5. Personalize (use their name)
6. Write in a DIFFERENT style each time - sometimes humorous, sometimes serious, sometimes friendly`,
};

/**
 * EngagementAiService
 *
 * Generates personalized engagement messages using Z-AI (GLM-4.5-Flash)
 * through OpenRouter API. This model is FREE, making it cost-effective
 * for high-volume notification generation.
 *
 * Key features:
 * - Timeout protection (10s max)
 * - Retry with exponential backoff (2 retries)
 * - Multi-language system prompts (uz, ru, en)
 * - Structured prompts per trigger type
 * - Fallback to templates on AI failure
 */
@Injectable()
export class EngagementAiService {
  private readonly logger = new Logger(EngagementAiService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const isOpenRouter = apiKey?.startsWith('sk-or-');

    const baseURL = isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';

    this.openai = new OpenAI({
      apiKey,
      baseURL,
      timeout: AI_CONFIG.TIMEOUT_MS,
      maxRetries: 0, // We handle retries manually for better control
      defaultHeaders: isOpenRouter
        ? { 'HTTP-Referer': 'https://interviewai.pro', 'X-Title': 'InterviewAI Pro' }
        : undefined,
    });

    // Use Z-AI GLM-4.5-Flash (FREE) if using OpenRouter
    this.model = isOpenRouter ? 'zhipu/glm-4.5-flash' : 'gpt-4o-mini';

    this.logger.log(`EngagementAiService initialized with model: ${this.model}`);
  }

  /**
   * Generate a personalized engagement message with retry logic
   *
   * @param trigger - What triggered this notification
   * @param context - User context for personalization
   * @returns Generated message with metadata
   */
  async generateMessage(
    trigger: NotificationTrigger,
    context: EngagementUserContext,
  ): Promise<GeneratedMessage> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= AI_CONFIG.MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff
          const delay = AI_CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          this.logger.debug(`Retry attempt ${attempt} after ${delay}ms`);
        }

        return await this.callAI(trigger, context);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `AI call failed (attempt ${attempt + 1}/${AI_CONFIG.MAX_RETRIES + 1}): ${error.message}`,
        );

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }
      }
    }

    this.logger.error(`All AI attempts failed for trigger=${trigger}: ${lastError?.message}`);
    return this.getFallbackMessage(trigger, context);
  }

  /**
   * Actually call the AI API
   */
  private async callAI(
    trigger: NotificationTrigger,
    context: EngagementUserContext,
  ): Promise<GeneratedMessage> {
    const systemPrompt = SYSTEM_PROMPTS[context.language] || SYSTEM_PROMPTS.uz;
    const userPrompt = this.buildUserPrompt(trigger, context);

    const startTime = Date.now();

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: AI_CONFIG.TEMPERATURE,
      max_tokens: AI_CONFIG.MAX_TOKENS,
      top_p: 0.95,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    const tokensUsed = response.usage?.total_tokens || 0;

    this.logger.debug(
      `Generated message for trigger=${trigger} in ${Date.now() - startTime}ms, tokens=${tokensUsed}`,
    );

    // Validate output
    if (!content || content.length < 10) {
      throw new Error('AI returned empty or too short message');
    }

    if (content.length > 500) {
      // Truncate overly long messages
      this.logger.warn(`Truncating long message (${content.length} chars)`);
      return {
        content: content.substring(0, 500) + '...',
        model: this.model,
        tokensUsed,
      };
    }

    return {
      content,
      model: this.model,
      tokensUsed,
    };
  }

  /**
   * Build user prompt with trigger-specific instructions and context
   */
  private buildUserPrompt(trigger: NotificationTrigger, context: EngagementUserContext): string {
    let triggerPrompt =
      TRIGGER_PROMPTS[trigger] || TRIGGER_PROMPTS[NotificationTrigger.LONG_ABSENCE];

    // Replace all placeholders with actual context values
    triggerPrompt = triggerPrompt
      .replace(/{firstName}/g, context.firstName)
      .replace(/{daysSinceActive}/g, String(context.daysSinceActive))
      .replace(/{averageScore}/g, String(context.averageScore))
      .replace(/{lastTechnology}/g, context.lastTechnology || 'texnologiya')
      .replace(/{pausedInterviewTechnology}/g, context.pausedInterviewTechnology || 'texnologiya')
      .replace(/{completedInterviews}/g, String(context.completedInterviews))
      .replace(/{subscriptionPlan}/g, context.subscriptionPlan)
      .replace(/{trialDaysRemaining}/g, String(context.trialDaysRemaining || 0))
      .replace(/{recentScores}/g, context.recentScores?.join(', ') || "ma'lumot yo'q")
      .replace(/{achievementType}/g, context.achievementType || 'yangi yutuq')
      .replace(/{weeklyInterviews}/g, String(context.weeklyInterviews || 0))
      .replace(/{strengths}/g, context.strengths?.join(', ') || 'yaxshi')
      .replace(/{improvements}/g, context.improvements?.join(', ') || 'davom eting')
      .replace(/{firstScore}/g, String(context.firstScore || 0));

    return `Foydalanuvchi: ${context.firstName}

${triggerPrompt}

Shaxsiylashtirilgan, qisqa (2-3 jumla) xabar yoz:`;
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(error: any): boolean {
    // Don't retry on authentication or validation errors
    const nonRetryableStatuses = [401, 403, 400, 422];
    return nonRetryableStatuses.includes(error.status);
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get fallback template message when AI fails
   */
  private getFallbackMessage(
    trigger: NotificationTrigger,
    context: EngagementUserContext,
  ): GeneratedMessage {
    const templates: Record<string, Record<NotificationTrigger, string>> = {
      uz: {
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `Salom, ${context.firstName}! 👋 Intervyungiz hali tugallanmagan. Davom ettirishni xohlaysizmi?`,
        [NotificationTrigger.LONG_ABSENCE]: `Salom, ${context.firstName}! 🌟 Sizni sog'indik. Intervyu mashqlarini davom ettirishga tayyormisiz?`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, mashq qilish - mukammallik kaliti! 💪 Keyingi intervyuda yanada yaxshiroq natija ko'rsatishingizga ishonaman.`,
        [NotificationTrigger.ACHIEVEMENT]: `Tabriklaymiz, ${context.firstName}! 🎉 Siz ajoyib natijaga erishdingiz!`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `Haftalik xulosangiz tayyor, ${context.firstName}! 📊 O'rtacha ballingiz: ${context.averageScore}%`,
        [NotificationTrigger.FIRST_INTERVIEW]: `Ajoyib, ${context.firstName}! 🚀 Birinchi intervyungizni muvaffaqiyatli tugatdingiz!`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `Salom, ${context.firstName}! 🎯 Sizga bir savol: hozirda faol ish izlayapsizmi, tayyorgarlik ko'rayapsizmi yoki bilimlaringizni oshirayapsizmi?`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, ish izlash jarayonida doimiy mashq muhim! 💪 Bugun bir mock intervyu o'tkazib ko'ring.`,
      },
      ru: {
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `Привет, ${context.firstName}! 👋 Ваше интервью ещё не завершено. Хотите продолжить?`,
        [NotificationTrigger.LONG_ABSENCE]: `Привет, ${context.firstName}! 🌟 Мы скучали. Готовы продолжить практику?`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, практика - ключ к совершенству! 💪 Уверен, в следующий раз будет лучше.`,
        [NotificationTrigger.ACHIEVEMENT]: `Поздравляю, ${context.firstName}! 🎉 Отличный результат!`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `Ваш еженедельный отчёт готов, ${context.firstName}! 📊`,
        [NotificationTrigger.FIRST_INTERVIEW]: `Отлично, ${context.firstName}! 🚀 Первое интервью пройдено!`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `Привет, ${context.firstName}! 🎯 Один вопрос: вы сейчас активно ищете работу, готовитесь к собеседованиям или учитесь?`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, в поиске работы важна регулярная практика! 💪 Попробуйте mock-интервью сегодня.`,
      },
      en: {
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `Hey ${context.firstName}! 👋 Your interview is still in progress. Want to continue?`,
        [NotificationTrigger.LONG_ABSENCE]: `Hey ${context.firstName}! 🌟 We missed you. Ready to practice?`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, practice makes perfect! 💪 I believe you'll do better next time.`,
        [NotificationTrigger.ACHIEVEMENT]: `Congratulations, ${context.firstName}! 🎉 Amazing achievement!`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `Your weekly report is ready, ${context.firstName}! 📊`,
        [NotificationTrigger.FIRST_INTERVIEW]: `Awesome, ${context.firstName}! 🚀 First interview completed!`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `Hey ${context.firstName}! 🎯 Quick question: are you actively job hunting, preparing for interviews, or learning?`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, consistent practice is key in job search! 💪 Try a mock interview today.`,
      },
    };

    const lang = templates[context.language] ? context.language : 'uz';
    const content = templates[lang][trigger] || templates[lang][NotificationTrigger.LONG_ABSENCE];

    this.logger.warn(`Using fallback template for trigger=${trigger}, lang=${lang}`);

    return {
      content,
      model: 'fallback-template',
      tokensUsed: 0,
    };
  }
}
