import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NormalizedProfileDto } from './dto/normalized-profile.dto';

@Injectable()
export class ProfileNormalizationService {
  private readonly logger = new Logger(ProfileNormalizationService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Normalizes free-text user input into a structured profile object.
   * Uses AI to map text to system enums for Position, Goal, and Tech Stack.
   *
   * @param text User's description (e.g., "I'm a senior react dev looking for a job")
   * @returns NormalizedProfileDto with standard enums
   */
  async normalizeProfile(text: string): Promise<NormalizedProfileDto> {
    const startTime = Date.now();
    this.logger.debug(`Normalizing profile text: "${text}"`);

    const prompt = `
    You are an informational extraction AI. Analyze the user's description and map it to the following strict enums.
    
    TAXONOMY:
    1. Position: 'junior', 'middle', 'senior', 'lead'
    2. Goal: 'job_search', 'career_growth', 'learning'
    3. Tech Stack: Array of standard technology names (e.g. "React", "Node.js", "Python"). Normalize synonyms (e.g. "Reaction.js" -> "React").

    INPUT TEXT:
    "${text}"

    INSTRUCTIONS:
    - Infer 'Position' based on years of experience or explicit titles. Default to 'junior' if unclear.
    - Infer 'Goal' based on context (e.g., "looking for work" -> "job_search"). Default to 'career_growth'.
    - Extract 'Tech Stack' mentioned or implied.
    - Return a 'confidence' score (0.0 to 1.0) indicating certainty.

    OUTPUT JSON ONLY:
    {
      "position": "enum_value",
      "techStack": ["Tech1", "Tech2"],
      "goal": "enum_value",
      "confidence": 0.95
    }
    `;

    try {
      const response = await axios.post(
        this.configService.get('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.configService.get('OPENROUTER_MODEL') || 'z-ai/glm-4-32b',
          messages: [
            {
              role: 'system',
              content: 'You are a precise data normalization assistant. Output valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1, // Low temperature for deterministic results
          max_tokens: 300,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.configService.get('OPENAI_API_KEY')}`,
            'HTTP-Referer': this.configService.get('OPENROUTER_HTTP_REFERER'),
            'X-Title': this.configService.get('OPENROUTER_X_TITLE'),
          },
          timeout: 10000, // 10s timeout
        },
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from AI provider');
      }

      const parsed: any = JSON.parse(content);

      // Validate and sanitize output
      const normalized: NormalizedProfileDto = {
        position: this.validateEnum(
          parsed.position,
          ['junior', 'middle', 'senior', 'lead'],
          'junior',
        ),
        goal: this.validateEnum(
          parsed.goal,
          ['job_search', 'career_growth', 'learning'],
          'career_growth',
        ),
        techStack: Array.isArray(parsed.techStack)
          ? parsed.techStack.filter((s: any) => typeof s === 'string')
          : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };

      this.logger.log(
        `Profile normalized in ${Date.now() - startTime}ms: ${JSON.stringify(normalized)}`,
      );

      return normalized;
    } catch (error: any) {
      this.logger.error(`Profile normalization failed: ${error.message}`);
      // Return safe default on error
      return {
        position: 'junior',
        goal: 'career_growth',
        techStack: [],
        confidence: 0,
      };
    }
  }

  private validateEnum(value: any, allowed: string[], fallback: any): any {
    if (allowed.includes(value)) {
      return value;
    }
    return fallback;
  }
}
