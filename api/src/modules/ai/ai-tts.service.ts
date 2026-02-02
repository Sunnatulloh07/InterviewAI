import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { OpenAI } from 'openai';

@Injectable()
export class AiTtsService {
  private readonly logger = new Logger(AiTtsService.name);
  private readonly openai: OpenAI | null;
  private readonly cache: Cache;
  private readonly defaultModel = 'tts-1';
  private readonly defaultVoice = 'alloy';
  private readonly cacheTTL = 60 * 60 * 24; // 24 hours

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) cache: Cache,
  ) {
    this.cache = cache;

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('TTS Service initialized with OpenAI API');
    } else {
      this.openai = null;
      this.logger.warn('OPENAI_API_KEY not configured. TTS will be unavailable.');
    }
  }

  async isEnabled(): Promise<boolean> {
    return Promise.resolve(this.openai !== null);
  }

  async synthesize(
    text: string,
    options: {
      language?: string;
      voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
      speed?: number;
    } = {},
  ): Promise<{ audioBuffer: Buffer; duration: number }> {
    const startTime = Date.now();

    if (!this.isEnabled()) {
      throw new BadRequestException('TTS service is not enabled');
    }

    const { language = 'uz', voice = this.defaultVoice, speed = 1.0 } = options;

    const cacheKey = `tts:${this.hashText(text)}:${voice}:${language}`;
    const cached = await this.cache.get<Buffer>(cacheKey);

    if (cached) {
      this.logger.log(`Cache hit for text hash: ${this.hashText(text)}`);
      const duration = Date.now() - startTime;
      return { audioBuffer: cached, duration };
    }

    const mappedVoice = this.mapVoiceForLanguage(voice, language);

    try {
      const response = await this.openai!.audio.speech.create({
        model: this.defaultModel,
        voice: mappedVoice,
        input: text,
        speed: speed,
      });

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      await this.cache.set(cacheKey, audioBuffer, this.cacheTTL);

      const duration = Date.now() - startTime;
      this.logger.log(
        `TTS synthesis completed. Text length: ${text.length} chars, Duration: ${duration}ms`,
      );

      return { audioBuffer, duration };
    } catch (error: any) {
      this.logger.error(`TTS synthesis failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to generate speech: ${error.message}`);
    }
  }

  private mapVoiceForLanguage(voice: string, language: string): string {
    const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    if (!voices.includes(voice)) {
      return this.defaultVoice;
    }
    return voice;
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}
