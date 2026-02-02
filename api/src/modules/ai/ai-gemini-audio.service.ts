import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import {
  createOpenAIClient,
  isGeminiAudioEnabled,
  getGeminiAudioModel,
  getGeminiAudioFormatSafe,
  isValidGeminiAudioFormat,
} from '@common/utils/openai-client.factory';

// ═══════════════════════════════════════════════════════════════════════════
// Types & Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Context for Live Interview audio processing
 */
export interface LiveInterviewContext {
  domain?: string;
  technologies?: string[];
  position?: string;
  company?: string;
  sessionId?: string;
}

/**
 * Response from Gemini audio processing
 */
export interface GeminiAudioResponse {
  /** AI-generated response text */
  text: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Model used for processing */
  model: string;
  /** Token usage (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Parameters for processing live audio
 */
export interface ProcessLiveAudioParams {
  /** Base64 encoded audio data */
  audioBase64: string;
  /** Audio MIME type (e.g., 'audio/ogg') */
  mimeType: string;
  /** Live interview context */
  context: LiveInterviewContext;
  /** User language (uz/ru/en) */
  language: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Service Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Service for processing audio using Gemini multimodal capabilities
 *
 * This service provides faster audio processing for Live Interviews by
 * sending audio directly to Gemini instead of using separate STT + LLM calls.
 *
 * @example
 * ```typescript
 * const response = await geminiAudioService.processLiveAudio({
 *   audioBase64: 'base64EncodedAudio...',
 *   mimeType: 'audio/ogg',
 *   context: { position: 'Senior Developer', company: 'Google' },
 *   language: 'uz',
 * });
 * console.log(response.text); // AI response
 * console.log(response.processingTime); // 3500 (ms)
 * ```
 */
@Injectable()
export class AiGeminiAudioService {
  private readonly logger = new Logger(AiGeminiAudioService.name);
  private readonly openai: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    this.openai = createOpenAIClient(this.configService);

    if (this.isEnabled()) {
      this.logger.log(`Gemini Audio Service initialized with model: ${this.getModel()}`);
    } else {
      this.logger.debug('Gemini Audio Service is disabled');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if Gemini audio processing is enabled and configured
   */
  isEnabled(): boolean {
    return isGeminiAudioEnabled(this.configService) && this.openai !== null;
  }

  
  /**
   * Get the configured Gemini model for audio processing
   */
  getModel(): string {
    return getGeminiAudioModel(this.configService);
  }

  /**
   * Process audio and generate AI response in a single call
   *
   * This is the main method for Live Interview audio processing.
   * It sends audio directly to Gemini, which:
   * 1. Transcribes the audio
   * 2. Understands the context
   * 3. Generates a professional response
   *
   * @param params - Audio processing parameters
   * @returns AI response with processing metadata
   * @throws BadRequestException if service is disabled or audio format unsupported
   */
  async processLiveAudio(params: ProcessLiveAudioParams): Promise<GeminiAudioResponse> {
    const startTime = Date.now();

    // Validate service is enabled
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Gemini Audio Service is not enabled. Set GEMINI_AUDIO_ENABLED=true in environment.',
      );
    }

    // Validate audio data exists
    if (!params.audioBase64 || params.audioBase64.length === 0) {
      throw new BadRequestException('Audio data is empty');
    }

    // Validate audio size (max 10MB in base64 ≈ 7.5MB raw)
    const maxBase64Size = 10 * 1024 * 1024; // 10MB
    if (params.audioBase64.length > maxBase64Size) {
      throw new BadRequestException(
        `Audio file too large: ${(params.audioBase64.length / 1024 / 1024).toFixed(2)}MB (max: 10MB)`,
      );
    }

    // Validate audio format (warn but continue)
    if (!isValidGeminiAudioFormat(params.mimeType)) {
      this.logger.warn(`Unsupported audio format: ${params.mimeType}, attempting anyway`);
    }

    const model = this.getModel();
    const audioFormat = getGeminiAudioFormatSafe(params.mimeType);
    const systemPrompt = this.buildContextPrompt(params.context, params.language);

