import { Injectable, Logger, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OpenAI } from 'openai';
import {
  GenerateAnswerDto,
  AnswerResponseDto,
  GeneratedAnswerDto,
} from './dto/generate-answer.dto';
import { AiContextService } from './ai-context.service';
import { UsersService } from '../users/users.service';
import { CvService } from '../cv/cv.service';
import { InterviewsService } from '../interviews/interviews.service';
import {
  createOpenAIClient,
  getModelName,
  getModelForPlan,
} from '@common/utils/openai-client.factory';
import { OPENAI_TEMPERATURE, AI_MODELS, CACHE_TTL_MEDIUM } from '@common/constants';
import * as crypto from 'crypto';

@Injectable()
export class AiAnswerService {
  private readonly logger = new Logger(AiAnswerService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly contextService: AiContextService,
    private readonly usersService: UsersService,
    private readonly cvService: CvService,
    private readonly interviewsService: InterviewsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
    if (!this.openai) {
      this.logger.warn('OpenAI API key not configured. AI features will be disabled.');
    }
  }

  /**
   * Generate interview answer using AI
   */
  async generateAnswer(userId: string, dto: GenerateAnswerDto): Promise<AnswerResponseDto> {
    // Check if OpenAI is configured
    if (!this.openai) {
      throw new BadRequestException(
        'AI service is not configured. Please configure OPENAI_API_KEY in environment variables.',
      );
    }

    const startTime = Date.now();

    // Check cache with error handling
    const cacheKey = this.generateCacheKey(dto);
    let cached: AnswerResponseDto | undefined;
    try {
      cached = await this.cacheManager.get<AnswerResponseDto>(cacheKey);
      if (cached) {
        this.logger.log(`Answer retrieved from cache: ${cacheKey}`);
        return { ...cached, cached: true };
      }
    } catch (error) {
      // Graceful degradation: If cache fails, continue without cache
      this.logger.warn(`Cache GET failed for key ${cacheKey}: ${error.message}`);
      // Continue to generate answer
    }

    // Get user for plan-based model selection and language preference
    const user = await this.usersService.findById(userId);
    const model = this.getModelByPlan(user.subscription?.plan);

    // Get user language preference (PRIORITY: DTO > user.preferences.language > user.language > 'en')
    // Always prioritize DB values over defaults
    const language = dto.language || user.preferences?.language || user.language || 'en';

    // Log language for debugging
    this.logger.debug(
      `Generating answer for user ${userId} in language: ${language} (from: ${dto.language ? 'DTO' : user.preferences?.language ? 'preferences' : user.language ? 'user.language' : 'default'})`,
    );

    // Get or create session context
    let context: any = {};
    if (dto.sessionId) {
      context = await this.contextService.getContext(dto.sessionId);
    }

    // Get user CV data if available
    const cvData = await this.getUserCvData(userId);

    // Get user interview history for context
    const interviewHistory = await this.getUserInterviewHistory(userId);

    try {
      const answers: GeneratedAnswerDto[] = [];
      const variations = dto.variations || 1;

      for (let i = 0; i < variations; i++) {
        const answer = await this.generateSingleAnswer(
          dto,
          model,
          context,
          cvData,
          interviewHistory,
          language,
          i,
        );
        answers.push(answer);
      }

      const processingTime = Date.now() - startTime;
      const tokensUsed = this.estimateTokens(dto.question, answers);

      // Update context if session ID provided (optimized: parallel execution)
      if (dto.sessionId) {
        // Optimized: Update context in parallel (non-blocking) for faster response
        // Don't await - let it run in background
        Promise.all([
          this.contextService.addMessage(dto.sessionId, {
            role: 'user',
            content: dto.question,
            type: 'question',
            timestamp: new Date(),
          }),
          this.contextService.addMessage(dto.sessionId, {
            role: 'assistant',
            content: answers[0].content,
            type: 'answer',
            timestamp: new Date(),
          }),
        ]).catch((error) => {
          // Log but don't fail the request
          this.logger.warn(`Context update failed: ${error.message}`);
        });
      }

      const response: AnswerResponseDto = {
        answers,
        processingTime,
        tokensUsed,
        model,
        cached: false,
        sessionId: dto.sessionId,
      };

      // Cache response with error handling
      try {
        await this.cacheManager.set(cacheKey, response, CACHE_TTL_MEDIUM * 1000);
      } catch (error) {
        // Graceful degradation: If cache fails, log but don't fail request
        this.logger.warn(`Cache SET failed for key ${cacheKey}: ${error.message}`);
        // Continue - response is still returned to user
      }

      this.logger.log(
        `Answer generated in ${processingTime}ms using ${model} | Tokens: ${tokensUsed} | Est. Cost: $${(tokensUsed * 0.0000006).toFixed(6)}`,
      );
      return response;
    } catch (error) {
      this.logger.error(`Answer generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate single answer variant
   */
  private async generateSingleAnswer(
    dto: GenerateAnswerDto,
    model: string,
    context: any,
    cvData: any,
    interviewHistory: any,
    language: string,
    variantIndex: number,
  ): Promise<GeneratedAnswerDto> {
    if (!this.openai) {
      throw new BadRequestException('OpenAI service is not configured');
    }

    const style = dto.style || 'professional';
    const length = dto.length || 'medium';
    const variant =
      variantIndex === 0 ? style : ['professional', 'balanced', 'simple'][variantIndex % 3];

    const prompt = this.buildPrompt(
      dto,
      style,
      length,
      context,
      cvData,
      interviewHistory,
      language,
    );

    // Adjust temperature based on language to ensure consistency
    // Lower temperature for non-English to ensure language adherence
    const temperature = language !== 'en' ? Math.min(OPENAI_TEMPERATURE, 0.5) : OPENAI_TEMPERATURE;

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(variant, language),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: this.getMaxTokensByLength(length),
      temperature,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0].message.content || '{}';

    // Robust JSON parsing with error handling
    // AI sometimes returns malformed JSON (unterminated strings, markdown code blocks, etc.)
    let parsed: any;
    try {
      // Step 1: Clean response text before parsing
      let cleanedText = responseText.trim();

      // Remove markdown code blocks if present
      cleanedText = cleanedText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      // Step 2: Try to extract JSON object from response if it's wrapped in text
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }

      // Step 3: Try parsing as-is first
      parsed = JSON.parse(cleanedText);
    } catch (parseError: any) {
      this.logger.warn(
        `JSON parsing failed: ${parseError.message}. Attempting recovery. Response preview: ${responseText.substring(0, 300)}`,
      );

      // Step 4: Try to fix common JSON issues
      try {
        let fixedText = responseText.trim();

        // Remove markdown
        fixedText = fixedText.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

        // Extract JSON object
        const jsonMatch = fixedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          fixedText = jsonMatch[0];
        }

        // Fix unterminated strings: find the last incomplete string and close it
        // Count quotes to detect unterminated strings
        const quoteCount = (fixedText.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
          // Odd number of quotes means unterminated string
          // Find the last quote and add closing quote before the end
          const lastQuoteIndex = fixedText.lastIndexOf('"');
          const beforeQuote = fixedText.substring(0, lastQuoteIndex + 1);
          const afterQuote = fixedText.substring(lastQuoteIndex + 1);

          // If after quote doesn't have proper JSON structure, close the string
          if (!afterQuote.match(/^\s*[:}\],]/)) {
            // Find where to close: before next quote, comma, colon, or brace
            const nextSpecialChar = afterQuote.search(/["}\],:]/);
            if (nextSpecialChar > 0) {
              // Insert closing quote before special character
              fixedText = beforeQuote + '"' + afterQuote;
            } else {
              // No special char found, close at end
              fixedText = beforeQuote + '"' + afterQuote;
            }
          }
        }

        // Ensure JSON object is properly closed
        const openBraces = (fixedText.match(/\{/g) || []).length;
        const closeBraces = (fixedText.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
          fixedText += '}'.repeat(openBraces - closeBraces);
        }

        // Try parsing fixed text
        parsed = JSON.parse(fixedText);
        this.logger.log('Successfully parsed JSON after fixing common issues');
      } catch (fixError: any) {
        // Step 5: Try to extract partial data using regex
        try {
          this.logger.warn(`JSON fix failed: ${fixError.message}. Attempting regex extraction.`);

          // Extract answer field using regex (handles escaped quotes)
          // Match: "answer": "content" or "answer":"content"
          const answerRegex = /"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/;
          const answerMatch = responseText.match(answerRegex);

          // Extract keyPoints array
          const keyPointsRegex = /"keyPoints"\s*:\s*\[(.*?)\]/s;
          const keyPointsMatch = responseText.match(keyPointsRegex);

          if (answerMatch && answerMatch[1]) {
            // Unescape the answer
            const extractedAnswer = answerMatch[1]
              .replace(/\\"/g, '"')
              .replace(/\\n/g, '\n')
              .replace(/\\t/g, '\t')
              .replace(/\\\\/g, '\\');

            // Parse keyPoints if found
            let extractedKeyPoints: string[] = [];
            if (keyPointsMatch && keyPointsMatch[1]) {
              try {
                // Try to parse as JSON array
                const keyPointsArray = JSON.parse('[' + keyPointsMatch[1] + ']');
                extractedKeyPoints = Array.isArray(keyPointsArray)
                  ? keyPointsArray.filter(
                      (item) => typeof item === 'string' && item.trim().length > 0,
                    )
                  : [];
              } catch {
                // Fallback: split by comma and clean
                extractedKeyPoints = keyPointsMatch[1]
                  .split(',')
                  .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                  .filter((s) => s.length > 0);
              }
            }

            parsed = {
              answer: extractedAnswer,
              keyPoints: extractedKeyPoints,
              confidence: 0.7, // Lower confidence for extracted data
            };
            this.logger.log('Successfully extracted partial data from malformed JSON');
          } else {
            // Step 6: Last resort - use raw response as answer
            const rawAnswer = responseText
              .replace(/```json\s*/gi, '')
              .replace(/```/g, '')
              .replace(/^\{[\s\S]*"answer"\s*:\s*"/, '')
              .replace(/"[\s\S]*$/, '')
              .trim();

            parsed = {
              answer:
                rawAnswer.length > 0
                  ? rawAnswer
                  : "Kechirasiz, javobni qayta ishlashda xatolik yuz berdi. Iltimos qayta urinib ko'ring.",
              keyPoints: [],
              confidence: 0.5,
            };
            this.logger.warn('Using raw response as fallback due to JSON parsing failure');
          }
        } catch (extractError: any) {
          // Complete fallback - throw error
          this.logger.error(
            `All JSON parsing attempts failed. Last error: ${extractError.message}. Response: ${responseText.substring(0, 500)}`,
          );
          throw new BadRequestException(
            "AI javobini qayta ishlashda xatolik yuz berdi. Iltimos qayta urinib ko'ring yoki savolingizni qayta yozing.",
          );
        }
      }
    }

    // Validate that response is in the correct language (basic check)
    // If answer contains mostly English words and language is not English, log a warning
    if (language !== 'en' && parsed.answer) {
      const englishWordCount = (
        parsed.answer.match(
          /\b(the|is|are|was|were|have|has|had|will|would|can|could|should|this|that|with|from|for|and|or|but|in|on|at|to|of|a|an)\b/gi,
        ) || []
      ).length;
      const totalWordCount = parsed.answer.split(/\s+/).length;
      const englishRatio = totalWordCount > 0 ? englishWordCount / totalWordCount : 0;

      if (englishRatio > 0.3) {
        this.logger.warn(
          `Possible language mismatch: Answer for user language ${language} contains ${(englishRatio * 100).toFixed(1)}% English words. Response: ${parsed.answer.substring(0, 100)}...`,
        );
      }
    }

    return {
      variant,
      content: parsed.answer || '',
      keyPoints: parsed.keyPoints || [],
      starMethod: parsed.starMethod,
      confidence: parsed.confidence || 0.9,
      suggestedFollowups: parsed.suggestedFollowups || [],
    };
  }

  /**
   * Build prompt for answer generation
   * Professional Senior Prompt Engineer Logic: Comprehensive context, structured data, clear instructions
   */
  /**
   * Build prompt for answer generation
   * Professional Senior Prompt Engineer Logic: Comprehensive context, structured data, clear instructions
   */
  private buildPrompt(
    dto: GenerateAnswerDto,
    style: string,
    length: string,
    context: any,
    cvData: any,
    interviewHistory: any,
    language: string,
  ): string {
    // 1. Determine Question Type (Technical vs Behavioral)
    const isBehavioral = this.isBehavioralQuestion(dto.question);
    const isTechnical = this.isTechnicalQuestion(dto.question);
    // If not explicitly detected, assume technical/conceptual if it contains tech terms, else behavioral preference if CV is rich
    const effectiveType = isBehavioral ? 'behavioral' : 'technical'; 

    let prompt = `## INTERVIEW QUESTION\n`;
    prompt += `**Question:** "${dto.question}"\n\n`;

    // 2. Transcription Error Correction (Consolidated)
    prompt += `## TRANSCRIPTION CORRECTION\n`;
    prompt += `This question is from STT (Speech-to-Text). It may have typos (e.g., "nojes" -> "Node.js").\n`;
    prompt += `**Task:** Identify the intent. If it asks about a specific tech, answer about that tech.\n\n`;

    // 3. Live Context (Metadata)
    if (dto.domain || dto.technologies?.length || dto.position) {
      prompt += `## INTERVIEW CONTEXT\n`;
      if (dto.domain) prompt += `- Domain: ${dto.domain}\n`;
      if (dto.position) prompt += `- Position: ${dto.position}\n`;
      if (dto.technologies?.length) prompt += `- Stack: ${dto.technologies.join(', ')}\n`;
      prompt += `Use this to disambiguate terms (e.g., "Java" vs "JavaScript").\n\n`;
    }

    // 4. Previous Conversation (Last 3-5 messages only to save tokens)
    if (context.messages && context.messages.length > 0) {
      prompt += `## CONVERSATION HISTORY (Last 3)\n`;
      const recentMessages = context.messages.slice(-3); 
      recentMessages.forEach((msg: any, idx: number) => {
        const role = msg.role === 'user' ? 'Q' : 'A';
        const content = msg.content.length > 300 ? `${msg.content.substring(0, 300)}...` : msg.content;
        prompt += `${role}: ${content}\n`;
      });
      prompt += `\nIf this question is a follow-up, build on previous answers.\n\n`;
    }

    // 5. SMART CONTEXT INJECTION (The Core Optimization)
    if (cvData) {
        prompt += `## CANDIDATE BACKGROUND\n`;
        
        // Always show what the candidate KNOWS (Technologies/Skills)
        prompt += `**Known Technologies:** ${cvData.technologies?.join(', ') || 'N/A'}\n`;
        prompt += `**Education:** ${cvData.education?.map((e:any) => e.field).join(', ') || 'N/A'}\n\n`;

        // CONDITIONAL FULL CV INJECTION
        if (effectiveType === 'behavioral') {
            prompt += `**FULL CV TEXT (Use for Behavioral/Experience questions):**\n`;
            prompt += `"${cvData.fullText.substring(0, 4000)}"\n\n`; // Cap at 4000 chars
            prompt += `**INSTRUCTION:** Search the CV above. If the candidate has specific experience matching the question, cite it (Company, Project, Result). Use STAR method.\n`;
        } else {
            // Technical Question - DO NOT INJECT FULL CV
            prompt += `**NOTE:** Full CV omitted for this Technical/Conceptual question to save tokens.\n`;
            prompt += `**INSTRUCTION:** Answer as a knowledgeable candidate. Do NOT invent specific personal stories. Focus on explaining the concept ("What", "How", "Why").\n`;
            prompt += `Use "Men bilaman..." (I know...) or "Mening tajribamda..." (In my experience [general]).\n`;
        }
    }

    // 6. Output Requirements
    prompt += `## ANSWER REQUIREMENTS\n`;
    prompt += `- Style: ${style}\n`;
    prompt += `- Length: ${length}\n`;
    prompt += `- Language: ${language.toUpperCase()} ONLY.\n`;
    
    return prompt;
  }

  /**
   * Get style description
   */
  private getStyleDescription(style: string): string {
    const descriptions: Record<string, string> = {
      professional: 'polished, articulate, demonstrating leadership and expertise',
      balanced: 'clear, natural, balancing professionalism with authenticity',
      simple: 'straightforward, easy-to-understand, honest and relatable',
    };
    return descriptions[style] || descriptions['balanced'];
  }

  /**
   * Get length description
   */
  private getLengthDescription(length: string): string {
    const descriptions: Record<string, string> = {
      short: 'concise, 30-60 seconds when spoken',
      medium: 'moderate, 1-2 minutes when spoken',
      long: 'detailed, 2-3 minutes when spoken',
    };
    return descriptions[length] || descriptions['medium'];
  }

  /**
   * Get length word count
   */
  private getLengthWordCount(length: string): string {
    const counts: Record<string, string> = {
      short: '50-100',
      medium: '150-250',
      long: '300-500',
    };
    return counts[length] || counts['medium'];
  }

  /**
   * Check if question is technical
   */
  private isTechnicalQuestion(question: string): boolean {
    const technicalKeywords = [
      'algorithm',
      'data structure',
      'design pattern',
      'architecture',
      'database',
      'api',
      'framework',
      'language',
      'code',
      'programming',
      'implementation',
      'optimize',
      'performance',
      'scalability',
      'security',
      'testing',
      'debugging',
      'system design',
      'how would you',
      'explain',
      'what is',
      'difference between',
    ];
    const lowerQuestion = question.toLowerCase();
    return technicalKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  /**
   * Get system prompt based on style and language
   */
  /**
   * Get system prompt - Master Instructions (Optimized)
   * Consolidates Role, Tone, Language, and Output Format to save User Prompt tokens.
   */
  private getSystemPrompt(style: string, language: string = 'en'): string {
    const languageName = this.getLanguageName(language);
    const languageCode = language.toUpperCase();

    // 1. ROLE DEFINITION
    let systemPrompt = `ROLE: You are an expert Software Engineer candidate in a job interview.\n`;
    systemPrompt += `TASK: Generate a perfect, ${style} answer to the interviewer's question.\n`;
    systemPrompt += `PERSPECTIVE: Speak in FIRST PERSON ("I...", "Men...", "Mening...").\n`;
    systemPrompt += `Never say "If you..." or "You should...". You ARE the candidate.\n\n`;

    // 2. LANGUAGE RULES (Strict)
    systemPrompt += `LANGUAGE: Respond EXCLUSIVELY in ${languageName} (${languageCode}).\n`;
    systemPrompt += `Do NOT use English unless the question asks for an English answer.\n\n`;

    // 3. TONE & STYLE
    const toneMap: Record<string, string> = {
      professional: 'Polished, articulate, senior-level expert.',
      balanced: 'Natural, confident, human-like (not robotic).',
      simple: 'Straightforward, easy to understand, relatable.',
    };
    systemPrompt += `TONE: ${toneMap[style] || toneMap['balanced']}\n`;
    systemPrompt += `Make it sound like a REAL person, not ChatGPT. Use simple words where possible.\n\n`;

    // 4. OUTPUT FORMAT (JSON only)
    systemPrompt += `OUTPUT FORMAT: Return STRICT JSON only. No markdown before/after.\n`;
    systemPrompt += `Structure:\n`;
    systemPrompt += `{\n`;
    systemPrompt += `  "answer": "The text of your answer (in ${languageName})",\n`;
    systemPrompt += `  "keyPoints": ["Key point 1", "Key point 2"],\n`;
    systemPrompt += `  "starMethod": { "situation": "...", "task": "...", "action": "...", "result": "..." }, // Use only for behavioral questions\n`;
    systemPrompt += `  "confidence": 0.95,\n`;
    systemPrompt += `  "suggestedFollowups": ["Question 1?", "Question 2?"]\n`;
    systemPrompt += `}\n\n`;

    // 5. CRITICAL LOGIC
    systemPrompt += `LOGIC:\n`;
    systemPrompt += `- If the question implies you don't know something (and it's not in the Context), admit it professionally or give a theoretical answer.\n`;
    systemPrompt += `- Correct any transcription typos in the question (e.g., "nojes" -> "Node.js") silently and answer the INTENDED question.\n`;
    systemPrompt += `- If asked for code, use markdown code blocks inside the "answer" string.\n`;

    return systemPrompt;
  }

  private getSystemPrompt_Legacy(style: string, language: string = 'en'): string {
    const languageName = this.getLanguageName(language);
    const languageCode = language.toUpperCase();

    // Language-specific system prompts for better adherence
    const languageInstructions: Record<string, string> = {
      uz: `Siz IT sohasida professional intervyu murabbiysi va texnik mentorsiz. Barcha javoblarni O'ZBEK TILIDA berishingiz kerak. Hech qachon ingliz yoki boshqa tillarda javob bermang. Javoblaringiz xuddi haqiqiy odam gapirayotgandek sodda, tushunarli va do'stona bo'lsin.`,
      ru: `Вы профессиональный тренер по IT-собеседованиям и технический наставник. Вы ДОЛЖНЫ отвечать на РУССКОМ ЯЗЫКЕ. Никогда не отвечайте на английском или других языках. Ваши ответы должны быть простыми, понятными и дружелюбными, как будто отвечает реальный человек.`,
      en: `You are a professional IT interview coach and technical mentor. You MUST respond in ENGLISH. Never respond in other languages. Your answers should be simple, easy to understand, and friendly - like a real person talking.`,
    };

    const basePrompts: Record<string, string> = {
      professional:
        'You are an expert IT interview coach and technical mentor. Provide articulate, polished answers that demonstrate deep knowledge but in a simple, human-like way.',
      balanced:
        'You are an IT interview coach and technical mentor. Provide clear, natural answers that balance professionalism with authenticity. Speak like a real person, not a robot.',
      simple:
        'You are an IT interview coach and technical mentor. Provide straightforward, easy-to-understand answers like a friendly colleague explaining things.',
    };
    const basePrompt = basePrompts[style] || basePrompts['balanced'];

    // Add explicit language instruction in the target language itself
    const languageInstruction = languageInstructions[language] || languageInstructions['en'];

    // Critical instructions for answer types - IT Interview focused
    const answerTypeInstructions = `

🎯 **IT INTERVYU KONTEKSTI - MUHIM!**
Bu IT sohasidagi intervyu savollari. Savollar dasturlash, texnologiyalar, framework'lar, 
database'lar, API'lar, arxitektura va boshqa IT mavzulari haqida bo'ladi.

📝 **TRANSKRIPTSIYA XATOLARINI AVTOMATIK TUZATISH - JUDA MUHIM!**
Savollar AUDIO dan TEXT ga aylantirilgan bo'lishi mumkin. Shuning uchun:
- Sintaksis xatolari bo'lishi mumkin (masalan: "riekt" → "React", "nodjes" → "Node.js")
- Texnologiya nomlari noto'g'ri yozilishi mumkin (masalan: "postgressql" → "PostgreSQL")
- So'zlar qo'shib yoki ajratib yozilishi mumkin (masalan: "java script" → "JavaScript")
- Harflar almashib ketishi mumkin (masalan: "mongodv" → "MongoDB")

⚡ **SEN QILISHING KERAK:**
1. Xatoli so'zlarni o'zing tuzat va to'g'ri ma'noni tushun
2. Savolning ASLIY maqsadini anglab ol
3. To'g'ri texnologiya/konseptni aniqlash uchun kontekstdan foydalang
4. Hech qachon "tushunmadim" dema - o'zing tuzatib javob ber

🗣️ **JAVOB BERISH USLUBI - HAQIQIY ODAM KABI!**
Javoblaringiz xuddi TAJRIBALI DASTURCHI do'stingiz gapirayotgandek bo'lsin:
- SODDA va TUSHUNARLI til ishlat
- Murakkab tushunchalarni ODDIY so'zlar bilan tushuntir
- Texnik atamalarni ishlatganda QISQA izoh qo'sh
- QISQA jumlalar yoz, uzun paragraflardan qoching
- Haqiqiy misollar va analogiyalar keltir

💻 **KOD MISOLLARI - MAJBURIY QOIDALAR!**
Qachonki:
- Savol "qanday yoziladi", "misol keltiring", "kod ko'rsating" desa
- Yoki savol sintaksis/implementatsiya haqida bo'lsa
- Yoki tushuntirish uchun kod kerak bo'lsa

ALBATTA kod misolini \`\`\`code\`\`\` blokida ko'rsat:

\`\`\`javascript
// Misol: React component
function HelloWorld() {
  return <h1>Salom Dunyo!</h1>;
}
\`\`\`

**Kod blok qoidalari:**
- Har doim tilni ko'rsat: \`\`\`javascript, \`\`\`python, \`\`\`sql, \`\`\`typescript va h.k.
- Kod ichida IZOHLAR yoz (o'zbek tilida bo'lishi mumkin)
- Kodni YANGI QATORDAN boshlash
- Amaliy, ISHLAYDIGAN kod yoz

CRITICAL ANSWER TYPE RULES:

1. TECHNICAL/CONCEPTUAL Questions ("What is X?", "How does Y work?", "Explain Z", "Define...", "nima", "qanday ishlaydi", "tushuntiring"):
   
   ✅ REQUIRED APPROACH:
   - SODDA tilda tushuntir, xuddi do'stingga gapirayotgandek
   - Avval ODDIY ta'rif ber, keyin chuqurroq tushuntir
   - Real hayotdan ANALOGIYA keltir (masalan: "API bu restoran ofitsiantiga o'xshaydi...")
   - Keyin AMALIY misol yoki kod ko'rsat
   - "Bu nima uchun kerak?" savoliga javob ber
   
   📌 Misol javob strukturasi:
   "X bu - [ODDIY ta'rif]. 
    Oddiy qilib aytganda, [real hayot analogiyasi].
    
    Masalan:
    \`\`\`code
    // amaliy misol
    \`\`\`
    
    Bu kerak chunki [foydalari]."

2. BEHAVIORAL Questions ("Tell me about a time...", "Give me an example when...", "Describe a situation...", "tajribangiz", "qanday hal qildingiz"):
   ✅ REQUIRED:
   - Use STAR method (Situation, Task, Action, Result)
   - Reference REAL examples from candidate's CV
   - Include specific: company names, project names, metrics, outcomes
   - Use personal pronouns ("men"/"I") and past tense
   - Be concrete and specific with details
   - SODDA va QISQA hikoya qilib aytib ber

3. EXPERIENCE/PROJECT Questions ("ishlatganmisiz", "tajribangiz bormi", "have you used"):
   🔍 **MANDATORY CV SEARCH - STEP BY STEP:**
   
   **Step 1: Extract Technologies** - Savoldan texnologiyalarni ajrat
   **Step 2: Search FULL CV Text** - CV dan qidir
   **Step 3: Match & Verify** - Topilganlarni tekshir
   **Step 4: Construct Answer** - SODDA javob yoz
   
   Agar texnologiya bilan ishlamagan bo'lsang, HALOL ayt va umumiy bilimingni baham ko'r.
   
   **Step 5: Code Examples** - Agar so'ralsa, ALBATTA kod blokda ko'rsat:
   \`\`\`sql
   SELECT * FROM users WHERE active = true;
   \`\`\`
   
   ⚠️ **CRITICAL RULES:**
   - CV da bo'lmagan tajribani TO'QIMA
   - Bilmagan narsangni bilaman dema
   - Ammo umumiy bilimingni baham ko'r`;

    return `${basePrompt}\n\n${languageInstruction}\n${answerTypeInstructions}\n\nCRITICAL RULE: All JSON response fields (answer, keyPoints, starMethod, suggestedFollowups) MUST be in ${languageName} (${languageCode}). If you respond in English or any other language, the response will be rejected.`;
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
   * Detect potential transcription errors in question
   * Dynamic error detection based on actual question content
   */
  private detectPotentialErrors(
    question: string,
    technologies: string[],
    language: string,
  ): string[] {
    const errors: string[] = [];
    const lowerQuestion = question.toLowerCase();

    // Check for common word boundary errors
    if (language === 'uz' || language === 'ru') {
      // Check for missing spaces (common in speech-to-text)
      const wordBoundaryPattern = /[а-яёa-z][А-ЯЁA-Z]/;
      if (wordBoundaryPattern.test(question)) {
        errors.push('Potential word boundary errors detected (missing spaces)');
      }
    }

    // Check for technology name variations (common mispronunciations)
    technologies.forEach((tech) => {
      const techLower = tech.toLowerCase();
      const variations = [
        techLower.replace(/\./g, ' '), // "node.js" -> "node js"
        techLower.replace(/-/g, ' '), // "socket.io" -> "socket io"
        techLower.replace(/\./g, ''), // "node.js" -> "nodejs"
      ];
      variations.forEach((variation) => {
        if (lowerQuestion.includes(variation) && !lowerQuestion.includes(techLower)) {
          errors.push(`Technology "${tech}" may be misspelled as "${variation}"`);
        }
      });
    });

    // Check for very short words that might be typos
    const words = question.split(/\s+/);
    const suspiciousShortWords = words.filter((w) => w.length <= 2 && /[a-zа-яё]/.test(w));
    if (suspiciousShortWords.length > 3) {
      errors.push('Multiple very short words detected (possible transcription errors)');
    }

    return errors;
  }

  /**
   * Get error types for specific language
   * Dynamic error patterns based on language
   */
  private getErrorTypesForLanguage(language: string): string[] {
    const errorTypes: Record<string, string[]> = {
      uz: [
        'Syntax errors (typos, wrong word forms)',
        'Grammar mistakes (verb conjugation, word order)',
        'Missing words or punctuation',
        'Technical term mispronunciations',
        'Language mixing (Uzbek words mixed with Russian/English)',
        'Word boundary errors (missing spaces between words)',
      ],
      ru: [
        'Syntax errors (typos, wrong word forms)',
        'Grammar mistakes (case endings, verb forms)',
        'Missing words or punctuation',
        'Technical term mispronunciations',
        'Language mixing (Russian words mixed with English)',
        'Word boundary errors (missing spaces)',
      ],
      en: [
        'Syntax errors (typos, wrong word forms)',
        'Grammar mistakes (articles, verb tenses)',
        'Missing words or punctuation',
        'Technical term mispronunciations',
        'Word boundary errors (missing spaces)',
      ],
    };

    return errorTypes[language] || errorTypes['en'];
  }

  /**
   * Extract technical terms from question
   * Dynamic extraction based on question and selected technologies
   */
  private extractTechnicalTerms(question: string, technologies: string[]): string[] {
    const terms: string[] = [];
    const lowerQuestion = question.toLowerCase();

    // Extract mentioned technologies
    technologies.forEach((tech) => {
      const techLower = tech.toLowerCase();
      if (lowerQuestion.includes(techLower)) {
        terms.push(tech);
      }
    });

    // Extract common technical keywords
    const technicalKeywords = [
      'algorithm',
      'data structure',
      'design pattern',
      'architecture',
      'database',
      'api',
      'framework',
      'language',
      'code',
      'programming',
      'implementation',
      'optimization',
      'performance',
      'scalability',
      'security',
      'testing',
      'debugging',
      'system design',
    ];

    technicalKeywords.forEach((keyword) => {
      if (lowerQuestion.includes(keyword)) {
        terms.push(keyword);
      }
    });

    return terms.length > 0 ? terms : [];
  }

  /**
   * Extract technologies from question
   * Dynamic extraction for CV search process
   */
  private extractTechnologiesFromQuestion(
    question: string,
    selectedTechnologies: string[],
  ): string[] {
    const found: string[] = [];
    const lowerQuestion = question.toLowerCase();

    // Check selected technologies first (most relevant)
    selectedTechnologies.forEach((tech) => {
      const techLower = tech.toLowerCase();
      // Check for exact match or common variations
      if (
        lowerQuestion.includes(techLower) ||
        lowerQuestion.includes(techLower.replace(/\./g, ' ')) ||
        lowerQuestion.includes(techLower.replace(/-/g, ' '))
      ) {
        found.push(tech);
      }
    });

    // Also check for common technologies mentioned in question
    const commonTechs = [
      'javascript',
      'typescript',
      'python',
      'java',
      'react',
      'vue',
      'angular',
      'node',
      'express',
      'mysql',
      'postgresql',
      'mongodb',
      'redis',
      'docker',
      'kubernetes',
      'aws',
      'azure',
      'gcp',
    ];

    commonTechs.forEach((tech) => {
      if (lowerQuestion.includes(tech) && !found.some((f) => f.toLowerCase().includes(tech))) {
        found.push(tech);
      }
    });

    return found;
  }

  /**
   * Check if question is behavioral or experience-based
   */
  private isBehavioralQuestion(question: string): boolean {
    const behavioralKeywords = [
      'tell me about a time',
      'describe a situation',
      'give me an example',
      'have you ever',
      'can you share',
      'when did you',
      'conflict',
      'challenge',
      'difficult',
      'mistake',
      'failure',
      'success',
      // Experience/Project questions - Uzbek
      'qanday loyihalar',
      'qaysidur loyiha',
      'loyihalarda ishlat',
      "loyihalarda qo'lla",
      'ishlatganmisiz',
      "qo'llaganmisiz",
      'ishlaganmisiz',
      'qilganmisiz',
      'loyihalar qildingiz',
      'ishlagan loyihalar',
      'qilgan ishlar',
      'bilan ishlagan',
      'bilan qanday',
      'tajribangiz',
      // Experience/Project questions - English
      'what projects',
      'which projects',
      'your projects',
      'projects you',
      'worked on',
      'have you worked',
      'did you work',
      'have you used',
      'did you use',
      'your experience with',
      'experience with',
      'worked with',
      // Russian
      'какие проекты',
      'работали с',
      'использовали',
    ];
    const lowerQuestion = question.toLowerCase();
    return behavioralKeywords.some((keyword) => lowerQuestion.includes(keyword));
  }

  /**
   * Get max tokens by length
   */
  private getMaxTokensByLength(length: string): number {
    const tokens: Record<string, number> = {
      short: 300,
      medium: 600,
      long: 1000,
    };
    return tokens[length] || tokens['medium'];
  }

  /**
   * Get user CV data with extracted technologies and education
   */
  private async getUserCvData(userId: string): Promise<any> {
    try {
      // Get user's latest CV
      const cvs = await this.cvService.getUserCvs(userId, 1, 0);
      if (cvs.length === 0) {
        return null;
      }

      const cv = cvs[0];
      const parsedData = cv.parsedData || {};

      // Extract technologies from CV
      const cvTechnologies = this.extractTechnologiesFromCv(cv.parsedText || '', parsedData);

      // Extract education/degree information
      const education = this.extractEducationFromCv(parsedData);

      // CRITICAL: Return FULL CV text instead of parsed data
      // Reason: regex-based parsing is too simple and misses a lot of information
      // The AI should work with the full CV text to extract relevant information
      return {
        // Full CV text - contains ALL information
        fullText: cv.parsedText || '',
        // Basic info from parsed data (name, email, etc.)
        personalInfo: parsedData.personalInfo || {},
        // Skills list for quick reference
        skills: parsedData.skills || [],
        // Extracted technologies from CV
        technologies: cvTechnologies,
        // Education information
        education: education,
        // Experience information (for context)
        experience: parsedData.experience || [],
        // Analysis insights if available
        analysis: cv.analysis
          ? {
              atsScore: cv.analysis.atsScore,
              strengths: cv.analysis.strengths || [],
            }
          : null,
      };
    } catch (error) {
      this.logger.warn(`Failed to get CV data for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract technologies from CV text and parsed data
   */
  private extractTechnologiesFromCv(cvText: string, parsedData: any): string[] {
    const technologies: Set<string> = new Set();
    const lowerText = cvText.toLowerCase();

    // Common technology keywords
    const techKeywords = [
      // Frontend
      'react',
      'vue',
      'angular',
      'svelte',
      'next.js',
      'nextjs',
      'nuxt',
      'gatsby',
      // Backend
      'node.js',
      'nodejs',
      'node',
      'express',
      'nestjs',
      'fastify',
      'koa',
      'python',
      'django',
      'flask',
      'fastapi',
      'tornado',
      'java',
      'spring',
      'spring boot',
      'hibernate',
      'c#',
      'csharp',
      '.net',
      'asp.net',
      'dotnet',
      'php',
      'laravel',
      'symfony',
      'codeigniter',
      'go',
      'golang',
      'rust',
      'ruby',
      'rails',
      // Databases
      'mysql',
      'postgresql',
      'postgres',
      'mongodb',
      'mongo',
      'redis',
      'cassandra',
      'elasticsearch',
      'dynamodb',
      'sqlite',
      // Cloud & DevOps
      'aws',
      'azure',
      'gcp',
      'docker',
      'kubernetes',
      'k8s',
      'terraform',
      'jenkins',
      'gitlab ci',
      'github actions',
      'ansible',
      // Mobile
      'react native',
      'flutter',
      'swift',
      'kotlin',
      'ios',
      'android',
      // Other
      'typescript',
      'javascript',
      'js',
      'ts',
      'html',
      'css',
      'sass',
      'scss',
      'graphql',
      'rest api',
      'microservices',
      'serverless',
    ];

    // Extract from skills
    if (parsedData.skills && Array.isArray(parsedData.skills)) {
      parsedData.skills.forEach((skill: string) => {
        const skillLower = skill.toLowerCase();
        techKeywords.forEach((keyword) => {
          if (skillLower.includes(keyword) || keyword.includes(skillLower)) {
            technologies.add(keyword);
          }
        });
      });
    }

    // Extract from experience
    if (parsedData.experience && Array.isArray(parsedData.experience)) {
      parsedData.experience.forEach((exp: any) => {
        const expText = (exp.description || exp.responsibilities || '').toLowerCase();
        techKeywords.forEach((keyword) => {
          if (expText.includes(keyword)) {
            technologies.add(keyword);
          }
        });
      });
    }

    // Extract from full text
    techKeywords.forEach((keyword) => {
      if (lowerText.includes(keyword)) {
        technologies.add(keyword);
      }
    });

    return Array.from(technologies);
  }

  /**
   * Extract education information from CV
   */
  private extractEducationFromCv(parsedData: any): any {
    if (!parsedData.education || !Array.isArray(parsedData.education)) {
      return null;
    }

    const education = parsedData.education.map((edu: any) => ({
      degree: edu.degree || edu.qualification || '',
      field: edu.field || edu.major || edu.specialization || '',
      institution: edu.institution || edu.university || edu.school || '',
      year: edu.year || edu.graduationYear || '',
    }));

    return education.length > 0 ? education : null;
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(dto: GenerateAnswerDto): string {
    const key = `answer:${crypto
      .createHash('md5')
      .update(
        JSON.stringify({
          question: dto.question,
          style: dto.style,
          length: dto.length,
          jobDesc: dto.jobDescription?.substring(0, 100),
        }),
      )
      .digest('hex')}`;
    return key;
  }

  /**
   * Estimate tokens used
   */
  private estimateTokens(question: string, answers: GeneratedAnswerDto[]): number {
    const questionTokens = Math.ceil(question.length / 4);
    const answerTokens = answers.reduce((sum, a) => sum + Math.ceil(a.content.length / 4), 0);
    return questionTokens + answerTokens;
  }

  /**
   * Get AI model based on subscription plan
   * Supports OpenRouter with automatic model mapping
   */
  private getModelByPlan(plan?: string): string {
    return getModelForPlan(this.configService, plan || 'free', AI_MODELS.GPT35, AI_MODELS.GPT4);
  }

  /**
   * Get user interview history for context
   */
  private async getUserInterviewHistory(userId: string): Promise<any> {
    try {
      const analytics = await this.interviewsService.getAnalytics(userId);

      if (!analytics || analytics.totalInterviews === 0) {
        return null;
      }

      // Get recent sessions to identify weak/strong areas
      const recentSessions = await this.interviewsService.getHistory(userId, 10, 0);

      const weakAreas: string[] = [];
      const strongAreas: string[] = [];

      // Analyze feedback from recent sessions
      recentSessions.forEach((session: any) => {
        if (session.feedback?.summary?.weaknesses) {
          weakAreas.push(...session.feedback.summary.weaknesses);
        }
        if (session.feedback?.summary?.strengths) {
          strongAreas.push(...session.feedback.summary.strengths);
        }
      });

      return {
        totalInterviews: analytics.totalInterviews,
        completedInterviews: analytics.completedInterviews,
        averageScore: analytics.averageScore || 0,
        weakAreas: [...new Set(weakAreas)].slice(0, 5),
        strongAreas: [...new Set(strongAreas)].slice(0, 5),
        practicedTopics: analytics.practicedTopics || {},
      };
    } catch (error) {
      this.logger.warn(`Failed to get interview history for user ${userId}: ${error.message}`);
      return null;
    }
  }
}
