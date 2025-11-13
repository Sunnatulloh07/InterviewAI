import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

@Injectable()
export class CvParserService {
  private readonly logger = new Logger(CvParserService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Parse CV file based on mime type
   */
  async parse(buffer: Buffer, mimeType: string): Promise<{ text: string; parsedData: any }> {
    let text: string;

    try {
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
        default:
          throw new BadRequestException('Unsupported file type');
      }

      // Extract structured data from text
      const parsedData = await this.extractStructuredData(text);

      return { text, parsedData };
    } catch (error) {
      this.logger.error(`Failed to parse CV: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to parse CV file');
    }
  }

  /**
   * Parse PDF file
   */
  private async parsePdf(buffer: Buffer): Promise<string> {
    try {
      const data = await (pdfParse as any).default(buffer);
      return data.text;
    } catch (error) {
      this.logger.error(`PDF parsing failed: ${error.message}`);
      throw new BadRequestException('Failed to parse PDF file');
    }
  }

  /**
   * Parse DOCX file
   */
  private async parseDocx(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      this.logger.error(`DOCX parsing failed: ${error.message}`);
      throw new BadRequestException('Failed to parse DOCX file');
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