    this.logger.debug(
      `Processing audio: model=${model}, format=${audioFormat}, lang=${params.language}, size=${(params.audioBase64.length / 1024).toFixed(1)}KB`,
    );

    // Retry configuration
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callGeminiWithTimeout(
          model,
          systemPrompt,
          params.audioBase64,
          audioFormat,
        );

        const processingTime = Date.now() - startTime;
        const text = response.choices[0]?.message?.content || '';

        // Validate response is not empty
        if (!text.trim()) {
          this.logger.warn('Gemini returned empty response, may need retry');
          if (attempt < maxRetries) {
            continue;
          }
        }

        this.logger.log(
          `Gemini audio processed: ${processingTime}ms, tokens=${response.usage?.total_tokens || 'N/A'}, attempt=${attempt}`,
        );

        return {
          text,
          processingTime,
          model,
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error: any) {
        lastError = error;
        const processingTime = Date.now() - startTime;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        this.logger.warn(
          `Gemini audio attempt ${attempt}/${maxRetries} failed after ${processingTime}ms: ${error.message} (retryable: ${isRetryable})`,
        );

        if (!isRetryable || attempt >= maxRetries) {
          break;
        }

        // Wait before retry (exponential backoff)
        await this.sleep(1000 * attempt);
      }
    }

    // All retries exhausted
    const processingTime = Date.now() - startTime;
    this.logger.error(
      `Gemini audio processing failed after ${processingTime}ms and ${maxRetries} attempts: ${lastError?.message}`,
      lastError?.stack,
    );

    throw new BadRequestException(
      `Audio processing failed: ${lastError?.message || 'Unknown error'}`,
    );
  }

  /**
   * Call Gemini API with timeout protection
   */
  private async callGeminiWithTimeout(
    model: string,
    systemPrompt: string,
    audioBase64: string,
    audioFormat: string,
    timeoutMs: number = 30000, // 30 second timeout
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.openai!.chat.completions.create(
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    systemPrompt +
                    '\n\n(DIQQAT: Quyida audio xabar ilova qilingan. Uni tinglang va javob bering.)',
                },
                // OpenRouter generic multimodal format (using image_url for audio data URI)
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${this.getMimeType(audioFormat)};base64,${audioBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 2048,
          temperature: 0.7,
        },
        { signal: controller.signal },
      );
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Helper to get MIME type for data URI
   */
  private getMimeType(format: string): string {
    const map: Record<string, string> = {
      mp3: 'audio/mp3',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };
    return map[format] || 'audio/ogg';
  }

  /**
   * Check if an error is retryable (transient)
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    // Rate limiting
    if (error.status === 429) {
      return true;
    }

    // Server errors (5xx)
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    // Timeout/abort
    if (error.name === 'AbortError') {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Private Methods
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Build context-aware system prompt for Live Interview
   *
   * This prompt instructs Gemini to:
   * 1. Transcribe the audio question
   * 2. Provide a professional answer
   * 3. Highlight key points
   */
  private buildContextPrompt(context: LiveInterviewContext, lang: string): string {
    const prompts: Record<string, string> = {
      uz: this.buildUzbekPrompt(context),
      ru: this.buildRussianPrompt(context),
      en: this.buildEnglishPrompt(context),
    };

    return prompts[lang] || prompts.en;
  }

