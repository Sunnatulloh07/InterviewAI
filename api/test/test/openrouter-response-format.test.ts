import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAnswerService } from './ai/ai-answer.service';

/**
 * Test OpenRouter Vision API response handling
 */
describe('OpenRouterResponseFormat', () => {
  let service: AiAnswerService;
  let config: ConfigService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AiAnswerService,
      ],
    }).compile();

    service = moduleRef.get<AiAnswerService>(AiAnswerService);
    config = moduleRef.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('JSON response parsing', () => {
    it('should parse OpenRouter JSON response with keyPoints', () => {
      // Simulate typical OpenRouter Vision response with keyPoints
      const mockResponse = {
        choices: [
          {
            message: {
              role: 'user',
              content: '1. This is keyPoints.',
            },
          },
          {
            message: {
              role: 'system',
              content: '2. This is also keyPoints.',
            },
          },
          {
            message: {
              role: 'assistant',
              content: '3. This is keyPoints too.',
            },
          },
        ],
      };

      const jsonText = JSON.stringify(mockResponse);

      // This simulates what `ai-answer.service.ts` does
      const matches = jsonText.match(/\["'\]+"\['\\['+\["']+"\["]/gi;

      expect(matches?.[1]).toBeDefined();
      expect(matches?.[3]).toBeDefined();
      expect(matches?.[5]).toBeDefined();

      expect(matches?.[6]).toBeDefined();
    });
  });
});
