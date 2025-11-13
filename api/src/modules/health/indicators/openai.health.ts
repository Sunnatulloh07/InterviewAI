import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * OpenAI Health Indicator
 * Checks OpenAI API availability and authentication
 */
@Injectable()
export class OpenAIHealthIndicator extends HealthIndicator {
  private readonly apiKey: string;
  private readonly isOpenRouter: boolean;
  private readonly baseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    super();
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.isOpenRouter = this.apiKey?.startsWith('sk-or-v1-');
    this.baseUrl = this.isOpenRouter
      ? this.configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1';
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.apiKey) {
      throw new HealthCheckError(
        'OpenAI check failed',
        this.getStatus(key, false, {
          state: 'not_configured',
          message: 'OpenAI API key not configured',
        }),
      );
    }

    try {
      const startTime = Date.now();

      // Try to fetch models endpoint to verify API key
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...(this.isOpenRouter && {
              'HTTP-Referer': this.configService.get<string>('OPENROUTER_HTTP_REFERER') || '',
              'X-Title': this.configService.get<string>('OPENROUTER_X_TITLE') || '',
            }),
          },
          timeout: 5000,
        }),
      );

      const latency = Date.now() - startTime;

      if (response.status === 200) {
        return this.getStatus(key, true, {
          state: 'connected',
          provider: this.isOpenRouter ? 'OpenRouter' : 'OpenAI',
          latency: `${latency}ms`,
          modelsAvailable: response.data?.data?.length || 0,
        });
      }

      throw new Error(`Unexpected status code: ${response.status}`);
    } catch (error) {
      // Don't expose API key in error messages
      const safeError = error.response?.data?.error?.message || error.message || 'Unknown error';

      throw new HealthCheckError(
        'OpenAI check failed',
        this.getStatus(key, false, {
          state: 'error',
          provider: this.isOpenRouter ? 'OpenRouter' : 'OpenAI',
          message: safeError,
        }),
      );
    }
  }
}
