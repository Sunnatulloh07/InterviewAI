import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mammoth from 'mammoth';
import { OcrService } from './ocr.service';
// pdf-parse uses CommonJS export, need to use require or dynamic import
const pdfParse = require('pdf-parse');

@Injectable()
export class CvParserService {
  private readonly logger = new Logger(CvParserService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ocrService: OcrService,
  ) {}

  /**
   * Parse CV file based on mime type
   */
  async parse(buffer: Buffer, mimeType: string): Promise<{ text: string; parsedData: any }> {
    let text: string;

    try {
      this.logger.debug(`Parsing file with mimeType: ${mimeType}`);

      switch (mimeType) {
        case 'application/pdf':
          text = await this.parsePdf(buffer);
          break;
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          text = await this.parseDocx(buffer);
          break;
        case 'text/plain':
          text = buffer.toString('utf-8');
          break;
        case 'image/jpeg':
        case 'image/png':
        case 'image/webp':
          // Start OCR for images
          text = await this.ocrService.recognize(buffer);
          break;
        default:
          throw new BadRequestException(
            'Unsupported file type. Please upload PDF, DOCX, or Image (JPG/PNG).',
          );
      }

      // Check if text is empty (especially after OCR or Scanned PDF)
      if (!text || text.trim().length < 50) {
        if (mimeType === 'application/pdf') {
          throw new BadRequestException(
            "PDF dan matn o'qib bo'lmadi (Scan qilingan bo'lishi mumkin). Iltimos, bu faylni Rasm (JPG/PNG) formatiga o'tkazib yuklang yoki Word faylidan foydalaning.",
          );
        }
        throw new BadRequestException(
          'Fayldan yetarli matn topilmadi. Sifati yaxshiroq fayl yuklang.',
        );
      }

      // Extract structured data from text
      const parsedData = await this.extractStructuredData(text);

      return { text, parsedData };
    } catch (error) {
      this.logger.error(`Failed to parse CV: ${error.message}`, error.stack);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to parse CV file');
    }
  }

  /**
   * Parse PDF file
   */
  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      // pdf-parse v2.4.5 uses PDFParse class which requires { data: buffer } in constructor
      const PDFParse = (pdfParse as any).PDFParse;

      if (!PDFParse || typeof PDFParse !== 'function') {
        this.logger.error(
          `PDFParse class not found. pdfParse type: ${typeof pdfParse}, Keys: ${Object.keys(
            pdfParse || {},
          )
            .slice(0, 10)
            .join(', ')}`,
        );
        throw new Error('PDFParse class not found in pdf-parse module');
      }

      // Create PDFParse instance with buffer data
      const pdfInstance = new PDFParse({
        data: buffer,
        verbosity: 0, // 0 = ERRORS only, 1 = WARNINGS, 2 = INFOS
      });

      // Get text from PDF
      const result = await pdfInstance.getText();

      if (!result || !result.text || result.text.trim().length < 50) {
        throw new BadRequestException(
          "Fayldan yettarli matn topilmadi. Sizning PDF faylingiz rasm (scanned) ko'rinishida bo'lishi mumkin. Iltimos, matn formatidagi PDF yoki Word fayl yuklang.",
        );
      }

      // Check if text mostly contains unreadable characters (encoding issue)
      // This is a basic check - scanned PDFs often return garbage characters or nothing
      const text = result.text.trim();

