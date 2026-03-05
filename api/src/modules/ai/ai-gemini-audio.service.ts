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
import {
  buildLiveInterviewAudioPrompt,
  buildTranscriptionOnlyPrompt,
  LiveInterviewContext as CentralizedLiveInterviewContext,
} from '@common/constants/ai-prompts.constant';

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

/**
 * Parameters for transcription-only audio processing
 */
export interface TranscribeAudioParams {
  /** Base64 encoded audio data */
  audioBase64: string;
  /** Audio MIME type (e.g., 'audio/ogg') */
  mimeType: string;
  /** User language (uz/ru/en) */
  language: string;
}

/**
 * Response from Gemini transcription-only
 */
export interface GeminiTranscriptionResponse {
  /** Transcribed text */
  text: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Model used */
  model: string;
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

  // ═══════════════════════════════════════════════════════════════════════
  // Transcription-Only Method (for Mock Interviews)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Transcribe audio to text WITHOUT generating AI response.
   *
   * This is optimized for Mock Interviews where we only need the user's
   * spoken answer as text. All answers are collected and scored at the end.
   *
   * Benefits vs processLiveAudio():
   * - ~3x fewer tokens (no AI response generated)
   * - ~2x faster (smaller prompt, shorter response)
   * - Lower cost per voice answer
   *
   * @param params - Transcription parameters
   * @returns Transcribed text with metadata
   * @throws BadRequestException if service is disabled
   */
  async transcribeAudio(params: TranscribeAudioParams): Promise<GeminiTranscriptionResponse> {
    const startTime = Date.now();

    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Gemini Audio Service is not enabled. Set GEMINI_AUDIO_ENABLED=true in environment.',
      );
    }

    if (!params.audioBase64 || params.audioBase64.length === 0) {
      throw new BadRequestException('Audio data is empty');
    }

    const maxBase64Size = 10 * 1024 * 1024;
    if (params.audioBase64.length > maxBase64Size) {
      throw new BadRequestException(
        `Audio file too large: ${(params.audioBase64.length / 1024 / 1024).toFixed(2)}MB (max: 10MB)`,
      );
    }

    const model = this.getModel();
    const audioFormat = getGeminiAudioFormatSafe(params.mimeType);
    const transcriptionPrompt = buildTranscriptionOnlyPrompt(params.language);

    this.logger.debug(
      `Transcribing audio (mock interview): model=${model}, format=${audioFormat}, lang=${params.language}, size=${(params.audioBase64.length / 1024).toFixed(1)}KB`,
    );

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callGeminiWithTimeout(
          model,
          transcriptionPrompt,
          params.audioBase64,
          audioFormat,
          20000, // 20s timeout (transcription is faster)
        );

        const processingTime = Date.now() - startTime;
        const text = response.choices[0]?.message?.content || '';

        if (!text.trim()) {
          this.logger.warn('Gemini transcription returned empty, may need retry');
          if (attempt < maxRetries) {
            continue;
          }
        }

        this.logger.log(
          `Gemini transcription done: ${processingTime}ms, tokens=${response.usage?.total_tokens || 'N/A'}, attempt=${attempt}`,
        );

        return {
          text: text.trim(),
          processingTime,
          model,
        };
      } catch (error: any) {
        lastError = error;
        const processingTime = Date.now() - startTime;
        const isRetryable = this.isRetryableError(error);

        this.logger.warn(
          `Gemini transcription attempt ${attempt}/${maxRetries} failed after ${processingTime}ms: ${error.message} (retryable: ${isRetryable})`,
        );

        if (!isRetryable || attempt >= maxRetries) {
          break;
        }

        await this.sleep(1000 * attempt);
      }
    }

    const processingTime = Date.now() - startTime;
    this.logger.error(
      `Gemini transcription failed after ${processingTime}ms and ${maxRetries} attempts: ${lastError?.message}`,
      lastError?.stack,
    );

    throw new BadRequestException(
      `Audio transcription failed: ${lastError?.message || 'Unknown error'}`,
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
   * Uses centralized prompt from ai-prompts.constant.ts
   */
  private buildContextPrompt(context: LiveInterviewContext, lang: string): string {
    return buildLiveInterviewAudioPrompt(lang, context as CentralizedLiveInterviewContext);
  }
}