  private buildUzbekPrompt(context: LiveInterviewContext): string {
    return `Siz Senior Software Engineer roli o'ynayapsiz. Siz AI emassiz, balki tajribali hamkasbimizsiz.
Intervyu oluvchi hozir real intervyuda va siz unga yordam beryapsiz.

📋 Kontext:
• Pozitsiya: ${context.position || "Noma'lum"}
• Kompaniya: ${context.company || "Noma'lum"}
• Texnologiyalar: ${context.technologies?.join(', ') || "Noma'lum"}

🎯 Vazifangiz:
1. Audio savolni eshitib, undagi **BARCHA savollarni** aniqlang. (Ko'pincha 2-3 ta savol bitta audioda bo'lishi mumkin).
2. Savollarni umumlashtirmang! Har biriga alohida-alohida, aniq javob bering.
3. Javobingiz xuddi 10 yillik tajribaga ega senior dasturchi kabi **ishonchli va tabiiy** chiqsin.
4. "Men AI modelman" yoki "Men yordam berishga tayyorman" kabi gaplarni ISHLATMANG.
5. Agar savol kod yozishni talab qilsa, albatta kod misolini keltiring.

📝 Javob strukturasi:

❓ Savol(lar):
[Eshitilgan barcha savollarni aniq yozing. Masalan: 1. ... 2. ...]

💡 Javob:
[Har bir savolga tartib bilan, professional javob bering. Har bir qismni yoriting.]

💻 Kod (agar kerak bo'lsa):
\`\`\`programming_language
// Kod shu yerda
\`\`\`

📌 Muhim maslahat:
[Bittagina eng muhim "senior tip" - masalan, performance, security yoki best practice haqida]

⚠️ MUHIM: Savolning mazmunini o'zgartirmang. Agar audioda 2 ta narsa so'ralgan bo'lsa, ikkalasiga ham javob bering!`;
  }

  private buildRussianPrompt(context: LiveInterviewContext): string {
    return `Вы выступаете в роли Senior Software Engineer. Вы не ИИ, а опытный коллега.
Пользователь сейчас на реальном интервью, и вы ему помогаете.

📋 Контекст:
• Позиция: ${context.position || 'Неизвестно'}
• Компания: ${context.company || 'Неизвестно'}
• Технологии: ${context.technologies?.join(', ') || 'Неизвестно'}

🎯 Ваша задача:
1. Прослушайте аудио и выявите **ВСЕ вопросы** (часто бывает 2-3 вопроса в одном аудио).
2. Не обобщайте вопросы! Отвечайте на каждый из них отдельно и четко.
3. Ответ должен звучать **уверенно и естественно**, как от разработчика с 10-летним опытом.
4. НЕ используйте фразы типа "Я языковая модель". Отвечайте сразу по сути.
5. Если вопрос требует написания кода, обязательно приведите пример.

📝 Структура ответа:

❓ Вопрос(ы):
[Точно запишите все услышанные вопросы. Например: 1. ... 2. ...]

💡 Ответ:
[Дайте профессиональный ответ на каждый вопрос по порядку. Раскройте каждую часть.]

💻 Код (если нужен):
\`\`\`programming_language
// Код здесь
\`\`\`

📌 Важный совет:
[Один самый важный "синьорский совет" - например, про производительность, безопасность или лучшие практики]

⚠️ ВАЖНО: Не меняйте смысл вопроса. Если в аудио спросили о двух вещах, ответьте на обе!`;
  }

  private buildEnglishPrompt(context: LiveInterviewContext): string {
    return `You are acting as a Senior Software Engineer. You are not an AI, but an experienced colleague.
The user is currently in a real interview and you are helping them.

📋 Context:
• Position: ${context.position || 'Unknown'}
• Company: ${context.company || 'Unknown'}
• Technologies: ${context.technologies?.join(', ') || 'Unknown'}

🎯 Your Task:
1. Listen to the audio and identify **ALL questions** asked (often there are 2-3 questions in one audio).
2. Do not summarize! Answer EACH question separately and clearly.
3. Your answer must sound **confident and natural**, like a developer with 10 years of experience.
4. DO NOT use AI phrases. Answer directly.
5. If the question requires code, explicitly provide a code example.

📝 Response Structure:

❓ Question(s):
[Transcribe all questions heard exactly. E.g.: 1. ... 2. ...]

💡 Answer:
[Provide a professional answer for each question in order. Cover every part.]

💻 Code (if needed):
\`\`\`programming_language
// Code here
\`\`\`

📌 Key Insight:
[One single most important senior tip - e.g., about performance, security, or best practices]

⚠️ IMPORTANT: Do not alter the meaning of the questions. If the audio asks two things, answer both!`;
  }
}
