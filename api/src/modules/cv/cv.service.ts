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
  getCvAnalysisMonthlyLimit,
  getPlanLimits,
} from '@common/constants';
import { OpenAI } from 'openai';
import {
  createOpenAIClient,
  getModelName,
  getModelForPlan,
} from '@common/utils/openai-client.factory';

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);
  private readonly openai: OpenAI | null;
  private readonly maxVersions = 1; // User can only have 1 CV at a time

  constructor(
    private readonly cvRepository: CvRepository,
    private readonly cvParserService: CvParserService,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
    @InjectQueue(QUEUE_CV_ANALYSIS) private readonly cvAnalysisQueue: Queue,
  ) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Upload CV file
   */
  async uploadCv(
    userId: string,
    file: Express.Multer.File,
    uploadCvDto: UploadCvDto,
  ): Promise<CvDocument> {
    // Get user subscription plan first
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free_trial';

    // Validate file with plan limits
    this.validateFile(file, plan);

    // Check usage limits
    await this.checkUsageLimits(userId);

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

      // Upload to storage (local or S3)
      // CRITICAL: Pass userId, not file.originalname, to avoid creating folders with filename
      const { storageUrl, key: storageKey } = await this.storageService.uploadCv(
        file as any,
        userId,
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
   * Get user's latest CV (most recent)
   */
  async getUserLatestCv(userId: string): Promise<CvDocument | null> {
    const cvs = await this.cvRepository.findByUserId(userId, 1, 0);
    return cvs.length > 0 ? cvs[0] : null;
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

    // Check if this is a RE-analysis (CV was already analyzed before)
    // First-time analysis usage is counted in uploadCv, so only count re-analysis
    const isReanalysis = cv.analysisStatus === 'completed' || cv.analysisStatus === 'failed';
    
    if (isReanalysis) {
      // Check usage limits for re-analysis
      await this.checkUsageLimits(userId);
      // Increment usage counter for re-analysis
      await this.usersService.incrementUsage(userId, 'cvAnalysis');
      this.logger.log(`CV re-analysis usage incremented for user ${userId}`);
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

      // Update CV with analysis AND corrected parsed Data
      const updateData: any = {
        analysis,
        analysisStatus: 'completed',
        analyzedAt: new Date(),
      };

      // If Analysis returned better parsed data, update it in DB
      if (analysis.extractedData) {
        updateData.parsedData = analysis.extractedData;
        // Don't save extractedData into analysis field to avoid duplication, or keep it if needed.
        // It's already in parsedData column now.
        delete analysis.extractedData;
      }

      const updatedCv = await this.cvRepository.update(cvId, updateData);

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
  /**
   * Perform CV analysis using OpenAI
   * Production-grade implementation with bulletproof JSON extraction
   */
  private async performCvAnalysis(
    cvText: string,
    parsedData: any,
    jobDescription?: string,
    model: string = AI_MODELS.GPT35,
    language: string = 'en',
  ): Promise<any> {
    if (!this.openai) {
      throw new BadRequestException(
        'AI service is not configured. Please configure OPENAI_API_KEY.',
      );
    }

    const prompt = this.buildAnalysisPrompt(cvText, parsedData, jobDescription, language);

    // Execute AI request
    const executeAnalysis = async (targetModel: string) => {
      if (!this.openai) throw new Error('OpenAI client not initialized');
      this.logger.log(`Performing CV analysis using model: ${targetModel}`);
      
      const completion = await this.openai.chat.completions.create({
        model: targetModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert CV analyst. Return ONLY valid JSON. No explanations, no markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: OPENAI_MAX_TOKENS_ANALYSIS,
        temperature: 0.3, // Lower temperature for more consistent JSON
        response_format: { type: 'json_object' },
      });
      return completion;
    };

    // Extract JSON from any text format
    const extractJSON = (text: string): any => {
      // Try direct parse first
      try {
        return JSON.parse(text);
      } catch (e) {
        // Continue to other methods
      }

      // Remove markdown code blocks
      let cleaned = text.replace(/```json\n?|```\n?/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        // Continue
      }

      // Try to find JSON object in text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          // Continue
        }
      }

      // Return null if nothing works
      return null;
    };

    try {
      let completion;
      let usedModel = model;
      
      // First attempt with requested model
      try {
        completion = await executeAnalysis(model);
      } catch (err) {
        // Fallback for API errors
        if ((err.status === 402 || err.status === 404 || err.status === 429) && model !== AI_MODELS.GPT35) {
          this.logger.warn(`Model ${model} API error (${err.status}). Falling back to ${AI_MODELS.GPT35}`);
          completion = await executeAnalysis(AI_MODELS.GPT35);
          usedModel = AI_MODELS.GPT35;
        } else {
          throw err;
        }
      }
      // Validate API response structure (some free models return malformed responses)
      if (!completion || !completion.choices || !completion.choices[0] || !completion.choices[0].message) {
        this.logger.error(`Model ${usedModel} returned malformed response: ${JSON.stringify(completion)}`);
        
        if (usedModel !== AI_MODELS.GPT35) {
          this.logger.log(`Malformed response. Retrying with reliable model: ${AI_MODELS.GPT35}`);
          completion = await executeAnalysis(AI_MODELS.GPT35);
          usedModel = AI_MODELS.GPT35;
          
          if (!completion || !completion.choices || !completion.choices[0]) {
            throw new Error('Both models returned malformed responses');
          }
        } else {
          throw new Error('AI model returned malformed response');
        }
      }

      const rawText = completion.choices[0].message.content || '';
      const finishReason = completion.choices[0].finish_reason;
      const usage = completion.usage;

      // Debug logging
      this.logger.debug(`AI Metadata: model=${completion.model}, finish=${finishReason}, tokens=${JSON.stringify(usage)}`);
      this.logger.debug(`Raw Response (first 500 chars): ${rawText.substring(0, 500)}`);
      
      // CRITICAL: Warn if response was truncated due to token limit
      if (finishReason === 'length') {
        this.logger.warn(`⚠️ AI RESPONSE TRUNCATED! Model: ${completion.model}, Tokens: ${usage?.total_tokens || 'unknown'}`);
        this.logger.warn(`Full truncated response: ${rawText}`);
      }

      // Extract JSON from response
      let analysis = extractJSON(rawText);

      // If extraction failed or empty, try fallback model
      if (!analysis || (typeof analysis === 'object' && Object.keys(analysis).length === 0)) {
        this.logger.warn(`Model ${usedModel} returned empty/invalid JSON.`);
        this.logger.warn(`FULL RAW RESPONSE: ${rawText}`); // Log complete response for debugging
        
        if (usedModel !== AI_MODELS.GPT35) {
          this.logger.log(`Retrying with reliable model: ${AI_MODELS.GPT35}`);
          completion = await executeAnalysis(AI_MODELS.GPT35);
          const retryText = completion.choices[0].message.content || '';
          analysis = extractJSON(retryText);
          usedModel = AI_MODELS.GPT35;
          
          if (!analysis) {
            this.logger.error(`Fallback model also failed. Raw: "${retryText.substring(0, 200)}"`);
            throw new Error('Both primary and fallback models failed to return valid JSON');
          }
        } else {
          throw new Error('AI model returned invalid JSON');
        }
      }

      // Validate and normalize the response with new Senior-level fields
      return {
        atsScore: typeof analysis.atsScore === 'number' ? analysis.atsScore : 0,
        overallRating: typeof analysis.overallRating === 'number' ? analysis.overallRating : 0,
        aiRejectionRisk: analysis.aiRejectionRisk || 'medium',
        sixSecondVerdict: analysis.sixSecondVerdict || 'unknown',
        strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
        criticalWeaknesses: Array.isArray(analysis.criticalWeaknesses) ? analysis.criticalWeaknesses : [],
        weaknesses: Array.isArray(analysis.weaknesses) ? analysis.weaknesses : (analysis.criticalWeaknesses || []),
        missingKeywords: Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [],
        transformationRoadmap: Array.isArray(analysis.transformationRoadmap) ? analysis.transformationRoadmap : [],
        suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : [],
        quickWins: Array.isArray(analysis.quickWins) ? analysis.quickWins : [],
        aiBypassTips: Array.isArray(analysis.aiBypassTips) ? analysis.aiBypassTips : [],
        sectionScores: analysis.sectionScores || {
          summary: 0,
          experience: 0,
          education: 0,
          skills: 0,
          formatting: 0,
        },
        extractedData: analysis.extractedData || null,
        analyzedAt: new Date(),
        aiModel: usedModel,
      };
    } catch (error) {
      this.logger.error(`CV analysis execution failed: ${error.message}`, error.stack);
      throw error;
    }
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
    if (!this.openai) {
      throw new BadRequestException(
        'AI service is not configured. Please configure OPENAI_API_KEY.',
      );
    }

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
   * SENIOR CONTEXT ENGINEER LOGIC: Deep forensic analysis with actionable step-by-step fixes
   * Focus: ATS bypass strategies, HR AI screening, power statements, quantification
   */
  private buildAnalysisPrompt(
    cvText: string,
    parsedData: any,
    jobDescription?: string,
    language: string = 'en',
  ): string {
    const languageName = this.getLanguageName(language);
    
    let prompt = `# ROLE & EXPERTISE\n`;
    prompt += `You are a world-class CV Strategist and ATS Systems Expert with:\n`;
    prompt += `- 15+ years recruiting at FAANG companies (Google, Meta, Amazon)\n`;
    prompt += `- Deep knowledge of AI screening systems (Workday, Greenhouse, Lever, HireVue)\n`;
    prompt += `- Expertise in bypassing automated rejection filters\n`;
    prompt += `- Track record of transforming rejected CVs into interview-winning documents\n\n`;

    prompt += `# YOUR MISSION\n`;
    prompt += `Perform a FORENSIC DEEP-DIVE analysis of this CV. Your goal is NOT just to find problems, but to:\n`;
    prompt += `1. Identify EXACTLY why AI systems might reject this CV\n`;
    prompt += `2. Provide STEP-BY-STEP fixes with BEFORE/AFTER examples\n`;
    prompt += `3. Give a COMPLETE TRANSFORMATION ROADMAP to achieve 90%+ ATS score\n\n`;

    prompt += `# LANGUAGE REQUIREMENT (CRITICAL)\n`;
    prompt += `ALL your output MUST be in ${languageName} (${language.toUpperCase()}).\n`;
    prompt += `Every field, message, suggestion, and example must be written in ${languageName}.\n\n`;

    prompt += `# CV TO ANALYZE\n`;
    prompt += `\`\`\`\n${cvText}\n\`\`\`\n\n`;

    if (jobDescription) {
      prompt += `# TARGET JOB DESCRIPTION (Benchmark)\n`;
      prompt += `\`\`\`\n${jobDescription}\n\`\`\`\n`;
      prompt += `**IMPORTANT:** Analyze the CV specifically against this job. Missing keywords = automatic rejection.\n\n`;
    }

    prompt += `# ANALYSIS FRAMEWORK (Follow Each Step)\n\n`;

    prompt += `## 1. THE 6-SECOND SCAN (What Recruiters See First)\n`;
    prompt += `Recruiters spend only 6 seconds on initial scan. Analyze:\n`;
    prompt += `- Is the candidate's VALUE PROPOSITION visible in first 3 lines?\n`;
    prompt += `- Are KEY SKILLS immediately scannable?\n`;
    prompt += `- Is contact info professional (GitHub, LinkedIn, clean email)?\n`;
    prompt += `- Is there a powerful SUMMARY or just generic filler?\n\n`;

    prompt += `## 2. AI/ATS COMPATIBILITY AUDIT\n`;
    prompt += `Modern AI screening rejects 75% of CVs. Check for:\n`;
    prompt += `- **KEYWORD DENSITY:** Are job-critical keywords naturally integrated?\n`;
    prompt += `- **FORMAT KILLERS:** Tables, columns, graphics, icons = parsing failures\n`;
    prompt += `- **SECTION HEADERS:** Standard names (Experience, Education, Skills) vs creative names AI won't understand\n`;
    prompt += `- **FILE STRUCTURE:** Can text be extracted cleanly?\n`;
    prompt += `- **SKILLS MATCH:** For tech roles, specific tools (React, AWS, Docker) must be explicit\n\n`;

    prompt += `## 3. POWER STATEMENT ANALYSIS (Experience Section)\n`;
    prompt += `Each bullet should follow the XYZ Formula: "Accomplished X, as measured by Y, by doing Z"\n`;
    prompt += `Analyze EACH work experience bullet for:\n`;
    prompt += `- **ACTION VERB:** Weak (Worked, Helped, Did) vs Strong (Architected, Reduced, Deployed)\n`;
    prompt += `- **QUANTIFICATION:** Numbers, percentages, dollars, time saved\n`;
    prompt += `- **IMPACT:** Is the RESULT clear, or just activities listed?\n`;
    prompt += `- **Example Fix:** "Worked on backend" → "Architected microservices backend serving 50K daily users, reducing latency by 40%"\n\n`;

    prompt += `## 4. MISSING ELEMENTS DETECTION\n`;
    prompt += `Identify what's MISSING that top candidates include:\n`;
    prompt += `- Certifications relevant to the role\n`;
    prompt += `- Specific project outcomes and metrics\n`;
    prompt += `- Keywords from the job description\n`;
    prompt += `- Industry-specific terminology\n`;
    prompt += `- Links to portfolio, GitHub, LinkedIn\n\n`;

    prompt += `## 5. TRANSFORMATION ROADMAP\n`;
    prompt += `For each weakness, provide:\n`;
    prompt += `- **WHAT TO FIX:** Specific issue\n`;
    prompt += `- **HOW TO FIX:** Step-by-step instructions\n`;
    prompt += `- **BEFORE:** Current problematic text\n`;
    prompt += `- **AFTER:** Improved version ready to copy-paste\n`;
    prompt += `- **IMPACT:** How this fix increases ATS score\n\n`;

    prompt += `# OUTPUT FORMAT (Strictly Valid JSON)\n`;
    prompt += `{\n`;
    prompt += `  "atsScore": <number 0-100>,\n`;
    prompt += `  "overallRating": <1-5>,\n`;
    prompt += `  "aiRejectionRisk": "<low|medium|high|critical> - likelihood of AI auto-rejection",\n`;
    prompt += `  "sixSecondVerdict": "<pass|fail> - would recruiter continue reading?",\n`;
    prompt += `  "strengths": ["<5-10 specific strengths in ${languageName}>"],\n`;
    prompt += `  "criticalWeaknesses": ["<3-5 most damaging issues causing rejections in ${languageName}>"],\n`;
    prompt += `  "missingKeywords": ["<keywords from JD not found in CV>"],\n`;
    prompt += `  "transformationRoadmap": [\n`;
    prompt += `    {\n`;
    prompt += `      "priority": <1-5, where 1 is most urgent>,\n`;
    prompt += `      "category": "ats_optimization|power_statement|quantification|keywords|formatting|summary|skills",\n`;
    prompt += `      "problem": "<clear description of the issue in ${languageName}>",\n`;
    prompt += `      "stepByStepFix": ["<step 1>", "<step 2>", "<step 3>"],\n`;
    prompt += `      "before": "<current problematic text from CV>",\n`;
    prompt += `      "after": "<improved version ready to use in ${languageName}>",\n`;
    prompt += `      "impactOnScore": "<how many % this fix adds to ATS score>"\n`;
    prompt += `    }\n`;
    prompt += `  ],\n`;
    prompt += `  "sectionScores": {\n`;
    prompt += `    "summary": <0-100>,\n`;
    prompt += `    "experience": <0-100>,\n`;
    prompt += `    "skills": <0-100>,\n`;
    prompt += `    "education": <0-100>,\n`;
    prompt += `    "formatting": <0-100>\n`;
    prompt += `  },\n`;
    prompt += `  "quickWins": ["<3 changes that take <5 min but boost score significantly, in ${languageName}>"],\n`;
    prompt += `  "aiBypassTips": ["<3 specific strategies to pass AI screening in ${languageName}>"]\n`;
    prompt += `}\n\n`;

    prompt += `# CRITICAL REMINDERS\n`;
    prompt += `1. ALL text in ${languageName} - strengths, weaknesses, roadmap, examples\n`;
    prompt += `2. Provide MINIMUM 5 items in transformationRoadmap with BEFORE/AFTER\n`;
    prompt += `3. Be SPECIFIC - don't say "improve summary", say EXACTLY how\n`;
    prompt += `4. Include REAL NUMBERS in "after" examples (%, time, users)\n`;
    prompt += `5. aiBypassTips must be ACTIONABLE, not generic advice\n`;
    prompt += `6. Focus on what will get this CV PAST AI filters\n`;

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
  private validateFile(file: Express.Multer.File, plan: string): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Get plan-specific limits
    const planLimits = getPlanLimits(plan);
    const maxSizeMB = planLimits.cvAnalysis.maxFileSize;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        `File size exceeds ${maxSizeMB}MB limit for ${plan} plan. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`
      );
    }

    // Check allowed formats
    const allowedFormats = planLimits.cvAnalysis.allowedFormats;
    if (allowedFormats !== '*' && !ALLOWED_CV_FORMATS.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file format. Allowed formats: PDF, DOCX, TXT');
    }
  }

  /**
   * Check usage limits
   * ✅ STEP 3 FIX: Now uses COMPLETE_PLAN_LIMITS for accurate enforcement
   */
  private async checkUsageLimits(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free_trial';
    
    // ✅ Use COMPLETE_PLAN_LIMITS (single source of truth)
    const monthlyLimit = getCvAnalysisMonthlyLimit(plan);
    
    // Check if limit reached (-1 means unlimited)
    if (monthlyLimit !== -1 && user.usage.cvAnalysesThisMonth >= monthlyLimit) {
      // Provide helpful upgrade message based on current plan
      const upgradeMessages: Record<string, string> = {
        free_trial: 'CV analysis limit reached (2/month). Upgrade to Starter for 5/month.',
        starter: 'CV analysis limit reached (5/month). Upgrade to Pro for 15/month.',
        pro: 'CV analysis limit reached (15/month). Upgrade to Elite for unlimited analyses.',
      };
      
      const message = upgradeMessages[plan] 
        || `CV analysis limit reached for ${plan} plan. Upgrade to analyze more CVs.`;
      
      throw new ForbiddenException(message);
    }
    
    this.logger.debug(
      `CV analysis usage check passed: ${user.usage.cvAnalysesThisMonth}/${monthlyLimit === -1 ? 'unlimited' : monthlyLimit} for ${plan} plan`
    );
  }

  /**
   * Get AI model based on subscription plan
   * Supports OpenRouter with automatic model mapping
   */
  private getModelByPlan(plan?: string): string {
    return getModelForPlan(this.configService, plan || 'free', AI_MODELS.GPT35, AI_MODELS.GPT4);
  }
}
