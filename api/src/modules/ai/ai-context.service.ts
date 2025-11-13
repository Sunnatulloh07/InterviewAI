import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AiRepository } from './ai.repository';
import { AiSessionDocument } from './schemas/ai-session.schema';

@Injectable()
export class AiContextService {
  private readonly logger = new Logger(AiContextService.name);
  private readonly maxMessages = 10; // Keep last 10 messages

  constructor(private readonly aiRepository: AiRepository) {}

  /**
   * Create new AI session
   */
  async createSession(
    userId: string,
    sessionType: string,
    interviewId?: string,
  ): Promise<AiSessionDocument> {
    try {
      const session = await this.aiRepository.create({
        userId: userId as any,
        sessionType,
        interviewId,
        messages: [],
        topics: [],
        mentionedExperiences: [],
        skills: [],
        context: {},
        tokensUsed: 0,
        lastUpdated: new Date(),
      });

      this.logger.log(`AI session created: ${session.id} for user ${userId}`);
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create AI session for user ${userId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to create AI session. Please try again.');
    }
  }

  /**
   * Get session context
   */
  async getContext(sessionId: string): Promise<any> {
    try {
      const session = await this.aiRepository.findById(sessionId);

      if (!session) {
        throw new NotFoundException('Session not found');
      }

      return {
        sessionId: session.id,
        messages: session.messages.slice(-this.maxMessages), // Last N messages
        topics: session.topics,
        mentionedExperiences: session.mentionedExperiences,
        skills: session.skills,
        context: session.context,
        lastUpdated: session.lastUpdated,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to get context for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to retrieve session context. Please try again.');
    }
  }

  /**
   * Update context
   */
  async updateContext(sessionId: string, context: Record<string, any>): Promise<void> {
    try {
      const session = await this.aiRepository.findById(sessionId);

      if (!session) {
        throw new NotFoundException('Session not found');
      }

      const updatedContext = {
        ...session.context,
        ...context,
      };

      await this.aiRepository.updateContext(sessionId, updatedContext);
      this.logger.log(`Context updated for session ${sessionId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to update context for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to update context. Please try again.');
    }
  }

  /**
   * Add message to session
   */
  async addMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant';
      content: string;
      type: 'question' | 'answer';
      timestamp: Date;
      topics?: string[];
    },
  ): Promise<void> {
    try {
      const session = await this.aiRepository.findById(sessionId);

      if (!session) {
        throw new NotFoundException('Session not found');
      }

      // Add message
      await this.aiRepository.addMessage(sessionId, message);

      // Extract and update topics/skills if present
      if (message.topics && message.topics.length > 0) {
        const updatedTopics = [...new Set([...session.topics, ...message.topics])];
        await this.aiRepository.update(sessionId, { topics: updatedTopics });
      }

      // Auto-detect topics from content
      const detectedTopics = this.extractTopics(message.content);
      if (detectedTopics.length > 0) {
        const updatedTopics = [...new Set([...session.topics, ...detectedTopics])];
        await this.aiRepository.update(sessionId, { topics: updatedTopics });
      }

      this.logger.debug(`Message added to session ${sessionId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to add message to session ${sessionId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to add message. Please try again.');
    }
  }

  /**
   * Detect if message is follow-up
   */
  async detectFollowUp(sessionId: string, question: string): Promise<boolean> {
    try {
      const session = await this.aiRepository.findById(sessionId);

      if (!session || session.messages.length === 0) {
        return false;
      }

      // Check for follow-up indicators
      const followUpKeywords = [
        'also',
        'additionally',
        'furthermore',
        'what about',
        'how about',
        'can you elaborate',
        'tell me more',
        'explain',
        'clarify',
      ];

      const lowerQuestion = question.toLowerCase();
      const hasFollowUpKeyword = followUpKeywords.some((keyword) =>
        lowerQuestion.includes(keyword),
      );

      if (hasFollowUpKeyword) {
        return true;
      }

      // Check if question references previous topics
      const lastMessage = session.messages[session.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        const previousContent = lastMessage.content.toLowerCase();
        const sharedWords = this.findSharedWords(previousContent, lowerQuestion);
        return sharedWords >= 2; // At least 2 shared significant words
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Failed to detect follow-up for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      return false; // Graceful degradation - assume not a follow-up
    }
  }

  /**
   * Get session by user and type
   */
  async getOrCreateSession(
    userId: string,
    sessionType: string,
    interviewId?: string,
  ): Promise<AiSessionDocument> {
    try {
      let session = await this.aiRepository.findBySessionType(userId, sessionType);

      if (!session) {
        session = await this.createSession(userId, sessionType, interviewId);
      }

      return session;
    } catch (error) {
      this.logger.error(
        `Failed to get or create session for user ${userId}, type ${sessionType}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException('Failed to get or create session. Please try again.');
    }
  }

  /**
   * Archive session
   */
  async archiveSession(sessionId: string): Promise<void> {
    try {
      await this.aiRepository.archive(sessionId);
      this.logger.log(`Session archived: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to archive session ${sessionId}: ${error.message}`, error.stack);
      // Don't throw - archiving is not critical
    }
  }

  /**
   * Increment tokens used
   */
  async incrementTokens(sessionId: string, tokens: number): Promise<void> {
    try {
      await this.aiRepository.incrementTokens(sessionId, tokens);
    } catch (error) {
      this.logger.error(
        `Failed to increment tokens for session ${sessionId}: ${error.message}`,
        error.stack,
      );
      // Don't throw - token tracking is not critical
    }
  }

  /**
   * Extract topics from text
   */
  private extractTopics(text: string): string[] {
    // Simple topic extraction using keywords
    // In production, use more sophisticated NLP
    const topicKeywords = [
      'javascript',
      'typescript',
      'react',
      'node',
      'python',
      'java',
      'leadership',
      'teamwork',
      'communication',
      'problem solving',
      'architecture',
      'database',
      'api',
      'testing',
      'agile',
      'scrum',
    ];

    const lowerText = text.toLowerCase();
    return topicKeywords.filter((keyword) => lowerText.includes(keyword));
  }

  /**
   * Find shared words between two texts
   */
  private findSharedWords(text1: string, text2: string): number {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'is',
      'are',
      'was',
      'were',
      'in',
      'on',
      'at',
      'to',
      'for',
    ]);

    const words1 = text1
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .map((w) => w.toLowerCase());

    const words2 = text2
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .map((w) => w.toLowerCase());

    const set1 = new Set(words1);
    return words2.filter((w) => set1.has(w)).length;
  }
}
