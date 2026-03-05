import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { SegmentQuestion, SegmentQuestionDocument } from './schemas/segment-question.schema';
import { CareerPath, CareerPathDocument } from './schemas/career-path.schema';
import axios from 'axios';
import { buildSegmentQuestionGenerationPrompt } from '@common/constants/ai-prompts.constant';

/**
 * Segment Question Generator Service
 *
 * Generates interview questions per SEGMENT (not per user!):
 * (Career Path + Position + Week Pattern)
 *
 * SHARED ACROSS ALL USERS in the same segment!
 *
 * COST OPTIMIZATION (1M users):
 * - Without this: 1M users × 3 questions = 3M AI calls/day = $3,000/day
 * - With segments: ~50 active segments × 3 questions = 150 AI calls/day = $0.15/day
 * - Savings: 99.995%!
 *
 * STRATEGY:
 * 1. User requests daily tasks
 * 2. Check if segment questions exist for (careerPath + position + week)
 * 3. If exists, return to ALL users in segment
 * 4. If not, generate with AI once, cache for segment
 * 5. Regenerate every 90 days for freshness
 */

@Injectable()
export class SegmentQuestionGeneratorService {
  private readonly logger = new Logger(SegmentQuestionGeneratorService.name);

  constructor(
    @InjectModel(SegmentQuestion.name)
    private readonly segmentQuestionModel: Model<SegmentQuestionDocument>,
    @InjectModel(CareerPath.name)
    private readonly careerPathModel: Model<CareerPathDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get questions for a user segment
   *
   * FLOW:
   * 1. Check cache for segment (careerPath + position + week)
   * 2. If exists, return cached questions
   * 3. If not, generate with AI and cache
   */
  async getQuestionsForSegment(
    careerPathSlug: string,
    position: 'junior' | 'middle' | 'senior' | 'lead',
    type: 'technical' | 'behavioral' | 'system_design',
  ): Promise<{
    questions: {
      question: string;
      context?: string;
      hints: string[];
      difficulty: number;
      estimatedTime: number;
      tags: string[];
    }[];
    isNewGeneration: boolean;
  }> {
    try {
      const weekNumber = this.getCurrentWeekNumber();

      // Step 1: Check cache
      let segmentQuestions = await this.segmentQuestionModel.findOne({
        careerPathSlug,
        position,
        weekNumber,
        type,
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      if (segmentQuestions) {
        this.logger.debug(
          `Cache HIT: ${careerPathSlug}/${position}/week${weekNumber}/${type} | ` +
            `Served ${segmentQuestions.timesServed} times`,
        );

        // Update usage stats
        await this.segmentQuestionModel.findByIdAndUpdate(segmentQuestions._id, {
          $inc: { timesServed: 1 },
        });

        return {
          questions: segmentQuestions.questions,
          isNewGeneration: false,
        };
      }

      // Step 2: Cache MISS - Generate with AI
      this.logger.log(
        `Cache MISS: Generating for ${careerPathSlug}/${position}/week${weekNumber}/${type}`,
      );

      const generated = await this.generateWithAI(careerPathSlug, position, type, weekNumber);

      // Step 3: Store in cache
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

      segmentQuestions = await this.segmentQuestionModel.create({
        careerPathSlug,
        position,
        weekNumber,
        type,
        questions: generated.questions,
        aiMetadata: generated.metadata,
        timesServed: 1,
        expiresAt,
        isActive: true,
      });

      this.logger.log(
        `✅ Generated and cached: ${careerPathSlug}/${position}/week${weekNumber}/${type} | ` +
          `Cost: $${generated.metadata.cost.toFixed(4)}`,
      );

      return {
        questions: generated.questions,
        isNewGeneration: true,
      };
    } catch (error) {
      this.logger.error(`Failed to get questions: ${error.message}`, error.stack);
      return {
        questions: this.getFallbackQuestions(type, position),
        isNewGeneration: false,
      };
    }
  }

  /**
   * Generate questions using Z-AI GLM-4-32B
   *
   * Generates 3 questions at once (one API call):
   * - 1 Technical / Behavioral / System Design
   * - Customized for specific career path and position
   */
  private async generateWithAI(
    careerPathSlug: string,
    position: string,
    type: string,
    weekNumber: number,
  ): Promise<{
    questions: any[];
    metadata: any;
  }> {
    const startTime = Date.now();

    // Get career path details
    const careerPath = await this.careerPathModel.findOne({ slug: careerPathSlug }).lean();
    const careerName = careerPath?.name?.en || careerPathSlug;
    const technologies = careerPath?.commonTechnologies?.join(', ') || 'relevant technologies';

    const prompt = buildSegmentQuestionGenerationPrompt({
      careerName,
      position,
      type,
      technologies,
      weekNumber,
    });

    try {
      const response = await axios.post(
        this.configService.get('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.configService.get('OPENROUTER_MODEL') || 'z-ai/glm-4-32b',
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.8,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.configService.get('OPENAI_API_KEY')}`,
            'HTTP-Referer': this.configService.get('OPENROUTER_HTTP_REFERER'),
            'X-Title': this.configService.get('OPENROUTER_X_TITLE'),
          },
          timeout: 30000, // 30 second timeout
        },
      );

      const generationTime = Date.now() - startTime;
      const content = JSON.parse(response.data.choices[0].message.content);
      const tokensUsed = response.data.usage?.total_tokens || 0;
      const cost = tokensUsed * 0.000001; // Approximate cost per token

      this.logger.log(
        `AI Generation: ${careerPathSlug}/${position}/${type} | ` +
          `Tokens: ${tokensUsed}, Time: ${generationTime}ms, Cost: $${cost.toFixed(4)}`,
      );

      // Validate response
      if (!Array.isArray(content.questions) || content.questions.length !== 3) {
        throw new Error('Invalid AI response format');
      }

      return {
        questions: content.questions.map((q: any) => ({
          question: q.question,
          context: q.context || '',
          hints: q.hints || [],
          difficulty: q.difficulty || 5,
          estimatedTime: q.estimatedTime || 15,
          tags: q.tags || [],
        })),
        metadata: {
          generatedBy: this.configService.get('OPENROUTER_MODEL'),
          model: this.configService.get('OPENROUTER_MODEL'),
          tokensUsed,
          generationTime,
          cost,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`AI generation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get current week number (1-52)
   * Questions rotate weekly by topic
   */
  private getCurrentWeekNumber(): number {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    return Math.min(Math.ceil(dayOfYear / 7), 52);
  }

  /**
   * Fallback questions if AI fails
   */
  private getFallbackQuestions(type: string, position: string): any[] {
    const fallbacks: Record<string, Record<string, any[]>> = {
      technical: {
        junior: [
          {
            question: 'Explain the difference between let, const, and var.',
            hints: ['Scope', 'Reassignment', 'Best practices'],
            difficulty: 3,
            estimatedTime: 5,
            tags: ['javascript', 'basics'],
            context: '',
          },
          {
            question: 'What is a REST API?',
            hints: ['HTTP methods', 'JSON format', 'Stateless'],
            difficulty: 4,
            estimatedTime: 10,
            tags: ['api', 'web'],
            context: '',
          },
          {
            question: 'How do you handle errors in JavaScript?',
            hints: ['Try-catch', 'Async errors', 'Error boundaries'],
            difficulty: 5,
            estimatedTime: 10,
            tags: ['javascript', 'error-handling'],
            context: '',
          },
        ],
        middle: [
          {
            question: 'Explain event loop in Node.js',
            hints: ['Call stack', 'Event queue', 'Microtasks'],
            difficulty: 6,
            estimatedTime: 15,
            tags: ['nodejs', 'async'],
            context: '',
          },
          {
            question: 'What are React Hooks?',
            hints: ['useState', 'useEffect', 'Custom hooks'],
            difficulty: 6,
            estimatedTime: 15,
            tags: ['react', 'hooks'],
            context: '',
          },
          {
            question: 'Describe SOLID principles',
            hints: ['Single responsibility', 'Open/closed', 'Liskov substitution'],
            difficulty: 7,
            estimatedTime: 20,
            tags: ['design-patterns', 'architecture'],
            context: '',
          },
        ],
        senior: [
          {
            question: 'Design a microservices architecture',
            hints: ['Service boundaries', 'Communication', 'Data consistency'],
            difficulty: 8,
            estimatedTime: 30,
            tags: ['architecture', 'microservices'],
            context: '',
          },
          {
            question: 'Explain database sharding',
            hints: ['Horizontal partitioning', 'Shard key', 'Rebalancing'],
            difficulty: 8,
            estimatedTime: 25,
            tags: ['database', 'scaling'],
            context: '',
          },
          {
            question: 'Implement CI/CD pipeline',
            hints: ['Build', 'Test', 'Deploy', 'Monitoring'],
            difficulty: 8,
            estimatedTime: 30,
            tags: ['devops', 'cicd'],
            context: '',
          },
        ],
        lead: [
          {
            question: 'Balance technical debt vs features',
            hints: ['Business impact', 'Team velocity', 'Refactoring strategy'],
            difficulty: 9,
            estimatedTime: 30,
            tags: ['leadership', 'strategy'],
            context: '',
          },
          {
            question: 'Mentoring approach for juniors',
            hints: ['Code reviews', 'Pair programming', 'Career growth'],
            difficulty: 8,
            estimatedTime: 25,
            tags: ['leadership', 'mentoring'],
            context: '',
          },
          {
            question: 'Technology evaluation framework',
            hints: ['Criteria', 'Proof of concept', 'Migration plan'],
            difficulty: 9,
            estimatedTime: 30,
            tags: ['architecture', 'decision-making'],
            context: '',
          },
        ],
      },
      behavioral: {
        junior: [
          {
            question: 'Tell me about learning new tech quickly',
            hints: ['Motivation', 'Resources', 'Application'],
            difficulty: 4,
            estimatedTime: 10,
            tags: ['learning', 'adaptability'],
            context: '',
          },
          {
            question: 'How do you handle code review feedback?',
            hints: ['Reception', 'Improvement', 'Communication'],
            difficulty: 4,
            estimatedTime: 10,
            tags: ['feedback', 'growth'],
            context: '',
          },
          {
            question: 'Describe a challenging bug',
            hints: ['Investigation', 'Solution', 'Prevention'],
            difficulty: 5,
            estimatedTime: 15,
            tags: ['problem-solving', 'debugging'],
            context: '',
          },
        ],
        middle: [
          {
            question: 'Difficult technical decision',
            hints: ['Options', 'Analysis', 'Outcome'],
            difficulty: 6,
            estimatedTime: 15,
            tags: ['decision-making', 'technical'],
            context: '',
          },
          {
            question: 'Prioritizing multiple deadlines',
            hints: ['Assessment', 'Communication', 'Execution'],
            difficulty: 6,
            estimatedTime: 15,
            tags: ['time-management', 'organization'],
            context: '',
          },
          {
            question: 'Helping teammate solve problem',
            hints: ['Collaboration', 'Teaching', 'Outcome'],
            difficulty: 5,
            estimatedTime: 15,
            tags: ['teamwork', 'mentoring'],
            context: '',
          },
        ],
        senior: [
          {
            question: 'Leading technical project end-to-end',
            hints: ['Planning', 'Execution', 'Delivery'],
            difficulty: 7,
            estimatedTime: 20,
            tags: ['leadership', 'project-management'],
            context: '',
          },
          {
            question: 'Disagreement with senior engineers',
            hints: ['Discussion', 'Evidence', 'Resolution'],
            difficulty: 7,
            estimatedTime: 20,
            tags: ['conflict-resolution', 'communication'],
            context: '',
          },
          {
            question: 'Technical documentation approach',
            hints: ['Audience', 'Format', 'Maintenance'],
            difficulty: 6,
            estimatedTime: 15,
            tags: ['documentation', 'knowledge-sharing'],
            context: '',
          },
        ],
        lead: [
          {
            question: 'Building high-performing team',
            hints: ['Hiring', 'Culture', 'Development'],
            difficulty: 8,
            estimatedTime: 25,
            tags: ['leadership', 'team-building'],
            context: '',
          },
          {
            question: 'Strategic technical decision',
            hints: ['Vision', 'Analysis', 'Impact'],
            difficulty: 9,
            estimatedTime: 30,
            tags: ['strategy', 'architecture'],
            context: '',
          },
          {
            question: 'Coding vs leadership balance',
            hints: ['Time allocation', 'Delegation', 'Growth'],
            difficulty: 8,
            estimatedTime: 25,
            tags: ['leadership', 'time-management'],
            context: '',
          },
        ],
      },
      system_design: {
        junior: [
          {
            question: 'Design a simple TODO app',
            hints: ['Data model', 'Features', 'Tech stack'],
            difficulty: 4,
            estimatedTime: 15,
            tags: ['design', 'basics'],
            context: '',
          },
          {
            question: 'Structure a basic e-commerce site',
            hints: ['Pages', 'Database', 'Payment'],
            difficulty: 5,
            estimatedTime: 20,
            tags: ['e-commerce', 'web'],
            context: '',
          },
          {
            question: 'Blog platform considerations',
            hints: ['Content', 'Users', 'Performance'],
            difficulty: 4,
            estimatedTime: 15,
            tags: ['cms', 'scalability'],
            context: '',
          },
        ],
        middle: [
          {
            question: 'Design URL shortener like bit.ly',
            hints: ['Hashing', 'Storage', 'Analytics'],
            difficulty: 6,
            estimatedTime: 25,
            tags: ['system-design', 'hashing'],
            context: '',
          },
          {
            question: 'Build real-time chat app',
            hints: ['WebSocket', 'Storage', 'Scaling'],
            difficulty: 7,
            estimatedTime: 30,
            tags: ['real-time', 'messaging'],
            context: '',
          },
          {
            question: 'Design mobile notification system',
            hints: ['Push', 'Queue', 'Delivery'],
            difficulty: 6,
            estimatedTime: 25,
            tags: ['notifications', 'mobile'],
            context: '',
          },
        ],
        senior: [
          {
            question: 'Design distributed caching system',
            hints: ['Cache strategy', 'Invalidation', 'Consistency'],
            difficulty: 8,
            estimatedTime: 35,
            tags: ['caching', 'distributed-systems'],
            context: '',
          },
          {
            question: 'Build video streaming like Netflix',
            hints: ['CDN', 'Encoding', 'DRM'],
            difficulty: 9,
            estimatedTime: 40,
            tags: ['streaming', 'cdn'],
            context: '',
          },
          {
            question: 'Design API rate limiting',
            hints: ['Algorithm', 'Storage', 'Scaling'],
            difficulty: 7,
            estimatedTime: 30,
            tags: ['api', 'rate-limiting'],
            context: '',
          },
        ],
        lead: [
          {
            question: 'Design global social media platform',
            hints: ['Scalability', 'Consistency', 'Regions'],
            difficulty: 10,
            estimatedTime: 45,
            tags: ['global', 'social-media'],
            context: '',
          },
          {
            question: 'Multi-region zero-downtime deployment',
            hints: ['Strategy', 'Data', 'Rollback'],
            difficulty: 9,
            estimatedTime: 40,
            tags: ['deployment', 'global'],
            context: '',
          },
          {
            question: 'Monitoring system for distributed apps',
            hints: ['Metrics', 'Alerting', 'Tracing'],
            difficulty: 8,
            estimatedTime: 35,
            tags: ['monitoring', 'observability'],
            context: '',
          },
        ],
      },
    };

    return fallbacks[type]?.[position] || fallbacks.technical.junior;
  }

  /**
   * Get statistics for monitoring
   */
  async getGenerationStats(): Promise<{
    totalSegments: number;
    activeSegments: number;
    totalGenerations: number;
    totalCost: number;
    avgCacheHitRate: number;
  }> {
    const stats = await this.segmentQuestionModel.aggregate([
      {
        $group: {
          _id: null,
          totalSegments: { $sum: 1 },
          activeSegments: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalGenerations: { $sum: '$timesServed' },
          totalCost: { $sum: '$aiMetadata.cost' },
        },
      },
    ]);

    return {
      totalSegments: stats[0]?.totalSegments || 0,
      activeSegments: stats[0]?.activeSegments || 0,
      totalGenerations: stats[0]?.totalGenerations || 0,
      totalCost: stats[0]?.totalCost || 0,
      avgCacheHitRate: 0, // Would need to track misses separately
    };
  }
}
