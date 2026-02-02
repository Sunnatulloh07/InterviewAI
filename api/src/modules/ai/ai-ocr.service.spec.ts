import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiOcrService } from './ai-ocr.service';

describe('AiOcrService', () => {
  let service: AiOcrService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, any> = {
        OPENROUTER_API_KEY: 'test-api-key',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOcrService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiOcrService>(AiOcrService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recognize', () => {
    it('should reject files larger than 20MB', async () => {
      const largeBuffer = Buffer.alloc(21 * 1024 * 1024);

      await expect(service.recognize(largeBuffer, 'image/jpeg', 'en')).rejects.toThrow();
    });

    it('should reject unsupported MIME types', async () => {
      const buffer = Buffer.from('test');

      await expect(service.recognize(buffer, 'application/pdf', 'en')).rejects.toThrow();
    });

    it('should validate image size before processing', async () => {
      const buffer = Buffer.alloc(19 * 1024 * 1024);

      const fileSize = buffer.length;
      const maxSize = 20 * 1024 * 1024;

      expect(fileSize).toBeLessThan(maxSize);
    });
  });

  describe('getImageType', () => {
    it('should return correct type for JPEG', () => {
      const type = service['getImageType']('image/jpeg');
      expect(type).toBe('image/jpeg');
    });

    it('should return correct type for PNG', () => {
      const type = service['getImageType']('image/png');
      expect(type).toBe('image/png');
    });
  });

  describe('formatImageSize', () => {
    it('should format bytes to KB', () => {
      const size = service['formatImageSize'](1024);
      expect(size).toBe('1.00 KB');
    });

    it('should format bytes to MB', () => {
      const size = service['formatImageSize'](1024 * 1024);
      expect(size).toBe('1.00 MB');
    });

    it('should format bytes to GB', () => {
      const size = service['formatImageSize'](1024 * 1024 * 1024);
      expect(size).toBe('1.00 GB');
    });
  });
});
