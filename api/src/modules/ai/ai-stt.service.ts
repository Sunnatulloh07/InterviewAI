import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscribeDto, TranscriptionResponseDto } from './dto/transcribe.dto';

@Injectable()
export class AiSttService {
  private readonly logger = new Logger(AiSttService.name);
  private readonly openai: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const siteUrl = this.configService.get<string>('OPENAI_SITE_URL');
    const siteName = this.configService.get<string>('OPENAI_SITE_NAME');

    // Only initialize OpenAI if API key is provided and valid
    if (apiKey && apiKey.trim() && !apiKey.includes('your-') && !apiKey.includes('sk-***')) {
      const config: {
        apiKey: string;
        baseURL?: string;
        defaultHeaders?: Record<string, string>;
      } = {
        apiKey: apiKey.trim(),
      };

      // OpenRouter configuration
      if (baseURL && baseURL.includes('openrouter')) {
        config.baseURL = baseURL;
        config.defaultHeaders = {};

        // Add optional headers for OpenRouter rankings
        if (siteUrl) {
          config.defaultHeaders['HTTP-Referer'] = siteUrl;
        }
        if (siteName) {
          config.defaultHeaders['X-Title'] = siteName;
        }
      }

      this.openai = new OpenAI(config);
      this.logger.log('OpenAI client initialized via OpenRouter');
    } else {
      this.openai = null;
      this.logger.warn('OpenAI API key not configured. STT features will be disabled.');
    }
  }

  /**
   * Transcribe audio to text using Whisper API
   */
  async transcribe(dto: TranscribeDto): Promise<TranscriptionResponseDto> {
    // Check if OpenAI is configured
    if (!this.openai) {
      throw new BadRequestException(
        'STT service is not configured. Please configure OPENAI_API_KEY in environment variables.',
      );
    }

    const startTime = Date.now();

    try {
      // Decode base64 audio data
      const audioBuffer = this.decodeAudioData(dto.audioData);

      // Create temporary file for audio
      const tempFilePath = await this.createTempFile(audioBuffer);

      try {
        // Transcribe using Whisper (openai is already checked at method start)
        const transcription = await this.openai!.audio.transcriptions.create({
          file: fs.createReadStream(tempFilePath) as any,
          model: 'whisper-1',
          language: dto.language,
          prompt: dto.prompt,
          temperature: dto.temperature || 0,
          response_format: 'verbose_json',
        });

        const duration = (Date.now() - startTime) / 1000;

        this.logger.log(`Transcription completed in ${duration}s`);

        // Parse response
        const response: TranscriptionResponseDto = {
          text: transcription.text,
          language: (transcription as any).language || dto.language || 'en',
          confidence: this.calculateConfidence(transcription),
          duration: (transcription as any).duration || duration,
          segments: (transcription as any).segments?.map((seg: any, idx: number) => ({
            id: idx,
            start: seg.start,
            end: seg.end,
            text: seg.text,
            confidence: seg.no_speech_prob ? 1 - seg.no_speech_prob : 0.95,
          })),
        };

        return response;
      } finally {
        // Clean up temp file
        await this.deleteTempFile(tempFilePath);
      }
    } catch (error) {
      this.logger.error(`Transcription failed: ${error.message}`, error.stack);
      throw new BadRequestException('Audio transcription failed');
    }
  }

  /**
   * Decode base64 audio data
   */
  private decodeAudioData(audioData: string): Buffer {
    try {
      // Remove data URL prefix if present
      const base64Data = audioData.replace(/^data:audio\/[a-z]+;base64,/, '');
      return Buffer.from(base64Data, 'base64');
    } catch (error) {
      throw new BadRequestException('Invalid audio data format');
    }
  }

  /**
   * Create temporary file for audio processing
   */
  private async createTempFile(buffer: Buffer): Promise<string> {
    const tempDir = os.tmpdir();
    const fileName = `audio-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`;
    const filePath = path.join(tempDir, fileName);

    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  }

  /**
   * Delete temporary file
   */
  private async deleteTempFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      this.logger.warn(`Failed to delete temp file: ${filePath}`);
    }
  }

  /**
   * Calculate confidence score from transcription
   */
  private calculateConfidence(transcription: any): number {
    if (transcription.segments && transcription.segments.length > 0) {
      const avgConfidence =
        transcription.segments.reduce((sum: number, seg: any) => {
          return sum + (seg.no_speech_prob ? 1 - seg.no_speech_prob : 0.95);
        }, 0) / transcription.segments.length;
      return avgConfidence;
    }
    return 0.95; // Default confidence
  }
}
