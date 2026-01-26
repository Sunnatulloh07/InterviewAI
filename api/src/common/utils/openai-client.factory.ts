import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

/**
 * OpenRouter Model Mapping
 * Maps internal model names to OpenRouter model identifiers
 * 
 * @see https://openrouter.ai/docs#models
 * 
 * Categories:
 * - OpenAI: GPT series models
 * - Anthropic: Claude series models
 * - Google: Gemini series models (supports multimodal)
 * - Meta: LLaMA series models
 */
export const OPENROUTER_MODELS = {
  // ═══════════════════════════════════════════════════════════════════
  // OpenAI Models
  // ═══════════════════════════════════════════════════════════════════
  'gpt-3.5-turbo': 'openai/gpt-3.5-turbo',
  'gpt-4-turbo-preview': 'openai/gpt-4-turbo-preview',
  'gpt-4': 'openai/gpt-4',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  // Note: GPT-5 doesn't exist yet. Use GPT-4o or GPT-4-turbo for production
  'gpt-5-nano': 'openai/gpt-4o-mini', // Fallback to GPT-4o-mini (fastest, cheapest)

  // ═══════════════════════════════════════════════════════════════════
  // Anthropic Claude Models
  // ═══════════════════════════════════════════════════════════════════
  'claude-3-sonnet': 'anthropic/claude-3-sonnet',
  'claude-3-opus': 'anthropic/claude-3-opus',
  'claude-3-haiku': 'anthropic/claude-3-haiku',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  'claude-sonnet-3': 'anthropic/claude-3.5-sonnet', // Alias for Claude 3.5 Sonnet

  // ═══════════════════════════════════════════════════════════════════
  // Google Gemini Models (Multimodal - supports audio/image/video)
  // Use for Live Interview audio processing
  // ═══════════════════════════════════════════════════════════════════
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-preview-05-20', // Fast, cheap, multimodal
  'gemini-2.5-flash': 'google/gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro': 'google/gemini-2.5-pro-preview-05-06',         // Higher quality
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',               // Stable version
  'gemini-pro': 'google/gemini-pro',                                // Legacy fallback

  // ═══════════════════════════════════════════════════════════════════
  // Meta LLaMA Models
  // ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// Gemini Audio Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default Gemini model for audio processing
 * Can be overridden via GEMINI_AUDIO_MODEL env variable
 */
export const DEFAULT_GEMINI_AUDIO_MODEL = 'google/gemini-2.5-flash-preview-05-20';

/**
 * Supported audio formats for Gemini multimodal
 * @see https://cloud.google.com/vertex-ai/docs/generative-ai/multimodal/audio-understanding
 */
export const GEMINI_SUPPORTED_AUDIO_FORMATS = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a', // iOS voice messages
  'audio/aac',
] as const;

/**
 * Type for supported audio formats
 */
export type GeminiAudioFormat = (typeof GEMINI_SUPPORTED_AUDIO_FORMATS)[number];

/**
 * Check if Gemini audio processing is enabled
 * Controlled via GEMINI_AUDIO_ENABLED env variable
 * 
 * @param configService - NestJS ConfigService instance
 * @returns true if GEMINI_AUDIO_ENABLED=true in environment
 */
export function isGeminiAudioEnabled(configService: ConfigService): boolean {
  const enabled = configService.get<string>('GEMINI_AUDIO_ENABLED');
  return enabled === 'true';
}

/**
 * Validate if a mime type is supported by Gemini audio processing
 * 
 * @param mimeType - Audio MIME type to validate
 * @returns true if the format is supported
 */
export function isValidGeminiAudioFormat(mimeType: string): mimeType is GeminiAudioFormat {
  return GEMINI_SUPPORTED_AUDIO_FORMATS.includes(mimeType as GeminiAudioFormat);
}

/**
 * Get configured Gemini audio model
 * Falls back to DEFAULT_GEMINI_AUDIO_MODEL if not configured
 * 
 * @param configService - NestJS ConfigService instance
 * @returns OpenRouter-formatted model name
 * 
 * @example
 * // .env: GEMINI_AUDIO_MODEL=google/gemini-2.5-pro-preview-05-06
 * getGeminiAudioModel(configService) // Returns 'google/gemini-2.5-pro-preview-05-06'
 * 
 * @example
 * // .env: GEMINI_AUDIO_MODEL=gemini-2.5-pro
 * getGeminiAudioModel(configService) // Returns 'google/gemini-2.5-pro-preview-05-06' (mapped)
 */
export function getGeminiAudioModel(configService: ConfigService): string {
  const configuredModel = configService.get<string>('GEMINI_AUDIO_MODEL');
  
  if (configuredModel) {
    // If model contains '/', assume it's already in OpenRouter format
    if (configuredModel.includes('/')) {
      return configuredModel;
    }
    
    // Try to map from internal model name
    const mappedModel = OPENROUTER_MODELS[configuredModel as keyof typeof OPENROUTER_MODELS];
    if (mappedModel) {
      return mappedModel;
    }
    
    // Unknown model - return as-is (might be a new model not in our mapping)
    return configuredModel;
  }
  
  return DEFAULT_GEMINI_AUDIO_MODEL;
}

/**
 * Audio format mapping from MIME types to Gemini format identifiers
 * Used when sending audio to Gemini multimodal API
 */
const AUDIO_FORMAT_MAP: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
} as const;

/**
 * Convert MIME type to Gemini-compatible format string
 * 
 * @param mimeType - Audio MIME type (e.g., 'audio/ogg')
 * @returns Format string for Gemini API, or null if unsupported
 * 
 * @example
 * getGeminiAudioFormat('audio/ogg') // Returns 'ogg'
 * getGeminiAudioFormat('audio/unknown') // Returns null
 */
export function getGeminiAudioFormat(mimeType: string): string | null {
  return AUDIO_FORMAT_MAP[mimeType] ?? null;
}

/**
 * Get Gemini audio format with fallback for unknown types
 * Useful when you want to attempt processing even with unknown formats
 * 
 * @param mimeType - Audio MIME type
 * @param fallback - Fallback format (default: 'ogg')
 * @returns Format string for Gemini API
 */
export function getGeminiAudioFormatSafe(mimeType: string, fallback: string = 'ogg'): string {
  return AUDIO_FORMAT_MAP[mimeType] ?? fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Exports
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Type for OpenRouter model keys (internal names)
 */
export type OpenRouterModelKey = keyof typeof OPENROUTER_MODELS;

/**
 * Type for OpenRouter model values (full model identifiers)
 */
export type OpenRouterModelValue = (typeof OPENROUTER_MODELS)[OpenRouterModelKey];
