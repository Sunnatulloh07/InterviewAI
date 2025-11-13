import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

/**
 * OpenRouter Model Mapping
 * Maps internal model names to OpenRouter model identifiers
 */
export const OPENROUTER_MODELS = {
  // OpenAI Models
  'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
  'gpt-4-turbo-preview': 'openai/gpt-4-turbo-preview',
  'gpt-4': 'openai/gpt-4',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  // Note: GPT-5 doesn't exist yet. Use GPT-4o or GPT-4-turbo for production
  'gpt-5-nano': 'openai/gpt-4o-mini', // Fallback to GPT-4o-mini (fastest, cheapest)

  // Anthropic Claude Models
  'claude-3-sonnet': 'anthropic/claude-3-sonnet',
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-sonnet-3': 'anthropic/claude-3.5-sonnet', // Alias for Claude 3.5 Sonnet

  // Other models
  'llama-3-70b': 'meta-llama/llama-3-70b-instruct',
  'llama-3-8b': 'meta-llama/llama-3-8b-instruct',
} as const;

/**
 * Create OpenAI client with support for both OpenAI and OpenRouter
 * Auto-detects OpenRouter if API key starts with 'sk-or-v1-'
 *
 * IMPORTANT: OpenRouter uses a SINGLE API key for ALL models
 * You don't need separate keys for different models (Sonnet-3, GPT-4, etc.)
 * Just change the model name in the request
 */
export function createOpenAIClient(configService: ConfigService): OpenAI | null {
  const apiKey = configService.get<string>('OPENAI_API_KEY');
  const organization = configService.get<string>('OPENAI_ORGANIZATION');

  // Check if API key is valid
  if (!apiKey || !apiKey.trim() || apiKey.includes('your-') || apiKey.includes('sk-***')) {
    return null;
  }

  const trimmedKey = apiKey.trim();

  // Auto-detect OpenRouter: API keys starting with 'sk-or-v1-' are OpenRouter keys
  const isOpenRouterKey = trimmedKey.startsWith('sk-or-v1-');
  const useOpenRouter =
    isOpenRouterKey || configService.get<string>('OPENROUTER_ENABLED') === 'true';

  const config: {
    apiKey: string;
    organization?: string;
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
  } = {
    apiKey: trimmedKey,
  };

  if (useOpenRouter) {
    // OpenRouter configuration
    const openRouterBaseUrl =
      configService.get<string>('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    const openRouterHttpReferer = configService.get<string>('OPENROUTER_HTTP_REFERER');
    const openRouterXTitle = configService.get<string>('OPENROUTER_X_TITLE');

    config.baseURL = openRouterBaseUrl;

    const extraHeaders: Record<string, string> = {};
    if (openRouterHttpReferer) {
      extraHeaders['HTTP-Referer'] = openRouterHttpReferer;
    }
    if (openRouterXTitle) {
      extraHeaders['X-Title'] = openRouterXTitle;
    }
    if (Object.keys(extraHeaders).length > 0) {
      config.defaultHeaders = extraHeaders;
    }
  } else {
    // Standard OpenAI configuration
    // Organization header is OPTIONAL - only needed if you have multiple organizations
    if (
      organization &&
      organization.trim() &&
      !organization.includes('your-') &&
      !organization.includes('org-***') &&
      organization.trim().startsWith('org-') &&
      organization.trim().length > 4
    ) {
      config.organization = organization.trim();
    }
  }

  return new OpenAI(config);
}

/**
 * Get model name based on OpenRouter or OpenAI
 * Maps internal model names to OpenRouter model identifiers if using OpenRouter
 *
 * PRODUCTION NOTES:
 * - OpenRouter uses ONE API key for ALL models (Sonnet-3, GPT-4, etc.)
 * - Just change the model name in the request - no separate keys needed
 * - GPT-5 doesn't exist - using GPT-4o-mini as fallback for 'gpt-5-nano'
 * - Claude Sonnet 3 = 'anthropic/claude-3.5-sonnet' in OpenRouter
 */
export function getModelName(
  configService: ConfigService,
  defaultModel: string,
  openRouterModel?: string,
): string {
  const apiKey = configService.get<string>('OPENAI_API_KEY');
  const isOpenRouterKey = apiKey?.startsWith('sk-or-v1-') || false;
  const useOpenRouter =
    isOpenRouterKey || configService.get<string>('OPENROUTER_ENABLED') === 'true';

  if (useOpenRouter) {
    // Get model from config or use provided default
    const configuredModel = configService.get<string>('OPENROUTER_MODEL');
    const modelToUse = configuredModel || openRouterModel || 'openai/gpt-4o-mini';

    // Map internal model names to OpenRouter model identifiers
    // If model is already in OpenRouter format (contains '/'), use as-is
    if (modelToUse.includes('/')) {
      return modelToUse;
    }

    // Otherwise, try to map from internal model name
    const mappedModel = OPENROUTER_MODELS[modelToUse as keyof typeof OPENROUTER_MODELS];
    if (mappedModel) {
      return mappedModel;
    }

    // If no mapping found, assume it's already in OpenRouter format or return as-is
    return modelToUse;
  }

  return defaultModel;
}

/**
 * Get model name for plan-based selection with OpenRouter support
 * Maps plan-based models to appropriate OpenRouter models
 */
export function getModelForPlan(
  configService: ConfigService,
  plan: string,
  freeModel: string = 'gpt-3.5-turbo',
  premiumModel: string = 'gpt-4-turbo-preview',
): string {
  const isPremium = plan === 'elite' || plan === 'pro' || plan === 'enterprise';
  const defaultModel = isPremium ? premiumModel : freeModel;
  return getModelName(configService, defaultModel);
}
