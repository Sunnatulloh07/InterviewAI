import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import { createOpenAIClient } from '@common/utils/openai-client.factory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscribeDto, TranscriptionResponseDto } from './dto/transcribe.dto';
import axios from 'axios';
import FormData from 'form-data';

@Injectable()
export class AiSttService {
  private readonly logger = new Logger(AiSttService.name);
  private readonly openai: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
    if (!this.openai) {
      this.logger.warn('OpenAI API key not configured. STT features will be disabled.');
    }
  }

  /**
   * Transcribe audio to text using Whisper API or OpenRouter audio model
   */
  /**
   * Transcribe audio to text using Hybrid Routing (Aisha vs OpenAI)
   * Cost Optimization:
   * - Uzbek ('uz') -> Aisha STT (Best quality, ~1000 UZS/min)
   * - English/Russian ('en', 'ru') -> OpenAI Whisper (Great quality, ~75 UZS/min - 13x cheaper)
   */
  async transcribe(dto: TranscribeDto): Promise<TranscriptionResponseDto> {
    const startTime = Date.now();
    const language = dto.language || 'en';

    // Decode base64 audio data
    const audioBuffer = this.decodeAudioData(dto.audioData);

    this.logger.log(`Processing transcription request. Language: ${language}`);

    // Strategy 1: Use Aisha STT for Uzbek Language (High Quality)
    if (language === 'uz') {
      const result = await this.tryAishaTranscription(audioBuffer, dto, startTime);
      if (result) {
        return result;
      }
      this.logger.warn(`Aisha STT unavailable/failed for Uzbek. Falling back to OpenAI.`);
    } else {
      this.logger.log(`Routing to OpenAI Whisper (Cost-Effective for ${language})`);
    }

    // Strategy 2: Use OpenAI Whisper (Standard / Fallback)
    return await this.fallbackToOpenAI(audioBuffer, dto, startTime);
  }

  /**
   * Attempt to transcribe using Aisha STT. Returns null if disabled or fails.
   */
  private async tryAishaTranscription(
    audioBuffer: Buffer, 
    dto: TranscribeDto, 
    startTime: number
  ): Promise<TranscriptionResponseDto | null> {
    const aishaEnabled = this.configService.get<string>('AISHA_STT_ENABLED') === 'true';
    const aishaApiKey = this.configService.get<string>('AISHA_API_KEY');

    if (!aishaEnabled || !aishaApiKey) {
      this.logger.warn(`Aisha STT skipped: Enabled=${aishaEnabled}, HasKey=${!!aishaApiKey}`);
      return null;
    }

    try {
      this.logger.log(`Routing to Aisha STT (Language: ${dto.language})`);
      return await this.transcribeWithAisha(audioBuffer, dto, startTime);
    } catch (error: any) {
      this.logger.warn(
        `Aisha STT failed: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Fallback logic for OpenAI (Whisper / OpenRouter)
   */
  private async fallbackToOpenAI(
    audioBuffer: Buffer, 
    dto: TranscribeDto, 
    startTime: number
  ): Promise<TranscriptionResponseDto> {
    if (!this.openai) {
      throw new BadRequestException(
        'STT service fallback (OpenAI) is not configured. Please configure OPENAI_API_KEY.',
      );
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const isOpenRouterConfigured =
      apiKey?.startsWith('sk-or-v1-') ||
      this.configService.get<string>('OPENROUTER_ENABLED') === 'true';

    // 1. Try OpenRouter if configured
    if (isOpenRouterConfigured) {
      try {
        this.logger.log('Using OpenRouter for audio transcription');
        return await this.transcribeWithOpenRouter(audioBuffer, dto, startTime);
      } catch (error: any) {
        // Only fallback to direct OpenAI if it's a payment issue (402) AND we have a fallback key
        const isPaymentError = error.response?.status === 402;
        const hasDirectOpenAIKey = !apiKey?.startsWith('sk-or-v1-');

        if (isPaymentError && hasDirectOpenAIKey) {
           this.logger.warn('OpenRouter payment required. Falling back to direct OpenAI Whisper...');
           // Fall through to direct OpenAI
        } else {
           throw error; // Re-throw if it's not a recoverable error
        }
      }
    }

    // 2. Direct OpenAI Whisper
    this.logger.log('Using Standard OpenAI Whisper');
    return await this.transcribeWithOpenAI(audioBuffer, dto, startTime);
  }

  /**
   * Transcribe using Aisha STT API
   * Aisha provides high-quality Uzbek, Russian, English transcription
   * Reference: https://aisha.group/uz/api-documentation
   */
  private async transcribeWithAisha(
    audioBuffer: Buffer,
    dto: TranscribeDto,
    startTime: number,
  ): Promise<TranscriptionResponseDto> {
    const aishaApiKey = this.configService.get<string>('AISHA_API_KEY');
    const aishaApiUrl =
      this.configService.get<string>('AISHA_API_URL') || 'https://back.aisha.group/api/v2';
    const webhookUrl = this.configService.get<string>('AISHA_WEBHOOK_URL');

    if (!aishaApiKey) {
      throw new Error('Aisha API key not configured');
    }

    // Map language codes (Aisha uses: uz, en, ru)
    const languageMap: Record<string, string> = {
      uz: 'uz',
      en: 'en',
      ru: 'ru',
      uzbek: 'uz',
      english: 'en',
      russian: 'ru',
    };
    const aishaLanguage = languageMap[dto.language || 'uz'] || 'uz';

    // Detect audio format from buffer
    const audioFormat = this.detectAudioFormat(audioBuffer);
    const fileExtension = audioFormat === 'mp3' ? 'mp3' : audioFormat === 'wav' ? 'wav' : 'ogg';

    try {
      // Create FormData with audio file
      const formData = new FormData();

      // Create a temporary file for upload with proper extension
      const tempFilePath = await this.createTempFile(audioBuffer, fileExtension);

      try {
        // Add audio file with proper filename
        const fileName = `audio.${fileExtension}`;
        formData.append('audio', fs.createReadStream(tempFilePath), fileName);

        // Add parameters
        formData.append('language', aishaLanguage);
        formData.append('title', dto.prompt || 'Interview Transcription');

        // Add webhook if configured
        if (webhookUrl) {
          formData.append('webhook_notification_url', webhookUrl);
        }

        this.logger.debug(
          `Sending audio to Aisha STT: format=${fileExtension}, language=${aishaLanguage}, size=${audioBuffer.length} bytes`,
        );

        // Send POST request to Aisha STT
        const response = await axios.post(`${aishaApiUrl}/stt/post/`, formData, {
          headers: {
            'x-api-key': aishaApiKey,
            ...formData.getHeaders(),
          },
          timeout: 120000, // 2 minutes timeout for upload
        });

        // Log full response for debugging
        this.logger.debug('Aisha STT POST response:', JSON.stringify(response.data, null, 2));

        // Aisha API returns both: id (numeric) and task_id (UUID)
        // GET endpoint needs numeric ID, so prioritize id over task_id
        const numericId = response.data?.id;
        const uuidTaskId = response.data?.task_id || response.data?.taskId;

        // Always use numeric ID if available (required for GET endpoint)
        let taskId: string;
        if (numericId !== undefined && numericId !== null) {
          taskId = String(numericId);
          this.logger.log(
            `Aisha STT task created: numeric ID=${taskId}, UUID=${uuidTaskId || 'N/A'}`,
          );
        } else if (uuidTaskId) {
          // Fallback to UUID if numeric ID not available
          taskId = String(uuidTaskId);
          this.logger.warn(
            `Aisha STT returned only UUID: ${taskId}. GET endpoint may need numeric ID. Will try UUID first.`,
          );
        } else {
          this.logger.error('Aisha STT response:', JSON.stringify(response.data, null, 2));
          throw new Error('No task_id or id received from Aisha STT API');
        }

        // Calculate max polling attempts based on audio size
        // Optimized for speed: Aisha processes quickly, so we use shorter timeouts
        // Rough estimate: 5-10 seconds per MB for processing (optimized estimate)
        // Minimum 30 attempts (30 seconds), maximum 120 attempts (2 minutes) with 1s polling
        const audioSizeMB = audioBuffer.length / (1024 * 1024);
        const estimatedSeconds = Math.max(5, Math.ceil(audioSizeMB * 10)); // 10 seconds per MB (optimized)
        const maxAttempts = Math.min(120, Math.max(30, estimatedSeconds)); // Poll every 1 second

        // Poll for completion (Aisha processes asynchronously via Celery)
        const transcription = await this.pollAishaTranscription(
          taskId,
          aishaApiUrl,
          aishaApiKey,
          maxAttempts,
        );

        const duration = (Date.now() - startTime) / 1000;
        this.logger.log(
          `Aisha transcription completed in ${duration.toFixed(2)}s (task: ${taskId})`,
        );

        return {
          text: transcription.text || '',
          language: aishaLanguage,
          confidence: transcription.confidence || 0.95,
          duration: transcription.duration || duration,
          segments: [], // Aisha doesn't provide segments
        };
      } finally {
        // Clean up temp file
        await this.deleteTempFile(tempFilePath);
      }
    } catch (error: any) {
      this.logger.error(`Aisha STT failed: ${error.message}`, error.stack);

      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new BadRequestException(
          'Aisha API key is invalid or unauthorized. Please check your AISHA_API_KEY.',
        );
      }

      if (error.response?.status === 400) {
        const errorMessage =
          error.response?.data?.message || error.response?.data?.error || 'Bad request';
        throw new BadRequestException(
          `Aisha STT request failed: ${errorMessage}. Please check audio format and language.`,
        );
      }

      if (error.response?.status === 413) {
        throw new BadRequestException(
          'Audio file is too large for Aisha STT. Please use a shorter audio clip.',
        );
      }

      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        throw new BadRequestException(
          'Aisha STT service is unavailable. Please try again later or use OpenAI/OpenRouter fallback.',
        );
      }

      throw error;
    }
  }

  /**
   * Poll Aisha STT for transcription completion
   * Aisha processes audio asynchronously via Celery, so we need to poll for results
   */
  private async pollAishaTranscription(
    taskId: string,
    apiUrl: string,
    apiKey: string,
    maxAttempts: number,
  ): Promise<any> {
    // Optimized: Reduced polling interval from 2s to 1s for faster response
    // Aisha API processes quickly, so 1s interval is sufficient
    const pollInterval = 1000; // 1 second between polls (optimized for speed)
    let lastStatus = 'unknown';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Aisha API may need numeric ID, but we might have UUID
        // Try both formats if first attempt fails
        let response;
        try {
          response = await axios.get(`${apiUrl}/stt/get/${taskId}/`, {
            headers: {
              'x-api-key': apiKey,
            },
            timeout: 10000, // 10 seconds timeout per request
          });
        } catch (getError: any) {
          // If 400 error with "ID raqam bo'lishi kerak" message, try alternative endpoint
          if (
            getError.response?.status === 400 &&
            (getError.response?.data?.message?.includes('ID') ||
              getError.response?.data?.error?.includes('ID'))
          ) {
            // Try without trailing slash or with different format
            this.logger.warn(
              `Aisha GET failed with ID format error. Trying alternative endpoint format...`,
            );
            try {
              response = await axios.get(`${apiUrl}/stt/get/${taskId}`, {
                headers: {
                  'x-api-key': apiKey,
                },
                timeout: 10000,
              });
            } catch (_altError: any) {
              // If still fails, try listing all transcripts and find by UUID
              this.logger.warn(
                `Alternative endpoint also failed. Trying to list transcripts and find by UUID...`,
              );
              const listResponse = await axios.get(`${apiUrl}/stt/get/`, {
                headers: {
                  'x-api-key': apiKey,
                },
                timeout: 10000,
              });

              // Find transcript by UUID in the list
              const transcripts = listResponse.data?.results || listResponse.data || [];
              const found = Array.isArray(transcripts)
                ? transcripts.find((t: any) => t.task_id === taskId || t.id === taskId)
                : null;

              if (found) {
                // Use the numeric ID from the found transcript
                const numericId = found.id || found.task_id;
                this.logger.log(
                  `Found transcript in list. Using numeric ID: ${numericId} for polling.`,
                );
                response = await axios.get(`${apiUrl}/stt/get/${numericId}/`, {
                  headers: {
                    'x-api-key': apiKey,
                  },
                  timeout: 10000,
                });
              } else {
                throw getError; // Re-throw original error
              }
            }
          } else {
            throw getError; // Re-throw if not ID format error
          }
        }

        const status = (
          response.data?.status ||
          response.data?.state ||
          'processing'
        ).toUpperCase();
        // Aisha API may return text in different fields: text, transcription, result, transcript_text
        const text =
          response.data?.text ||
          response.data?.transcription ||
          response.data?.result ||
          response.data?.transcript_text ||
          response.data?.transcript;
        const error = response.data?.error || response.data?.message;

        // Log full response for SUCCESS status to debug
        if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'DONE') {
          this.logger.debug(
            `Aisha STT task ${taskId} status: ${status}, response keys: ${Object.keys(response.data).join(', ')}`,
          );
          if (!text || text.trim() === '') {
            this.logger.warn(
              `Aisha STT task ${taskId} status is ${status} but text is empty. Full response: ${JSON.stringify(response.data, null, 2)}`,
            );
          }
        }

        // Log status changes
        if (status !== lastStatus) {
          this.logger.debug(`Aisha STT task ${taskId} status changed: ${lastStatus} → ${status}`);
          lastStatus = status;
        }

        // Check if completed - Aisha uses "SUCCESS" status (uppercase)
        if (
          status === 'COMPLETED' ||
          status === 'DONE' ||
          status === 'SUCCESS' ||
          (text && text.trim() !== '')
        ) {
          // If status is SUCCESS but text is empty, wait a bit more (text might be processing)
          if (
            (status === 'SUCCESS' || status === 'COMPLETED' || status === 'DONE') &&
            (!text || text.trim() === '')
          ) {
            // Wait a bit more for text to be available
            if (attempt < maxAttempts - 5) {
              // Only wait if we have attempts left
              this.logger.debug(
                `Aisha STT task ${taskId} status is ${status} but text not ready yet. Waiting...`,
              );
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
              continue;
            } else {
              // Last few attempts - return empty text
              this.logger.warn(
                `Aisha STT task ${taskId} status is ${status} but text is still empty after ${attempt} attempts. Returning empty text.`,
              );
              return {
                text: '',
                confidence: response.data?.confidence || 0.95,
                duration: response.data?.duration || response.data?.audio_duration,
              };
            }
          }

          // Text is available
          const finalText = (text || '').trim();
          this.logger.log(
            `Aisha STT task ${taskId} completed successfully. Text length: ${finalText.length} characters`,
          );
          return {
            text: finalText,
            confidence: response.data?.confidence || 0.95,
            duration: response.data?.duration || response.data?.audio_duration,
          };
        }

        // Check if failed
        if (status === 'failed' || status === 'error' || status === 'rejected' || error) {
          const errorMessage = error || response.data?.error_message || 'Unknown error';
          throw new Error(`Aisha STT task failed: ${errorMessage}`);
        }

        // Still processing - wait and retry
        // Log less frequently to reduce overhead
        if (attempt % 15 === 0) {
          // Log every 15th attempt (every ~15 seconds) to reduce logging overhead
          this.logger.debug(
            `Aisha STT task ${taskId} status: ${status || 'processing'}. Attempt ${attempt + 1}/${maxAttempts}`,
          );
        }
        // Use optimized polling interval
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        // If it's the last attempt, throw the error
        if (attempt === maxAttempts - 1) {
          if (error.response?.status === 404) {
            throw new Error(
              `Aisha STT task ${taskId} not found. It may have expired or been deleted.`,
            );
          }
          throw error;
        }

        // Retry on network errors
        if (
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNRESET'
        ) {
          this.logger.warn(
            `Aisha STT polling attempt ${attempt + 1} failed (${error.code}), retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        } else if (error.response?.status >= 500) {
          // Retry on server errors
          this.logger.warn(
            `Aisha STT server error (${error.response.status}), retrying... (attempt ${attempt + 1}/${maxAttempts})`,
          );
          await new Promise((resolve) => setTimeout(resolve, pollInterval * 2)); // Wait longer for server errors
        } else {
          // For other errors (400, 401, 403, 404), throw immediately
          throw error;
        }
      }
    }

    throw new Error(
      `Aisha STT transcription timeout after ${maxAttempts} attempts (~${(maxAttempts * pollInterval) / 1000}s). Task ID: ${taskId}`,
    );
  }

  /**
   * Transcribe using OpenAI's direct audio transcription API
   */
  private async transcribeWithOpenAI(
    audioBuffer: Buffer,
    dto: TranscribeDto,
    startTime: number,
  ): Promise<TranscriptionResponseDto> {
    // Create temporary file for audio
    const tempFilePath = await this.createTempFile(audioBuffer);

    try {
      // Transcribe using Whisper
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
  }

  /**
   * Transcribe using OpenRouter's audio model via chat/completions
   */
  private async transcribeWithOpenRouter(
    audioBuffer: Buffer,
    dto: TranscribeDto,
    startTime: number,
  ): Promise<TranscriptionResponseDto> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    const httpReferer = this.configService.get<string>('OPENROUTER_HTTP_REFERER');
    const xTitle = this.configService.get<string>('OPENROUTER_X_TITLE');

    // Convert audio buffer to base64
    const base64Audio = audioBuffer.toString('base64');

    // Determine audio format
    // Telegram voice messages are typically OGG/OPUS, but OpenRouter might need different format
    // Try to detect format from buffer or use default
    let audioFormat = 'ogg'; // Default for Telegram voice messages

    // Check buffer header to detect format
    const header = audioBuffer.slice(0, 4).toString('hex');
    if (header.startsWith('52494646') || header.startsWith('464f524d')) {
      // WAV or AIFF format
      audioFormat = 'wav';
    } else if (header.startsWith('4f676753')) {
      // OGG format
      audioFormat = 'ogg';
    } else if (header.startsWith('fff3') || header.startsWith('fffb')) {
      // MP3 format
      audioFormat = 'mp3';
    }

    // Try multiple formats if one fails (Telegram voice messages might be OGG, but OpenRouter might need WAV)
    const formatsToTry = [audioFormat, 'wav', 'ogg', 'mp3', 'm4a'];
    let lastError: any = null;

    for (const format of formatsToTry) {
      try {
        this.logger.debug(`Trying OpenRouter transcription with format: ${format}`);

        // Use OpenRouter's chat/completions endpoint with audio model
        const response = await axios.post(
          `${baseUrl}/chat/completions`,
          {
            model: 'openai/gpt-4o-audio-preview',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text:
                      dto.prompt ||
                      'Transcribe this audio to text. Return only the transcribed text, nothing else.',
                  },
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: base64Audio,
                      format: format,
                    },
                  },
                ],
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              ...(httpReferer && { 'HTTP-Referer': httpReferer }),
              ...(xTitle && { 'X-Title': xTitle }),
            },
            timeout: 60000, // 60 seconds timeout for audio processing
          },
        );

        const duration = (Date.now() - startTime) / 1000;
        const transcriptionText = response.data.choices[0]?.message?.content || '';

        if (!transcriptionText || transcriptionText.trim() === '') {
          this.logger.warn(
            `OpenRouter returned empty transcription for format ${format}, trying next format...`,
          );
          lastError = new Error('Empty transcription response');
          continue;
        }

        this.logger.log(
          `OpenRouter transcription completed in ${duration}s with format: ${format}`,
        );

        // Parse response
        const responseDto: TranscriptionResponseDto = {
          text: transcriptionText.trim(),
          language: dto.language || 'en',
          confidence: 0.9, // OpenRouter doesn't provide confidence scores
          duration: duration,
          segments: [], // OpenRouter doesn't provide segments
        };

        return responseDto;
      } catch (error: any) {
        lastError = error;
        const statusCode = error.response?.status;
        this.logger.warn(
          `OpenRouter transcription failed with format ${format}: ${error.message}. Status: ${statusCode}`,
        );

        // If it's a 402 (Payment Required), don't retry with different formats
        // This means the API key doesn't have credits or the model requires payment
        if (statusCode === 402) {
          this.logger.error(
            `OpenRouter transcription failed: Payment required (402). Insufficient credits or model requires payment.`,
          );
          // Try to fallback to OpenAI's direct Whisper API if available
          // Check if we have a valid OpenAI key (not OpenRouter key)
          const isActuallyOpenRouterKey = apiKey?.startsWith('sk-or-v1-');
          if (!isActuallyOpenRouterKey && this.openai) {
            this.logger.log(
              'Falling back to OpenAI Whisper API due to OpenRouter payment issue...',
            );
            try {
              return await this.transcribeWithOpenAI(audioBuffer, dto, startTime);
            } catch (fallbackError: any) {
              this.logger.error(`OpenAI Whisper fallback also failed: ${fallbackError.message}`);
              throw new BadRequestException(
                `Audio transcription failed. OpenRouter requires payment (insufficient credits). Please add credits to your OpenRouter account or use an OpenAI API key directly.`,
              );
            }
          } else {
            throw new BadRequestException(
              `Audio transcription failed. OpenRouter requires payment (insufficient credits). Please add credits to your OpenRouter account at https://openrouter.ai/credits`,
            );
          }
        }

        // If it's a 405 or 400 error, the format might be wrong, try next format
        if (statusCode === 405 || statusCode === 400) {
          continue; // Try next format
        }

        // For other errors (401, 403, 500, etc.), don't retry with different formats
        if (statusCode && statusCode !== 404) {
          break;
        }
      }
    }

    // If all formats failed, try OpenAI fallback if available
    const isActuallyOpenRouterKey = apiKey?.startsWith('sk-or-v1-');
    if (!isActuallyOpenRouterKey && this.openai) {
      this.logger.log('OpenRouter failed, falling back to OpenAI Whisper API...');
      try {
        return await this.transcribeWithOpenAI(audioBuffer, dto, startTime);
      } catch (fallbackError: any) {
        this.logger.error(`OpenAI Whisper fallback also failed: ${fallbackError.message}`);
      }
    }

    // If all formats failed, throw the last error
    this.logger.error(
      `OpenRouter transcription failed with all formats. Last error: ${lastError?.message}`,
      lastError?.stack,
    );
    throw new BadRequestException(
      `Audio transcription failed. OpenRouter audio model may not be available or audio format is not supported. Error: ${lastError?.message || 'Unknown error'}`,
    );
  }

  /**
   * Decode base64 audio data
   */
  private decodeAudioData(audioData: string): Buffer {
    try {
      // Remove data URL prefix if present
      const base64Data = audioData.replace(/^data:audio\/[a-z]+;base64,/, '');
      return Buffer.from(base64Data, 'base64');
    } catch (_error) {
      throw new BadRequestException('Invalid audio data format');
    }
  }

  /**
   * Detect audio format from buffer header
   */
  private detectAudioFormat(buffer: Buffer): string {
    if (buffer.length < 4) {
      return 'ogg'; // Default for Telegram voice messages
    }

    const header = buffer.slice(0, 4).toString('hex').toLowerCase();
    const headerStr = buffer.slice(0, 12).toString('ascii', 0, 12);

    // MP3 format detection
    if (header.startsWith('fff3') || header.startsWith('fffb') || header.startsWith('494433')) {
      return 'mp3';
    }

    // WAV format detection (RIFF...WAVE)
    if (header.startsWith('52494646') && headerStr.includes('WAVE')) {
      return 'wav';
    }

    // OGG format detection (OggS)
    if (header.startsWith('4f676753')) {
      return 'ogg';
    }

    // M4A/AAC format detection
    if (header.startsWith('00000020') || headerStr.includes('ftyp')) {
      return 'm4a';
    }

    // FLAC format detection
    if (headerStr.startsWith('fLaC')) {
      return 'flac';
    }

    // Default to OGG (common for Telegram voice messages)
    return 'ogg';
  }

  /**
   * Create temporary file for audio processing
   */
  private async createTempFile(buffer: Buffer, extension: string = 'webm'): Promise<string> {
    const tempDir = os.tmpdir();
    const fileName = `audio-${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
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
    } catch (_error) {
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
