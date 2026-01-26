import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/msword', // doc
    'text/plain',
  ];

  constructor(private readonly configService: ConfigService) {}

  /**
   * Validate file before processing
   */
  async validateFile(file: Express.Multer.File | { buffer: Buffer; size: number; mimetype: string; originalname: string }): Promise<boolean> {
    // 1. Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new BadRequestException(`File too large. Maximum size is 5MB.`);
    }

    // 2. Check MIME type
    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Invalid file type. Allowed: PDF, DOCX, TXT.`);
    }

    // 3. Magic Byte Validation (Deep check)
    const isSafe = this.validateMagicBytes(file.buffer, file.mimetype);
    if (!isSafe) {
      this.logger.warn(`Magic byte validation failed for file: ${file.originalname} (${file.mimetype})`);
      throw new BadRequestException('File integrity check failed. Please return a valid file.');
    }

    // 4. Scan for malicious content (basic text scan)
    if (file.mimetype === 'text/plain' || file.mimetype.includes('xml') || file.mimetype.includes('html')) {
        const content = file.buffer.toString('utf8');
        if (this.hasMaliciousContent(content)) {
            this.logger.warn(`Malicious content detected in file: ${file.originalname}`);
            throw new BadRequestException('Security check failed: Potentially unsafe content detected.');
        }
    }

    return true;
  }

  /**
   * Validate file magic bytes to ensure extension matches content
   */
  private validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
    if (!buffer || buffer.length < 4) return false;

    const hex = buffer.toString('hex', 0, 4).toUpperCase();

    // PDF: 25 50 44 46 (%PDF)
    if (mimetype === 'application/pdf') {
      return hex.startsWith('25504446');
    }

    // DOCX (Zip archive): 50 4B 03 04 (PK..)
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return hex.startsWith('504B0304');
    }

    // DOC (Legacy Word): D0 CF 11 E0
    if (mimetype === 'application/msword') {
      return hex.startsWith('D0CF11E0');
    }

    // TXT: No magic bytes, but check for null bytes which might indicate binary
    if (mimetype === 'text/plain') {
        // Simple heuristic: Text files shouldn't have too many null bytes at start
        // Accessing buffer directly
        for(let i=0; i<Math.min(buffer.length, 50); i++) {
            if(buffer[i] === 0x00) return false; // Binary file masquerading as text
        }
        return true;
    }

    return false;
  }

  /**
   * Scan text content for common malicious patterns (XSS, Injection)
   */
  private hasMaliciousContent(content: string): boolean {
    const dangerousPatterns = [
      /<script\b[^>]*>([\s\S]*?)<\/script>/gmi,
      /javascript:/gmi,
      /vbscript:/gmi,
      /onload\s*=/gmi,
      /onerror\s*=/gmi,
      /onclick\s*=/gmi,
      /eval\s*\(/gmi,
      /exec\s*\(/gmi,
      /system\s*\(/gmi,
      /passthru\s*\(/gmi,
      /shell_exec\s*\(/gmi,
    ];

    return dangerousPatterns.some(pattern => pattern.test(content));
  }
}