      return text;
    } catch (error: any) {
      this.logger.error(`PDF parsing failed: ${error.message}`, error.stack);

      // Provide more specific error messages
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Check for specific error types
      if (error.message?.includes('Invalid PDF') || error.message?.includes('corrupted')) {
        throw new BadRequestException(
          'Invalid or corrupted PDF file. Please check your file and try again.',
        );
      }

      if (
        error.message?.includes('password') ||
        error.message?.includes('encrypted') ||
        error.message?.includes('Password')
      ) {
        throw new BadRequestException(
          'PDF file is password protected. Please remove password protection and try again.',
        );
      }

      if (
        error.message?.includes('not found') ||
        error.message?.includes('not properly imported')
      ) {
        throw new BadRequestException(
          'PDF parsing service configuration error. Please contact support.',
        );
      }

      throw new BadRequestException(
        `Failed to parse PDF file: ${error.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Parse DOCX file
   */
  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });

      if (!result || !result.value) {
        throw new Error('DOCX parsing returned empty result');
      }

      return result.value;
    } catch (error: any) {
      this.logger.error(`DOCX parsing failed: ${error.message}`, error.stack);

      // Provide more specific error messages
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to parse DOCX file: ${error.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Extract structured data from text using regex patterns
   * In production, this should use OpenAI for better extraction
   */
  private async extractStructuredData(text: string): Promise<any> {
    const data = {
      personalInfo: this.extractPersonalInfo(text),
      summary: this.extractSummary(text),
      experience: this.extractExperience(text),
      education: this.extractEducation(text),
      skills: this.extractSkills(text),
      languages: this.extractLanguages(text),
      certifications: this.extractCertifications(text),
      projects: [],
    };

    return data;
  }

  /**
   * Extract personal information
   */
  private extractPersonalInfo(text: string): any {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
    const linkedinRegex = /linkedin\.com\/in\/[\w-]+/i;
    const githubRegex = /github\.com\/[\w-]+/i;

    const email = text.match(emailRegex)?.[0];
    const phone = text.match(phoneRegex)?.[0];
    const linkedin = text.match(linkedinRegex)?.[0];
    const github = text.match(githubRegex)?.[0];

    // Extract name (usually first line)
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    const name = lines[0]?.trim();

    return {
      name,
      email,
      phone,
      linkedin: linkedin ? `https://${linkedin}` : undefined,
      github: github ? `https://${github}` : undefined,
    };
  }

  /**
   * Extract summary/objective section
   */
  private extractSummary(text: string): string | undefined {
    const summaryRegex =
      /(SUMMARY|OBJECTIVE|PROFILE|ABOUT ME)[:\s]*\n([\s\S]{0,500}?)(?=\n\n|\n[A-Z])/i;
    const match = text.match(summaryRegex);
    return match?.[2]?.trim();
  }

  /**
   * Extract work experience
   */
  private extractExperience(text: string): any[] {
    // Simplified extraction - in production use OpenAI
    const experiences: any[] = [];
    const expSection = text.match(
      /(EXPERIENCE|WORK HISTORY|EMPLOYMENT)[:\s]*\n([\s\S]+?)(?=\n\n[A-Z]|$)/i,
    );

    if (expSection) {
      // Basic parsing logic
      const lines = expSection[2].split('\n').filter((l) => l.trim());
      let currentExp: any = null;

      for (const line of lines) {
        if (line.match(/\d{4}/)) {
          // Year found
          if (currentExp) experiences.push(currentExp);
          currentExp = {
            title: line.split('|')[0]?.trim() || 'Position',
            company: line.split('|')[1]?.trim() || 'Company',
            current: line.toLowerCase().includes('present'),
            description: '',
            achievements: [],
          };
        } else if (currentExp && line.trim().startsWith('-')) {
          currentExp.achievements.push(line.replace(/^-\s*/, '').trim());
        } else if (currentExp) {
          currentExp.description += line.trim() + ' ';
        }
      }
      if (currentExp) experiences.push(currentExp);
    }

    return experiences;
  }

  /**
   * Extract education
   */
  private extractEducation(text: string): any[] {
    const education: any[] = [];
    const eduSection = text.match(/(EDUCATION)[:\s]*\n([\s\S]+?)(?=\n\n[A-Z]|$)/i);

    if (eduSection) {
      const lines = eduSection[2].split('\n').filter((l) => l.trim());
      let currentEdu: any = null;

      for (const line of lines) {
        if (line.match(/Bachelor|Master|PhD|Diploma/i)) {
          if (currentEdu) education.push(currentEdu);
          currentEdu = {
            degree: line.trim(),
            institution: '',
          };
        } else if (currentEdu && !currentEdu.institution) {
          currentEdu.institution = line.trim();
        }
      }
      if (currentEdu) education.push(currentEdu);
    }

    return education;
  }

  /**
   * Extract skills
   */
  private extractSkills(text: string): string[] {
    const skillsSection = text.match(/(SKILLS|TECHNICAL SKILLS)[:\s]*\n([\s\S]+?)(?=\n\n[A-Z]|$)/i);

    if (skillsSection) {
      return skillsSection[2]
        .split(/[,\n•·-]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 50);
    }

    return [];
  }

  /**
   * Extract languages
   */
  private extractLanguages(text: string): string[] {
    const langSection = text.match(/(LANGUAGES)[:\s]*\n([\s\S]+?)(?=\n\n[A-Z]|$)/i);

    if (langSection) {
      return langSection[2]
        .split(/[,\n•·-]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    return [];
  }

  /**
   * Extract certifications
   */
  private extractCertifications(text: string): any[] {
    const certSection = text.match(/(CERTIFICATIONS?|LICENSES?)[:\s]*\n([\s\S]+?)(?=\n\n[A-Z]|$)/i);

    if (certSection) {
      return certSection[2]
        .split(/\n/)
        .filter((l) => l.trim().length > 0)
        .map((line) => ({
          name: line.trim(),
        }));
    }

    return [];
  }
}
