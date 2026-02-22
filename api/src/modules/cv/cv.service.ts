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

      // CRITICAL: Auto-update user profile if extractedProfile exists with high confidence
      if (analysis.extractedProfile && analysis.extractedProfile.confidence >= 0.7) {
        try {
          const profileUpdate: any = {};

          // Only update if domain is detected
          if (analysis.extractedProfile.domain) {
            profileUpdate['profile.domain'] = analysis.extractedProfile.domain;
          }

          // Only update if techStack is not empty
          if (
            analysis.extractedProfile.techStack &&
            analysis.extractedProfile.techStack.length > 0
          ) {
            profileUpdate['profile.techStack'] = analysis.extractedProfile.techStack;
          }

          // Only update position if more senior than current (prevent downgrade)
          const positionHierarchy = { junior: 1, middle: 2, senior: 3, lead: 4 };
          const currentLevel = positionHierarchy[user.profile?.position || 'junior'];
          const detectedLevel = positionHierarchy[analysis.extractedProfile.position];

          if (detectedLevel >= currentLevel) {
            profileUpdate['profile.position'] = analysis.extractedProfile.position;
          }

          // Apply update if any fields changed
          if (Object.keys(profileUpdate).length > 0) {
            // FIX #49: If position was updated from CV, also mark position
            // as confirmed so the position-prompt cron doesn't spam the user
            // asking them to "confirm your position" when CV already set it.
            if (profileUpdate['profile.position']) {
              profileUpdate['engagement.positionConfirmed'] = true;
            }

            await this.usersService.updateRaw(userId, { $set: profileUpdate });

            this.logger.log(
              `Auto-updated user profile from CV analysis (confidence: ${analysis.extractedProfile.confidence}): ` +
                `domain=${analysis.extractedProfile.domain}, ` +
                `techStack=[${analysis.extractedProfile.techStack.join(', ')}], ` +
                `position=${analysis.extractedProfile.position}`,
            );
          }

          // Remove extractedProfile from analysis to avoid saving to CV document
          delete analysis.extractedProfile;
        } catch (profileError) {
          this.logger.error(
            `Failed to update user profile from CV: ${profileError.message}`,
            profileError.stack,
          );
          // Don't fail the entire analysis if profile update fails
        }
      } else if (analysis.extractedProfile) {
        this.logger.warn(
          `Skipped profile update due to low confidence (${analysis.extractedProfile.confidence})`,
        );
        delete analysis.extractedProfile;
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
      // FIX #42: Pass user's language to optimization (was missing — always defaulted to 'en')
      const language = dto.language || user.preferences?.language || user.language || 'en';

      const optimization = await this.performCvOptimization(
        cv.parsedText || '',
        cv.parsedData,
        cv.analysis,
        dto,
        model,
        language,
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
            // FIX #63: Minimal system message — main role/expertise defined in prompt itself
            content:
              'You are Dr. CV, an elite Career Document Strategist. Return ONLY valid JSON. No explanations, no markdown code blocks.',
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
        if (
          (err.status === 402 || err.status === 404 || err.status === 429) &&
          model !== AI_MODELS.GPT35
        ) {
          this.logger.warn(
            `Model ${model} API error (${err.status}). Falling back to ${AI_MODELS.GPT35}`,
          );
          completion = await executeAnalysis(AI_MODELS.GPT35);
          usedModel = AI_MODELS.GPT35;
        } else {
          throw err;
        }
      }
      // Validate API response structure (some free models return malformed responses)
      if (
        !completion ||
        !completion.choices ||
        !completion.choices[0] ||
        !completion.choices[0].message
      ) {
        this.logger.error(
          `Model ${usedModel} returned malformed response: ${JSON.stringify(completion)}`,
        );

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
      this.logger.debug(
        `AI Metadata: model=${completion.model}, finish=${finishReason}, tokens=${JSON.stringify(usage)}`,
      );
      this.logger.debug(`Raw Response (first 500 chars): ${rawText.substring(0, 500)}`);

      // CRITICAL: Warn if response was truncated due to token limit
      if (finishReason === 'length') {
        this.logger.warn(
          `⚠️ AI RESPONSE TRUNCATED! Model: ${completion.model}, Tokens: ${usage?.total_tokens || 'unknown'}`,
        );
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

      // Validate and normalize the response
      // Supports both old format and new 100-point scoring format
      return {
        atsScore: typeof analysis.atsScore === 'number' ? analysis.atsScore : 0,
        overallRating: typeof analysis.overallRating === 'number' ? analysis.overallRating : 0,
        aiRejectionRisk: analysis.aiRejectionRisk || 'medium',
        sixSecondVerdict: analysis.sixSecondVerdict || 'unknown',
        strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
        criticalWeaknesses: Array.isArray(analysis.criticalWeaknesses)
          ? analysis.criticalWeaknesses
          : [],
        // Legacy: flatten criticalWeaknesses objects to string[] for backward compat
        weaknesses: Array.isArray(analysis.weaknesses)
          ? analysis.weaknesses
          : Array.isArray(analysis.criticalWeaknesses)
            ? analysis.criticalWeaknesses.map((w: any) =>
                typeof w === 'string' ? w : w?.issue || String(w),
              )
            : [],
        missingKeywords: Array.isArray(analysis.missingKeywords) ? analysis.missingKeywords : [],
        transformationRoadmap: Array.isArray(analysis.transformationRoadmap)
          ? analysis.transformationRoadmap
          : [],
        suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : [],
        quickWins: Array.isArray(analysis.quickWins) ? analysis.quickWins : [],
        aiBypassTips: Array.isArray(analysis.aiBypassTips) ? analysis.aiBypassTips : [],
        // New 100-point scoring breakdown (optional, used by new prompt)
        scoreBreakdown: analysis.scoreBreakdown || null,
        scoreExplanation: analysis.scoreExplanation || null,
        improvementPotential: analysis.improvementPotential || null,
        sectionScores: analysis.sectionScores || {
          summary: 0,
          experience: 0,
          education: 0,
          skills: 0,
          formatting: 0,
        },
        extractedData: analysis.extractedData || null,
        extractedProfile: analysis.extractedProfile
          ? {
              domain: this.validateDomain(analysis.extractedProfile.domain),
              techStack: Array.isArray(analysis.extractedProfile.techStack)
                ? analysis.extractedProfile.techStack.filter((t: any) => typeof t === 'string')
                : [],
              position: this.validatePosition(analysis.extractedProfile.position),
              yearsOfExperience:
                typeof analysis.extractedProfile.yearsOfExperience === 'number'
                  ? analysis.extractedProfile.yearsOfExperience
                  : 0,
              confidence:
                typeof analysis.extractedProfile.confidence === 'number'
                  ? analysis.extractedProfile.confidence
                  : 0,
            }
          : null,
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

    // FIX #41: Safely parse JSON (was raw JSON.parse without try-catch).
    // AI models can return malformed JSON; performCvAnalysis handles this
    // with extractJSON(), but optimization did not.
    let optimization: any;
    try {
      optimization = JSON.parse(optimizationText);
    } catch {
      // Try to extract JSON from markdown code blocks or partial responses
      const cleaned = optimizationText.replace(/```json\n?|```\n?/g, '').trim();
      try {
        optimization = JSON.parse(cleaned);
      } catch {
        const jsonMatch = optimizationText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            optimization = JSON.parse(jsonMatch[0]);
          } catch {
            this.logger.error(`CV optimization returned invalid JSON: ${optimizationText.substring(0, 500)}`);
            throw new BadRequestException('AI returned invalid JSON for CV optimization. Please try again.');
          }
        } else {
          this.logger.error(`CV optimization returned non-JSON: ${optimizationText.substring(0, 500)}`);
          throw new BadRequestException('AI returned invalid response for CV optimization. Please try again.');
        }
      }
    }

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
   * Build CV analysis prompt
   *
   * Professional Context Engineering:
   * - 100-point scoring system with detailed breakdown (5 categories x 20 points)
   * - Professional weakness explanation (not discouraging)
   * - HR AI bypass strategies (actionable, specific)
   * - Improvement roadmap with BEFORE/AFTER
   * - Profile extraction for interview/tasks pipeline
   * - Tri-lingual support (uz/ru/en)
   */
  private buildAnalysisPrompt(
    cvText: string,
    parsedData: any,
    jobDescription?: string,
    language: string = 'en',
  ): string {
    const languageName = this.getLanguageName(language);

    const parts: string[] = [];

    // ═══════════════════════════════════════════════════════════════
    // SECTION 1: ROLE DEFINITION
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# ROLE & IDENTITY

You are **Dr. CV** — an elite Career Document Strategist who has:
- Reviewed 50,000+ CVs across FAANG, startups, and enterprise companies
- Built and reverse-engineered ATS systems (Workday, Greenhouse, Lever, SmartRecruiters, HireVue AI)
- Published research on automated screening algorithms and keyword optimization
- Transformed 4,000+ rejected CVs into interview-winning documents (92% success rate)

Your analysis style: **Direct but encouraging.** You identify real problems without demoralizing the candidate. Every weakness comes with a concrete fix.`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 2: LANGUAGE CONSTRAINT
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# LANGUAGE CONSTRAINT (MANDATORY)

ALL output text MUST be in **${languageName}** (code: ${language}).
This includes: strengths, weaknesses, roadmap items, examples, tips, summaries.
Only JSON keys, enum values (like "frontend", "senior"), and technology names (React, Docker) stay in English.`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 3: INPUT DATA
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# CV DOCUMENT TO ANALYZE

\`\`\`
${cvText}
\`\`\``);

    if (jobDescription) {
      parts.push(`# TARGET JOB DESCRIPTION (Benchmark for Keyword Gap Analysis)

\`\`\`
${jobDescription}
\`\`\`

CRITICAL: Compare CV keywords against this JD. Every missing keyword = lower ATS match score.`);
    }

    // ═══════════════════════════════════════════════════════════════
    // SECTION 4: 100-POINT SCORING SYSTEM
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# SCORING SYSTEM — 100 POINTS TOTAL

Score the CV across 5 categories, each worth 20 points maximum.
Be honest and calibrated — a 70/100 is a decent CV, 85+ is excellent.

## Category 1: PROFESSIONAL SUMMARY & FIRST IMPRESSION (0-20 points)
Evaluate the first 3 lines a recruiter sees:
- [0-5] Value proposition clarity — Can you tell WHAT this person does and WHY they're valuable in 6 seconds?
- [0-5] Professional summary quality — Specific achievements vs generic filler ("passionate developer" = 0 pts)
- [0-5] Contact completeness — Email, phone, LinkedIn, GitHub/portfolio, location
- [0-5] Visual hierarchy — Is the most important info at the top? Clean section flow?

## Category 2: WORK EXPERIENCE & IMPACT (0-20 points)
Analyze each bullet point for the XYZ Formula: "Accomplished [X], measured by [Y], by doing [Z]"
- [0-5] Action verbs — Strong (Architected, Reduced, Deployed, Scaled) vs Weak (Worked, Helped, Did, Made)
- [0-5] Quantification — Numbers, percentages, revenue, users, time saved (each bullet should have at least one metric)
- [0-5] Result orientation — Is the OUTCOME clear, or just activities listed?
- [0-5] Relevance & progression — Does experience show career growth? Are roles relevant to target position?

## Category 3: SKILLS & TECHNICAL COMPETENCE (0-20 points)
- [0-5] Keyword coverage — Are industry-critical technologies explicitly listed? (React vs "frontend framework")
- [0-5] Skill organization — Grouped by category (Languages, Frameworks, Tools, Cloud) vs random list
- [0-5] Depth indicators — Proficiency levels, years of use, or project context for each skill
- [0-5] Certification & education alignment — Do certs match the target role? Is education relevant?

## Category 4: ATS & AI SCREENING COMPATIBILITY (0-20 points)
Modern HR AI rejects 75% of CVs before a human sees them. Check for:
- [0-5] Standard section headers — "Experience" not "My Journey", "Skills" not "What I Know"
- [0-5] Format parsability — No tables, columns, graphics, icons, or non-standard fonts that break OCR/parsing
- [0-5] Keyword density — Job-critical terms naturally woven into experience bullets (not just skills section)
- [0-5] File structure — Clean text extraction, no watermarks, no headers/footers with critical info

## Category 5: COMPLETENESS & COMPETITIVE EDGE (0-20 points)
What separates good CVs from great ones:
- [0-5] Projects with measurable outcomes — Side projects, open source, hackathons with results
- [0-5] Missing elements — Certifications, publications, languages, volunteer work relevant to role
- [0-5] Industry terminology — Domain-specific jargon that signals insider knowledge
- [0-5] Online presence — GitHub with stars, LinkedIn recommendations, portfolio, blog, Stack Overflow`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 5: ANALYSIS INSTRUCTIONS
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# ANALYSIS INSTRUCTIONS

## Step 1: Score each category independently (be calibrated, not generous)
## Step 2: Identify the TOP 3 strengths (things this CV does well)
## Step 3: Identify the TOP 3-5 critical weaknesses that are MOST LIKELY causing rejections
## Step 4: For each weakness, create a transformation roadmap entry with:
   - The exact problem (quote from CV)
   - Step-by-step fix instructions
   - BEFORE text (from CV) and AFTER text (improved version, ready to copy)
   - How many points this fix would add

## Step 5: Generate 3 "Quick Wins" — changes that take <5 minutes but have maximum impact
## Step 6: Generate 3 HR AI Bypass strategies specific to THIS CV and target role
## Step 7: Extract the candidate's professional profile for our interview preparation system

IMPORTANT TONE RULES:
- When describing weaknesses, explain WHY it's a problem (educate, don't just criticize)
- Always pair each weakness with a concrete, actionable fix
- Use encouraging framing: "This is a common issue that's easy to fix" not "This is terrible"
- The "after" examples must be realistic and specific to this candidate's actual experience`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 6: PROFILE EXTRACTION RULES
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# PROFILE EXTRACTION RULES (for Interview & Task Personalization)

Extract these fields accurately — they power our interview question generation and daily practice tasks:

**domain** — Primary professional domain. Choose ONE:
  frontend | backend | mobile | fullstack | devops | ai_ml | data | qa | design | product | general
  Decision logic:
  - If 60%+ experience is React/Vue/Angular/CSS → "frontend"
  - If 60%+ is Node/Python/Java/Go/databases → "backend"
  - If both frontend+backend are significant → "fullstack"
  - If iOS/Android/React Native/Flutter → "mobile"
  - If CI/CD, Kubernetes, AWS infra focus → "devops"
  - If ML/AI/NLP/CV/Data Science → "ai_ml"
  - If analytics, BI, data engineering, SQL heavy → "data"

**techStack** — List ALL specific technologies mentioned or strongly implied. Include:
  - Programming languages (Python, TypeScript, Java, Go, etc.)
  - Frameworks (React, NestJS, Django, Spring Boot, etc.)
  - Databases (PostgreSQL, MongoDB, Redis, etc.)
  - Cloud/DevOps (AWS, Docker, Kubernetes, etc.)
  - Tools (Git, Jira, Figma, etc.)
  Maximum 20 items, ordered by prominence in CV.

**position** — Seniority level. Infer from:
  - junior: 0-2 years total experience, entry-level titles
  - middle: 2-5 years, independent contributor
  - senior: 5-8 years, mentoring others, architectural decisions
  - lead: 7+ years with explicit team leadership, tech lead, architect titles

**yearsOfExperience** — Total years. Calculate from earliest work date to present. If unclear, estimate conservatively.

**confidence** — How confident are you in domain + position classification (0.0-1.0). Below 0.6 if CV is ambiguous.`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 7: OUTPUT SCHEMA
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# OUTPUT FORMAT — Strictly Valid JSON (no markdown, no comments)

{
  "atsScore": <number 0-100, sum of all 5 category scores>,
  "overallRating": <1-5, where 1=poor, 3=average, 5=excellent>,
  "scoreBreakdown": {
    "summary": <0-20>,
    "experience": <0-20>,
    "skills": <0-20>,
    "atsCompatibility": <0-20>,
    "completeness": <0-20>
  },
  "scoreExplanation": "<2-3 sentence ${languageName} summary: what the score means and what tier it falls in>",
  "aiRejectionRisk": "<low|medium|high|critical>",
  "sixSecondVerdict": "<pass|fail>",
  "strengths": [
    "<specific strength 1 in ${languageName} — cite evidence from CV>",
    "<strength 2>",
    "<strength 3>"
  ],
  "criticalWeaknesses": [
    {
      "issue": "<what's wrong, in ${languageName}>",
      "whyItMatters": "<why this causes rejections — educate the user, in ${languageName}>",
      "severity": "<high|medium>"
    }
  ],
  "missingKeywords": ["<keywords from JD not found in CV, if JD provided>"],
  "transformationRoadmap": [
    {
      "priority": <1-5, where 1 = fix first>,
      "category": "summary|experience|skills|ats_format|keywords|quantification|completeness",
      "problem": "<exact problem description in ${languageName}>",
      "stepByStepFix": ["<step 1 in ${languageName}>", "<step 2>", "<step 3>"],
      "before": "<current text from CV>",
      "after": "<improved version in ${languageName}, ready to copy-paste>",
      "pointsGained": "<estimated points this fix adds to atsScore>"
    }
  ],
  "sectionScores": {
    "summary": <0-100, legacy compatibility>,
    "experience": <0-100>,
    "skills": <0-100>,
    "education": <0-100>,
    "formatting": <0-100>
  },
  "quickWins": [
    "<quick win 1 in ${languageName}: specific 5-min change with high impact>",
    "<quick win 2>",
    "<quick win 3>"
  ],
  "aiBypassTips": [
    "<strategy 1: specific to THIS CV, not generic advice, in ${languageName}>",
    "<strategy 2>",
    "<strategy 3>"
  ],
  "improvementPotential": {
    "currentTier": "<poor (0-39) | below_average (40-54) | average (55-69) | good (70-84) | excellent (85-100)>",
    "reachableTier": "<tier achievable by implementing all roadmap fixes>",
    "estimatedNewScore": <number 0-100 after fixes>,
    "effortRequired": "<1-2 hours | 3-5 hours | full rewrite>"
  },
  "extractedProfile": {
    "domain": "<frontend|backend|mobile|fullstack|devops|ai_ml|data|qa|design|product|general>",
    "techStack": ["Tech1", "Tech2", "Tech3"],
    "position": "<junior|middle|senior|lead>",
    "yearsOfExperience": <number>,
    "confidence": <0.0-1.0>
  }
}`);

    // ═══════════════════════════════════════════════════════════════
    // SECTION 8: QUALITY GATES
    // ═══════════════════════════════════════════════════════════════
    parts.push(`# QUALITY GATES — Your response MUST pass ALL of these:

1. atsScore = sum of scoreBreakdown values (summary + experience + skills + atsCompatibility + completeness)
2. transformationRoadmap has MINIMUM 5 entries, each with non-empty before AND after fields
3. "after" examples are realistic for THIS candidate — don't invent experience they don't have
4. ALL user-facing text is in ${languageName} — no English text in strengths, weaknesses, tips
5. extractedProfile.techStack has at least 3 technologies (or fewer if CV genuinely lists fewer)
6. criticalWeaknesses has 3-5 entries, each with whyItMatters explanation
7. quickWins are truly quick (5 minutes) and specific — not "improve your summary"
8. aiBypassTips are specific to THIS CV — reference actual sections or keywords from the document
9. No trailing commas in JSON, no comments, no markdown code blocks — pure valid JSON only`);

    return parts.join('\n\n');
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
        `File size exceeds ${maxSizeMB}MB limit for ${plan} plan. Your file: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
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
   * FIX #66: Also checks trial expiry before allowing CV analysis
   */
  private async checkUsageLimits(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    const plan = user.subscription?.plan || 'free_trial';

    // FIX #66: Check trial expiry first
    if (plan === 'free_trial' && user.subscription?.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(user.subscription.trialEndsAt);
      if (now > trialEnd) {
        throw new ForbiddenException(
          'Your free trial has expired. Please upgrade to continue using CV analysis.',
        );
      }
    }

    // Check subscription status
    if (user.subscription?.status === 'expired') {
      throw new ForbiddenException(
        'Your subscription has expired. Please renew to continue using CV analysis.',
      );
    }

    // Use COMPLETE_PLAN_LIMITS (single source of truth)
    const monthlyLimit = getCvAnalysisMonthlyLimit(plan);

    // Check if limit reached (-1 means unlimited)
    if (monthlyLimit !== -1 && user.usage.cvAnalysesThisMonth >= monthlyLimit) {
      // Provide helpful upgrade message based on current plan
      // ✅ FIX: Updated limits to match COMPLETE_PLAN_LIMITS
      const upgradeMessages: Record<string, string> = {
        free_trial: 'CV analysis limit reached (1/month). Upgrade to Starter for 5/month.',
        starter: 'CV analysis limit reached (5/month). Upgrade to Pro for 15/month.',
        pro: 'CV analysis limit reached (15/month). Upgrade to Elite for unlimited analyses.',
      };

      const message =
        upgradeMessages[plan] ||
        `CV analysis limit reached for ${plan} plan. Upgrade to analyze more CVs.`;

      throw new ForbiddenException(message);
    }

    this.logger.debug(
      `CV analysis usage check passed: ${user.usage.cvAnalysesThisMonth}/${monthlyLimit === -1 ? 'unlimited' : monthlyLimit} for ${plan} plan`,
    );
  }

  /**
   * Get AI model based on subscription plan
   * FIX #61: Free trial uses cost-effective z-ai/glm-4-32b model
   * Starter uses GPT-4o-mini, Pro/Elite use GPT-4o
   */
  private getModelByPlan(plan?: string): string {
    const normalizedPlan = plan || 'free_trial';

    // Free trial: use cheapest model ($0.10/1M tokens)
    if (normalizedPlan === 'free_trial' || normalizedPlan === 'free') {
      return getModelName(this.configService, 'z-ai/glm-4-32b', 'z-ai/glm-4-32b');
    }

    // Starter: use GPT-4o-mini (cost-effective but quality)
    if (normalizedPlan === 'starter') {
      return getModelName(this.configService, AI_MODELS.GPT35, AI_MODELS.GPT35);
    }

    // Pro/Elite: use premium model
    return getModelName(this.configService, AI_MODELS.GPT4, AI_MODELS.GPT4);
  }

  /**
   * Validate and normalize domain enum
   */
  /**
   * Validate and normalize domain enum
   * FIX #62: Added 'design' and 'product' to match prompt extraction options
   */
  private validateDomain(domain: any): string {
    const validDomains = [
      'frontend',
      'backend',
      'mobile',
      'fullstack',
      'devops',
      'ai_ml',
      'data',
      'qa',
      'design',
      'product',
      'general',
    ];
    return validDomains.includes(domain) ? domain : 'general';
  }

  /**
   * Validate and normalize position enum
   */
  private validatePosition(position: any): string {
    const validPositions = ['junior', 'middle', 'senior', 'lead'];
    return validPositions.includes(position) ? position : 'junior';
  }
}
