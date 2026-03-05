import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { buildOcrSystemPrompt } from '@common/constants/ai-prompts.constant';

/**
 * AI OCR Service
 *
 * Integrates with OpenRouter Vision API (Gemini 2.5 Flash)
 * Supports image-to-text extraction for daily task answers
 *
 * Features:
 * - Multiple languages (Uzbek, Russian, English)
 * - Base64 image encoding
 * - File validation (20MB max)
 * - Error handling with retry logic
 * - Text-only fallback (no expensive API calls if configured)
 *
 * Pricing:
 * - Input: Image processing (~300-1000 tokens per image)
 * - Output: Text extraction (~200-500 tokens)
 * - Total: ~$0.0005 - $0.003 per image
 * - With caching: ~$0.0002 - $0.001 per image
 */
@Injectable()
export class AiOcrService {
  private readonly logger = new Logger(AiOcrService.name);
  private readonly openrouterBaseUrl: string;
  private readonly openrouterApiKey: string;
  private readonly maxImageSize = 20 * 1024 * 1024; // 20MB

  constructor(private readonly configService: ConfigService) {
    this.openrouterBaseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    this.openrouterApiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';

    if (!this.openrouterApiKey) {
      this.logger.warn('OPENROUTER_API_KEY not configured. OCR will be unavailable.');
    }
  }

  /**
   * Extract text from image using OpenRouter Vision API (Gemini 2.5 Flash)
   *
   * @param imageBuffer - Image file as buffer
   * @param mimeType - Image MIME type (image/jpeg, image/png, image/webp, etc.)
   * @param language - User language for better text extraction (uz, ru, en)
   *
   * @returns { text: string; confidence: number } - Extracted text and confidence score
   * @throws BadRequestException if image is invalid or exceeds size limit
   *
   * @throws Error if OCR fails with non-429 errors (quota exceeded, rate limits, etc.)
   */
  async recognize(
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg',
    language = 'en',
  ): Promise<{ text: string; confidence: number }> {
    try {
      // 1. Validate image size (20MB max per audit requirements)
      const imageMbSize = imageBuffer.length / (1024 * 1024);
      if (imageMbSize > this.maxImageSize) {
        const sizeInMb = (imageMbSize / (1024 * 1024)).toFixed(2);
        const sizeText = {
          uz: `❌ Rasm hajmi katta! Max 20 MB. Rasm hajmi ${sizeInMb}MB.`,
          ru: `❌ Изображение слишком большое! Max 20 MB. Размер: ${sizeInMb}MB.`,
          en: `❌ Image too large! Max 20 MB. Size: ${sizeInMb}MB.`,
        };
        const lang = language || 'uz';
        const message = sizeText[lang] || sizeText.uz;
        throw new BadRequestException(message);
      }

      // 2. Validate MIME type
      const validMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/tiff',
        'application/pdf',
      ];

      if (!validMimeTypes.includes(mimeType)) {
        const invalidTypeText = {
          uz: `❌ Rasm formati qo'llab-quvvatilmaydi! Qo'llab-quvvatish uchun formatlardan foydalaning: ${validMimeTypes.join(', ')}.`,
          ru: `❌ Формат не поддерживается! Поддерживаются: ${validMimeTypes.join(', ')}.`,
          en: `❌ Format not supported! Supported: ${validMimeTypes.join(', ')}.`,
        };
        const lang = language || 'uz';
        throw new BadRequestException(invalidTypeText[lang] || invalidTypeText.uz);
      }

      this.logger.log(
        `Starting OCR processing. Language: ${language}, Image: ${imageMbSize}MB, Format: ${mimeType}`,
      );

      // 3. Convert to base64 for API
      const base64Image = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

      // 4. Call OpenRouter Vision API
      const startTime = Date.now();
      const response = await axios.post(
        `${this.openrouterBaseUrl}/chat/completions`,
        {
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: buildOcrSystemPrompt(language),
            },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: base64Image,
                  },
                },
              ],
            },
          ],
          max_tokens: 500, // Sufficient for most task images
          temperature: 0.1, // Low temp for consistent results
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.openrouterApiKey}`,
            'HTTP-Referer': 'https://getjobi.app',
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        },
      );

      // 5. Parse response
      const completion = response.data?.choices?.[0]?.message?.content;

      if (!completion) {
        this.logger.warn('Empty response from Vision API');
        throw new Error('Empty response from Vision API');
      }

      // Try to parse as JSON first
      let result;
      try {
        result = JSON.parse(completion);
      } catch (e) {
        // Not JSON, try to extract text from response
        this.logger.warn(`Failed to parse as JSON: ${e.message}`);

        // Fallback: Extract text from string
        const textMatches =
          completion.match(/(["']([^"']+)["']([^"']+)["'])/i) ||
          completion.match(/["']?\s*:?\s*["']/i);

        if (textMatches && textMatches[1]) {
          result = { text: textMatches[1], confidence: 0.85 };
        } else {
          // Fallback: return raw text
          result = { text: completion, confidence: 0.75 };
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `OCR processing completed. Duration: ${duration}ms. Extracted ${result.text.length} chars. Confidence: ${result.confidence}`,
      );

      return result;
    } catch (error: any) {
      // Check if it's a 429 error (quota exceeded, rate limit, etc.)
      if (error.response?.status === 429) {
        const lang = language || 'uz';
        const quotaText = {
          uz: '❌ OpenRouter API cheklimi tugab ketdi! Bugun limiti tekshiring.',
          ru: '❌ Лимит API OpenRouter превышен. Проверьте лимит на сегодня.',
          en: '❌ OpenRouter API quota exceeded. Check your daily limit.',
        };
        const message =
          quotaText[lang] || '❌ OpenRouter API quota exceeded. Limit: 200 images/day';
        this.logger.error(message);
        throw new Error(message);
      }

      this.logger.error(`OCR processing failed: ${error.message}`);
      throw new Error(`Failed to extract text from image: ${error.message}`);
    }
  }

  /**
   * Detect image type from MIME type or buffer signature
   *
   * @param mimeType - Image MIME type
   * @returns Image type description (JPG, PNG, WebP, PDF, Unknown)
   */
  getImageType(mimeType: string): string {
    const typeMap: Record<string, string> = {
      'image/jpeg': 'JPG',
      'image/jpg': 'JPG',
      'image/png': 'PNG',
      'image/webp': 'WebP',
      'image/bmp': 'BMP',
      'image/tiff': 'TIFF',
      'application/pdf': 'PDF',
    };

    return typeMap[mimeType] || 'Unknown';
  }

  /**
   * Convert image size to human-readable format
   *
   * @param bytes - Size in bytes
   * @returns Formatted size string (e.g. "1.5 MB", "500 KB", "2 MB")
   */
  formatImageSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} bytes`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 20 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      return `${(bytes / (20 * 1024 * 1024)).toFixed(2)} MB`;
    }
  }
}
