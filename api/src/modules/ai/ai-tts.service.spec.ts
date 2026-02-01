import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AiTtsService } from './ai-tts.service';

describe('AiTtsService', () => {
  let service: AiTtsService;
  let cacheManager: Cache;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        OPENAI_API_KEY: 'test-api-key',
      };
      return config[key];
    }),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTtsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AiTtsService>(AiTtsService);
    cacheManager = module.get<Cache>(CACHE_MANAGER);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('synthesize', () => {
    it('should check cache first', async () => {
      const mockCachedBuffer = Buffer.from('cached-audio');
      (cacheManager.get as jest.Mock).mockResolvedValue(mockCachedBuffer);

      const result = await service.synthesize('Hello world', { language: 'en' });

      expect(cacheManager.get).toHaveBeenCalled();
      expect(result.audioBuffer).toEqual(mockCachedBuffer);
    });

    it('should skip cache when not found', async () => {
      (cacheManager.get as jest.Mock).mockResolvedValue(null);

      const result = await service.synthesize('Hello world', { language: 'en' });

      expect(cacheManager.get).toHaveBeenCalled();
    });
  });

  describe('isEnabled', () => {
    it('should return true when OPENAI_API_KEY is configured', async () => {
      const enabled = await service.isEnabled();
      expect(enabled).toBe(true);
    });
  });

  describe('voice mapping', () => {
    it('should map voice for English', () => {
      const voice = service['mapVoiceForLanguage']('alloy', 'en');
      expect(voice).toBe('alloy');
    });

    it('should use default voice for unknown', () => {
      const voice = service['mapVoiceForLanguage']('unknown', 'en');
      expect(voice).toBe('alloy');
    });
  });

  describe('hashText', () => {
    it('should generate consistent hash for same text', () => {
      const hash1 = service['hashText']('test text');
      const hash2 = service['hashText']('test text');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different text', () => {
      const hash1 = service['hashText']('test text 1');
      const hash2 = service['hashText']('test text 2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
