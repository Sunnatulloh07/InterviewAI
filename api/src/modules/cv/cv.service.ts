import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { CvRepository } from './cv.repository';
import { CvParserService } from './cv-parser.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CvDocument } from './schemas/cv.schema';
import { UploadCvDto } from './dto/upload-cv.dto';
import { AnalyzeCvDto } from './dto/analyze-cv.dto';
import { OptimizeCvDto } from './dto/optimize-cv.dto';
import {
  MAX_FILE_SIZE,
  ALLOWED_CV_FORMATS,
  USAGE_LIMITS,
  QUEUE_CV_ANALYSIS,
  OPENAI_MAX_TOKENS_ANALYSIS,
  OPENAI_MAX_TOKENS_OPTIMIZATION,
  OPENAI_TEMPERATURE,
  AI_MODELS,
} from '@common/constants';
import { OpenAI } from 'openai';

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private readonly openai: OpenAI;
  private readonly maxVersions = 5;

  constructor(
    private readonly cvRepository: CvRepository,
    private readonly cvParserService: CvParserService,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_CV_ANALYSIS) private readonly cvAnalysisQueue: Queue,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const organization = this.configService.get<string>('OPENAI_ORGANIZATION');
    const config: { apiKey: string; organization?: string } = {
      apiKey: apiKey || '',
    };
    // Organization header is OPTIONAL - only needed if you have multiple organizations
    // Most users don't need this parameter at all
    // Only add if it's a valid organization ID (starts with 'org-' and has proper length)
    if (
      organization &&
      organization.trim() &&
      !organization.includes('your-') &&
      !organization.includes('org-***') &&
      organization.trim().startsWith('org-') &&
      organization.trim().length > 4
    ) {
      config.organization = organization.trim();
    }
    this.openai = new OpenAI(config);
  }

  /**
   * Upload CV file
   */
  async uploadCv(
    userId: string,
    file: Express.Multer.File,
    uploadCvDto: UploadCvDto,
  ): Promise<CvDocument> {
    // Validate file
    this.validateFile(file);

    // Check usage limits
    await this.checkUsageLimits(userId);

    // Get user subscription plan
    const user = await this.usersService.findById(userId);

    // Check version limit (keep last 5 versions)
    const userCvCount = await this.cvRepository.countByUserId(userId);
    if (userCvCount >= this.maxVersions) {
      // Delete oldest CV
      const oldestCvs = await this.cvRepository.findByUserId(userId, 1, this.maxVersions - 1);
      if (oldestCvs.length > 0) {
        const oldestCv = oldestCvs[oldestCvs.length - 1];
        await this.deleteCv(userId, oldestCv.id);
        this.logger.log(`Deleted oldest CV version for user ${userId}`);
      }
    }

    try {
      // Parse CV
      const { text: parsedText, parsedData } = await this.cvParserService.parse(
        file.buffer,
        file.mimetype,
      );

      // Upload to S3
      const { storageUrl, key: storageKey } = await this.storageService.uploadCv(
        file as any,
        file.originalname,
      );

      // Create CV record
      const version = userCvCount + 1;
      const cv = await this.cvRepository.create({
        userId: userId as any,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storageUrl,
        storageKey,
        parsedText,
        parsedData,
        version,
        jobDescription: uploadCvDto.jobDescription,
        analysisStatus: 'pending',
      });

      // Queue analysis job
      await this.cvAnalysisQueue.add(
        'analyze-cv',
        {
          cvId: cv.id,
          userId,
          jobDescription: uploadCvDto.jobDescription,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      );

      // Increment usage counter
      await this.usersService.incrementUsage(userId, 'cvAnalysis');

      // Track analytics
      await this.analyticsService.trackEvent({
        userId: userId as any,
        eventType: 'cv_uploaded',
        properties: {
          cvId: cv.id,
          fileName: file.originalname,
          fileSize: file.size,
          version: cv.version,
        },
        timestamp: new Date(),
      });

      this.logger.log(`CV uploaded successfully for user ${userId}: ${cv.id}`);
      return cv;
    } catch (error) {
      this.logger.error(`Failed to upload CV: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to upload CV');
    }
  }

  /**
   * Get user's CVs
   */
  async getUserCvs(userId: string, limit = 10, skip = 0): Promise<CvDocument[]> {
    return await this.cvRepository.findByUserId(userId, limit, skip);
  }

  /**
   * Get CV by ID
   */
  async getCvById(userId: string, cvId: string): Promise<CvDocument> {
    const cv = await this.cvRepository.findById(cvId);

    if (!cv) {
      throw new NotFoundException('CV not found');
    }

    if (cv.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return cv;
  }

  /**
   * Analyze CV
   */
  async analyzeCv(userId: string, cvId: string, dto: AnalyzeCvDto): Promise<CvDocument> {
    const cv = await this.getCvById(userId, cvId);

    if (cv.analysisStatus === 'processing') {
      throw new BadRequestException('CV analysis already in progress');
    }

    // Update status to processing
    await this.cvRepository.update(cvId, { analysisStatus: 'processing' });

    try {
      // Get user for plan-based model selection and language preference
      // PRIORITY: DTO > user.preferences.language > user.language > 'en'
      const user = await this.usersService.findById(userId);
      const model = this.getModelByPlan(user.subscription?.plan);
      const language = dto.language || user.preferences?.language || user.language || 'en';

      // Log language for debugging
      this.logger.debug(
        `Analyzing CV ${cvId} for user ${userId} in language: ${language} (from: ${dto.language ? 'DTO' : user.preferences?.language ? 'preferences' : user.language ? 'user.language' : 'default'})`,
      );

      // Analyze CV using OpenAI
      const analysis = await this.performCvAnalysis(
        cv.parsedText || '',
        cv.parsedData,
        dto.jobDescription || cv.jobDescription,
        model,
        language,
      );

      // Update CV with analysis
      const updatedCv = await this.cvRepository.updateAnalysis(cvId, analysis, 'completed');

      this.logger.log(`CV analysis completed for CV ${cvId}`);
      return updatedCv!;
    } catch (error) {
      this.logger.error(`CV analysis failed: ${error.message}`, error.stack);
      await this.cvRepository.update(cvId, {
        analysisStatus: 'failed',
        analysisError: error.message,
      });
      throw new BadRequestException('CV analysis failed');
    }
  }

  /**
   * Optimize CV
   */
  async optimizeCv(userId: string, cvId: string, dto: OptimizeCvDto): Promise<any> {
    const cv = await this.getCvById(userId, cvId);

    if (!cv.analysis) {
      throw new BadRequestException('CV must be analyzed before optimization');
    }

    // Get user for plan-based model selection
    const user = await this.usersService.findById(userId);
    const model = this.getModelByPlan(user.subscription?.plan);

    try {
      const optimization = await this.performCvOptimization(
        cv.parsedText || '',
        cv.parsedData,
        cv.analysis,
        dto,
        model,
      );

      this.logger.log(`CV optimization completed for CV ${cvId}`);
      return optimization;
    } catch (error) {
      this.logger.error(`CV optimization failed: ${error.message}`, error.stack);
      throw new BadRequestException('CV optimization failed');
    }
  }

  /**
   * Delete CV
   */
  async deleteCv(userId: string, cvId: string): Promise<void> {
    const cv = await this.getCvById(userId, cvId);

    // Delete from S3
    if (cv.storageKey) {
      await this.storageService.deleteFile('cv', cv.storageKey);
    }

    // Delete from database
    await this.cvRepository.delete(cvId);

    this.logger.log(`CV deleted: ${cvId}`);
  }

  /**
   * Perform CV analysis using OpenAI
   */
  private async performCvAnalysis(
    cvText: string,
    parsedData: any,
    jobDescription?: string,
    model: string = AI_MODELS.GPT35,
    language: string = 'en',
  ): Promise<any> {
    const prompt = this.buildAnalysisPrompt(cvText, parsedData, jobDescription, language);

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert CV analyst and ATS (Applicant Tracking System) specialist. Analyze CVs and provide detailed, actionable feedback.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS_ANALYSIS,
      temperature: OPENAI_TEMPERATURE,
      response_format: { type: 'json_object' },
    });

    const analysisText = completion.choices[0].message.content || '{}';
    const analysis = JSON.parse(analysisText);

    return {
      atsScore: analysis.atsScore || 0,
      overallRating: analysis.overallRating || 0,
      strengths: analysis.strengths || [],
      weaknesses: analysis.weaknesses || [],
      missingKeywords: analysis.missingKeywords || [],
      suggestions: analysis.suggestions || [],
      sectionScores: analysis.sectionScores || {
        personalInfo: 0,
        summary: 0,
        experience: 0,
        education: 0,
        skills: 0,
        formatting: 0,
      },
      analyzedAt: new Date(),
      aiModel: model,
    };
  }

  /**
   * Perform CV optimization
   */
  private async performCvOptimization(
    cvText: string,
    parsedData: any,
    analysis: any,
    dto: OptimizeCvDto,
    model: string = AI_MODELS.GPT35,
    language: string = 'en',
  ): Promise<any> {
    const prompt = this.buildOptimizationPrompt(cvText, parsedData, analysis, dto, language);

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert CV writer and career coach. Optimize CVs to maximize ATS compatibility and impact.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: OPENAI_MAX_TOKENS_OPTIMIZATION,
      temperature: OPENAI_TEMPERATURE,
      response_format: { type: 'json_object' },
    });

    const optimizationText = completion.choices[0].message.content || '{}';
    const optimization = JSON.parse(optimizationText);

    return {
      originalCvId: cvText.substring(0, 24),
      optimizedContent: optimization.optimizedContent || '',
      changes: optimization.changes || [],
      newAtsScore: optimization.newAtsScore || analysis.atsScore,
      improvement: optimization.improvement || 0,
      generatedAt: new Date(),
    };
  }

  /**
   * Build analysis prompt
   * Professional Senior Prompt Engineer Logic: ATS-focused, industry-specific, comprehensive analysis
   */
  private buildAnalysisPrompt(
    cvText: string,
    parsedData: any,
    jobDescription?: string,
    language: string = 'en',
  ): string {
    const languageName = this.getLanguageName(language);
    let prompt = `You are an expert CV analyst and ATS (Applicant Tracking System) specialist with 10+ years of experience in recruitment and HR technology. Analyze the following CV comprehensively and provide detailed, actionable feedback.\n\n`;

    // CRITICAL: Language instruction must be at the beginning
    prompt += `## LANGUAGE REQUIREMENT\n`;
    prompt += `IMPORTANT: You MUST respond in ${languageName} (${language.toUpperCase()}). All your output, including strengths, weaknesses, suggestions, messages, examples, and all text fields, must be in ${languageName}.\n\n`;

    prompt += `## CV CONTENT\n`;
    prompt += `${cvText}\n\n`;

    prompt += `## PARSED CV DATA\n`;
    prompt += `${JSON.stringify(parsedData, null, 2)}\n\n`;

    if (jobDescription) {
      prompt += `## TARGET JOB DESCRIPTION\n`;
      prompt += `${jobDescription}\n\n`;
      prompt += `IMPORTANT: Compare the CV against this specific job description. Identify:\n`;
      prompt += `- Missing required skills and keywords\n`;
      prompt += `- Experience gaps\n`;
      prompt += `- Alignment with job requirements\n`;
      prompt += `- How well the CV matches the role\n\n`;
    }

    prompt += `## ANALYSIS REQUIREMENTS\n\n`;

    prompt += `### 1. ATS (Applicant Tracking System) Compatibility\n`;
    prompt += `Evaluate how well the CV will pass through ATS systems:\n`;
    prompt += `- **Keyword Optimization:** Check if relevant keywords from the job description (if provided) are present\n`;
    prompt += `- **Formatting:** Assess if the CV uses ATS-friendly formatting (standard fonts, clear sections, no complex tables/graphics)\n`;
    prompt += `- **File Structure:** Check if sections are clearly labeled and parseable\n`;
    prompt += `- **Keyword Density:** Ensure important skills and technologies appear naturally throughout the CV\n`;
    prompt += `- **ATS Score (0-100):** Calculate based on:\n`;
    prompt += `  - Keyword match (40%)\n`;
    prompt += `  - Formatting compatibility (20%)\n`;
    prompt += `  - Section completeness (20%)\n`;
    prompt += `  - Content quality (20%)\n\n`;

    prompt += `### 2. Content Quality Assessment\n`;
    prompt += `Evaluate the quality and impact of the CV content:\n`;
    prompt += `- **Professional Summary:** Is it compelling, concise, and tailored?\n`;
    prompt += `- **Work Experience:** Are achievements quantified with metrics? Are responsibilities clear?\n`;
    prompt += `- **Skills Section:** Are skills relevant, well-organized, and aligned with the role?\n`;
    prompt += `- **Education:** Is education presented clearly and relevantly?\n`;
    prompt += `- **Achievements:** Are accomplishments highlighted with specific results?\n`;
    prompt += `- **Grammar & Language:** Check for spelling, grammar, and professional language use\n\n`;

    prompt += `### 3. Industry-Specific Analysis\n`;
    prompt += `If a job description is provided, analyze industry-specific requirements:\n`;
    prompt += `- **Technical Skills:** Match technical requirements with CV skills\n`;
    prompt += `- **Soft Skills:** Identify soft skills mentioned in job description\n`;
    prompt += `- **Experience Level:** Assess if experience level matches job requirements\n`;
    prompt += `- **Certifications:** Check if relevant certifications are present\n\n`;

    prompt += `### 4. Missing Elements & Gaps\n`;
    prompt += `Identify what's missing or could be improved:\n`;
    prompt += `- **Missing Keywords:** List important keywords from job description not found in CV\n`;
    prompt += `- **Experience Gaps:** Identify any gaps in work history or skills\n`;
    prompt += `- **Weak Sections:** Highlight sections that need improvement\n`;
    prompt += `- **Missing Information:** Note any critical information that should be included\n\n`;

    prompt += `## OUTPUT FORMAT\n`;
    prompt += `Provide your comprehensive analysis in the following JSON format (strictly valid JSON):\n`;
    prompt += `{\n`;
    prompt += `  "atsScore": <number 0-100, calculated based on ATS compatibility criteria above>,\n`;
    prompt += `  "overallRating": <number 1-5, where 1=poor, 2=below average, 3=average, 4=good, 5=excellent>,\n`;
    prompt += `  "strengths": [<array of 5-10 specific strengths in ${languageName}>],\n`;
    prompt += `  "weaknesses": [<array of 5-10 specific weaknesses in ${languageName}>],\n`;
    prompt += `  "missingKeywords": [<array of important keywords from job description not found in CV, if job description provided>],\n`;
    prompt += `  "suggestions": [\n`;
    prompt += `    {\n`;
    prompt += `      "category": "content|formatting|keywords|grammar|achievements|structure|personalization",\n`;
    prompt += `      "severity": "low|medium|high|critical",\n`;
    prompt += `      "message": "<clear description of the issue in ${languageName}>",\n`;
    prompt += `      "suggestion": "<specific, actionable advice on how to fix it in ${languageName}>",\n`;
    prompt += `      "example": "<optional example of improved version in ${languageName}>"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "sectionScores": {\n`;
    prompt += `    "personalInfo": <number 0-100, completeness and clarity>,\n`;
    prompt += `    "summary": <number 0-100, impact and relevance>,\n`;
    prompt += `    "experience": <number 0-100, detail, metrics, relevance>,\n`;
    prompt += `    "education": <number 0-100, clarity and relevance>,\n`;
    prompt += `    "skills": <number 0-100, relevance and organization>,\n`;
    prompt += `    "formatting": <number 0-100, ATS compatibility and readability>\n`;
    prompt += `  },\n`;
    prompt += `  "keywordDensity": {\n`;
    prompt += `    "totalKeywords": <number of unique keywords found>,\n`;
    prompt += `    "jobDescriptionKeywords": <number of keywords from job description found in CV, if job description provided>,\n`;
    prompt += `    "keywordMatchPercentage": <percentage of job description keywords found in CV, if job description provided>\n`;
    prompt += `  },\n`;
    prompt += `  "industryAlignment": <if job description provided, score 0-100 indicating how well CV aligns with industry/role requirements>\n`;
    prompt += `}\n\n`;

    prompt += `## FINAL INSTRUCTIONS\n`;
    prompt += `1. **CRITICAL:** Generate ALL content in ${languageName} (${language.toUpperCase()}) - strengths, weaknesses, suggestions, messages, examples\n`;
    prompt += `2. Be thorough and specific in your analysis\n`;
    prompt += `3. Provide actionable, concrete suggestions\n`;
    prompt += `4. Focus on ATS compatibility if job description is provided\n`;
    prompt += `5. Consider industry best practices and standards\n`;
    prompt += `6. Be constructive and professional in your feedback\n`;
    prompt += `7. Ensure all scores are justified by the analysis\n`;
    prompt += `8. **REMEMBER:** All JSON output fields must be in ${languageName}\n`;

    return prompt;
  }

  /**
   * Build optimization prompt
   * Professional Senior Prompt Engineer Logic: ATS optimization, industry-specific, targeted improvements
   */
  private buildOptimizationPrompt(
    cvText: string,
    parsedData: any,
    analysis: any,
    dto: OptimizeCvDto,
    language: string = 'en',
  ): string {
    const languageName = this.getLanguageName(language);
    let prompt = `You are an expert CV writer and career coach specializing in ATS optimization and industry-specific CV enhancement. Optimize the following CV to maximize ATS compatibility, impact, and alignment with the target role.\n\n`;

    // CRITICAL: Language instruction must be at the beginning
    prompt += `## LANGUAGE REQUIREMENT\n`;
    prompt += `IMPORTANT: You MUST respond in ${languageName} (${language.toUpperCase()}). All your output, including optimized content, changes, reasons, and all text fields, must be in ${languageName}.\n\n`;

    prompt += `## ORIGINAL CV\n`;
    prompt += `${cvText}\n\n`;

    prompt += `## CURRENT CV ANALYSIS\n`;
    prompt += `- **ATS Score:** ${analysis.atsScore}/100\n`;
    prompt += `- **Overall Rating:** ${analysis.overallRating}/5\n`;
    prompt += `- **Key Weaknesses:** ${analysis.weaknesses?.slice(0, 5).join(', ') || 'None identified'}\n`;
    prompt += `- **Missing Keywords:** ${analysis.missingKeywords?.slice(0, 10).join(', ') || 'None'}\n`;
    prompt += `- **Section Scores:** ${JSON.stringify(analysis.sectionScores || {})}\n\n`;

    prompt += `## OPTIMIZATION PARAMETERS\n`;
    prompt += `- **Optimization Level:** ${dto.optimizationLevel} (${this.getOptimizationLevelDescription(dto.optimizationLevel)})\n`;
    if (dto.targetRole) {
      prompt += `- **Target Role:** ${dto.targetRole}\n`;
    }
    if (dto.targetCompany) {
      prompt += `- **Target Company:** ${dto.targetCompany}\n`;
    }
    if (dto.jobDescription) {
      prompt += `- **Job Description:** Provided (see below)\n`;
    }
    prompt += `\n`;

    if (dto.jobDescription) {
      prompt += `## TARGET JOB DESCRIPTION\n`;
      prompt += `${dto.jobDescription}\n\n`;
      prompt += `IMPORTANT: Optimize the CV specifically for this role. Ensure:\n`;
      prompt += `- All required keywords from job description are naturally integrated\n`;
      prompt += `- Experience and skills are aligned with job requirements\n`;
      prompt += `- Professional summary is tailored to the role\n`;
      prompt += `- Achievements demonstrate relevance to the position\n\n`;
    }

    prompt += `## OPTIMIZATION REQUIREMENTS\n\n`;

    prompt += `### 1. ATS Optimization\n`;
    prompt += `- **Keyword Integration:** Naturally incorporate missing keywords from job description (if provided) throughout the CV\n`;
    prompt += `- **Formatting:** Ensure ATS-friendly formatting (standard fonts, clear section headers, no complex tables)\n`;
    prompt += `- **Section Headers:** Use standard section names (e.g., "Work Experience", "Education", "Skills")\n`;
    prompt += `- **Keyword Density:** Maintain natural keyword density (2-3% for important terms)\n`;
    prompt += `- **File Structure:** Ensure all sections are clearly parseable by ATS systems\n\n`;

    prompt += `### 2. Content Enhancement\n`;
    prompt += `Based on optimization level:\n`;
    if (dto.optimizationLevel === 'aggressive' || dto.optimizationLevel === 'moderate') {
      prompt += `- **Quantify Achievements:** Add specific metrics, numbers, and results to experience descriptions\n`;
      prompt += `- **Action Verbs:** Use strong action verbs (e.g., "Led", "Developed", "Implemented", "Optimized")\n`;
      prompt += `- **Professional Summary:** Rewrite to be more compelling and role-specific\n`;
      prompt += `- **Skills Section:** Reorganize and prioritize skills based on job requirements\n`;
    }
    if (dto.optimizationLevel === 'aggressive') {
      prompt += `- **Experience Descriptions:** Completely rewrite to be more impactful and achievement-focused\n`;
      prompt += `- **Add Missing Sections:** Include relevant sections if missing (e.g., Certifications, Projects)\n`;
      prompt += `- **Remove Irrelevant Content:** Remove outdated or irrelevant information\n`;
    }
    prompt += `\n`;

    prompt += `### 3. Industry-Specific Optimization\n`;
    if (dto.targetRole || dto.targetCompany) {
      prompt += `- **Role Alignment:** Tailor content to match the specific role requirements\n`;
      prompt += `- **Company Culture:** If target company is provided, align tone and values with company culture\n`;
      prompt += `- **Industry Keywords:** Include industry-specific terminology and keywords\n`;
      prompt += `- **Relevant Experience:** Emphasize experience most relevant to the target role\n\n`;
    }

    prompt += `### 4. Structure & Formatting\n`;
    prompt += `- **Section Order:** Optimize section order based on role requirements (e.g., Skills before Experience for technical roles)\n`;
    prompt += `- **Readability:** Ensure clear, scannable format with proper spacing and bullet points\n`;
    prompt += `- **Length:** Maintain appropriate length (1-2 pages for most roles, 3+ for senior/executive)\n`;
    prompt += `- **Consistency:** Ensure consistent formatting, date formats, and style throughout\n\n`;

    prompt += `## OUTPUT FORMAT\n`;
    prompt += `Provide the optimized CV in the following JSON format (strictly valid JSON):\n`;
    prompt += `{\n`;
    prompt += `  "optimizedContent": "<complete optimized CV text, maintaining original structure but with all improvements applied>",\n`;
    prompt += `  "changes": [\n`;
    prompt += `    {\n`;
    prompt += `      "section": "<section name, e.g., 'Professional Summary', 'Work Experience', 'Skills'>",\n`;
    prompt += `      "type": "addition|modification|deletion|reorganization",\n`;
    prompt += `      "original": "<original text or description of what was changed>",\n`;
    prompt += `      "optimized": "<optimized text or description of the change>",\n`;
    prompt += `      "reason": "<clear explanation of why this change improves ATS compatibility, impact, or alignment>",\n`;
    prompt += `      "impact": "<estimated impact: low|medium|high|critical>"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "newAtsScore": <estimated new ATS score 0-100 after optimization>,\n`;
    prompt += `  "improvement": <percentage improvement in ATS score, e.g., 15 for 15% improvement>,\n`;
    prompt += `  "keywordsAdded": [<array of keywords that were added from job description>],\n`;
    prompt += `  "summary": "<brief summary of key optimizations made>"\n`;
    prompt += `}\n\n`;

    prompt += `## FINAL INSTRUCTIONS\n`;
    prompt += `1. **CRITICAL:** Generate ALL content in ${languageName} (${language.toUpperCase()}) - optimized content, changes, reasons, summary\n`;
    prompt += `2. Maintain authenticity - do not fabricate experience or achievements\n`;
    prompt += `3. Ensure all changes improve ATS compatibility and alignment with target role\n`;
    prompt += `4. Keep the optimized CV professional and truthful\n`;
    prompt += `5. Provide clear explanations for all changes\n`;
    prompt += `6. Estimate realistic improvement in ATS score based on changes made\n`;
    prompt += `7. Ensure the optimized CV is ready for ATS submission\n`;
    prompt += `8. **REMEMBER:** All JSON output fields must be in ${languageName}\n`;

    return prompt;
  }

  /**
   * Get optimization level description
   */
  private getOptimizationLevelDescription(level: string): string {
    const descriptions: Record<string, string> = {
      conservative: 'minimal changes, preserve most original content',
      moderate: 'balanced improvements, enhance key sections',
      aggressive: 'comprehensive rewrite, maximize optimization',
    };
    return descriptions[level] || descriptions['moderate'];
  }

  /**
   * Get language name from code
   */
  private getLanguageName(language: string): string {
    const names: Record<string, string> = {
      uz: 'Uzbek',
      ru: 'Russian',
      en: 'English',
    };
    return names[language] || 'English';
  }

  /**
   * Validate file
   */
  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }

    if (!ALLOWED_CV_FORMATS.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file format. Allowed formats: PDF, DOCX, TXT');
    }
  }

  /**
   * Check usage limits
   */
  private async checkUsageLimits(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free';
    const limit = USAGE_LIMITS[plan]?.cvAnalyses || USAGE_LIMITS.free.cvAnalyses;

    if (limit === -1) {
      return; // Unlimited
    }

    if (user.usage.cvAnalysesThisMonth >= limit) {
      throw new ForbiddenException(
        `CV analysis limit reached for ${plan} plan. Upgrade to analyze more CVs.`,
      );
    }
  }

  /**
   * Get AI model based on subscription plan
   */
  private getModelByPlan(plan?: string): string {
    if (plan === 'elite' || plan === 'pro' || plan === 'enterprise') {
      return AI_MODELS.GPT4;
    }
    return AI_MODELS.GPT35;
  }
}
