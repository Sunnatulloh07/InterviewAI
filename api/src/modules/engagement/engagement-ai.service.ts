import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { NotificationTrigger } from './schemas/notification-log.schema';
import { EngagementUserContext, GeneratedMessage } from './dto/engagement.dto';
import { buildEngagementSystemPrompt } from '@common/constants/ai-prompts.constant';

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

  [NotificationTrigger.PROFILE_INCOMPLETE]: `
Foydalanuvchi default "junior" lavozimida qolgan. 
Ularning haqiqiy lavozimini aniqlash kerak (hozirgi, oldingi yoki o'qigan joydagi).
Qisqa, samimiy: 1-2 jumla. Bosim o'tkazmasdan so'ra.`,

  [NotificationTrigger.JOBSEEKER_INACTIVE]: `
Faol ish izlayotgan foydalanuvchi 1 kun botga kirmagan.
Qisqa motivatsiya ber: mock interview yoki skill oshirishga undov.
MAKSIMUM 2 jumla! G'ayratli, lekin bosim o'tkazmasdan.`,
};

// System prompts moved to centralized ai-prompts.constant.ts → buildEngagementSystemPrompt(language)

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
        ? { 'HTTP-Referer': 'https://getjobi.app', 'X-Title': 'Jobi' }
        : undefined,
    });

    // Use Z-AI GLM-4-32b if using OpenRouter (zhipu/glm-4.5-flash is not a valid OpenRouter model ID)
    this.model = isOpenRouter ? 'z-ai/glm-4-32b' : 'gpt-4o-mini';

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
    const systemPrompt = buildEngagementSystemPrompt(context.language);
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
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `${context.firstName}, intervyungiz hali tugallanmagan. Davom ettirasizmi? /interview`,
        [NotificationTrigger.LONG_ABSENCE]: `${context.firstName}, intervyu mashqlarini davom ettirishga tayyormisiz? /interview`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, doimiy mashq natijani yaxshilaydi. Yana bir intervyu sinab ko'ring. /interview`,
        [NotificationTrigger.ACHIEVEMENT]: `${context.firstName}, ajoyib natijaga erishdingiz! Davom eting. /stats`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `${context.firstName}, haftalik xulosangiz tayyor. O'rtacha ball: ${context.averageScore}%. /stats`,
        [NotificationTrigger.FIRST_INTERVIEW]: `${context.firstName}, birinchi intervyuni tugatdingiz! Natijani ko'ring: /stats`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `${context.firstName}, bir savol: hozirda faol ish izlayapsizmi, tayyorgarlik ko'rayapsizmi yoki bilimlaringizni oshirayapsizmi?`,
        [NotificationTrigger.PROFILE_INCOMPLETE]: `${context.firstName}, lavozimingizni aniqlaymizmi? Bu sizga mos savollar berish uchun muhim. /set_position`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, doimiy mashq muhim. Bugun intervyu o'tkazib ko'ring. /interview`,
      },
      ru: {
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `${context.firstName}, ваше интервью не завершено. Продолжить? /interview`,
        [NotificationTrigger.LONG_ABSENCE]: `${context.firstName}, готовы продолжить практику? /interview`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, регулярная практика улучшает результат. Попробуйте ещё раз. /interview`,
        [NotificationTrigger.ACHIEVEMENT]: `${context.firstName}, отличный результат! Продолжайте в том же духе. /stats`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `${context.firstName}, еженедельный отчёт готов. Средний балл: ${context.averageScore}%. /stats`,
        [NotificationTrigger.FIRST_INTERVIEW]: `${context.firstName}, первое интервью пройдено! Посмотрите результат: /stats`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `${context.firstName}, один вопрос: вы сейчас активно ищете работу, готовитесь к собеседованиям или учитесь?`,
        [NotificationTrigger.PROFILE_INCOMPLETE]: `${context.firstName}, уточним вашу должность? Это важно для подбора вопросов. /set_position`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, регулярная практика важна. Попробуйте интервью сегодня. /interview`,
      },
      en: {
        [NotificationTrigger.INCOMPLETE_INTERVIEW]: `${context.firstName}, your interview is not finished. Continue? /interview`,
        [NotificationTrigger.LONG_ABSENCE]: `${context.firstName}, ready to continue practicing? /interview`,
        [NotificationTrigger.SCORE_DECLINE]: `${context.firstName}, regular practice improves results. Try again. /interview`,
        [NotificationTrigger.ACHIEVEMENT]: `${context.firstName}, great result! Keep it up. /stats`,
        [NotificationTrigger.WEEKLY_PROGRESS]: `${context.firstName}, weekly report ready. Average score: ${context.averageScore}%. /stats`,
        [NotificationTrigger.FIRST_INTERVIEW]: `${context.firstName}, first interview completed! See results: /stats`,
        [NotificationTrigger.TRIAL_ENDING]: '', // Disabled: handled by trial-notification.service.ts
        [NotificationTrigger.ONBOARDING_SURVEY]: `${context.firstName}, quick question: are you actively job hunting, preparing for interviews, or learning?`,
        [NotificationTrigger.PROFILE_INCOMPLETE]: `${context.firstName}, let's set your position. This helps us provide relevant questions. /set_position`,
        [NotificationTrigger.JOBSEEKER_INACTIVE]: `${context.firstName}, regular practice matters. Try an interview today. /interview`,
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
