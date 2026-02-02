import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * Recognize text from image buffer
   * Supports: PNG, JPG, BMP, PBM
   */
  async recognize(imageBuffer: Buffer, language = 'eng'): Promise<string> {
    try {
      this.logger.log(`Starting OCR processing (Language: ${language})...`);

      const worker = await createWorker(language);

      const {
        data: { text },
      } = await worker.recognize(imageBuffer);

      await worker.terminate();

      this.logger.log(`OCR processing completed. Extracted ${text.length} characters.`);
      return text;
    } catch (error) {
      this.logger.error(`OCR failed: ${error.message}`, error.stack);
      throw new Error(`Failed to extract text from image: ${error.message}`);
    }
  }
}
