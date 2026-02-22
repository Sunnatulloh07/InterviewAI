import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Bot, Context, session, InputFile } from 'grammy';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramVoiceService } from './telegram-voice.service';
import { TelegramLiveService } from './telegram-live.service';
import { TelegramDailyTaskService } from './telegram-daily-task.service';

export interface BotContext extends Context {
  session: {
    userId?: string;
    currentInterview?: string;
    lastCommand?: string;
    language?: string;
    // Interview flow state
    interviewMode?: 'mock' | 'real';
    interviewDomain?: string; // Frontend, Backend, Full Stack, etc.
    interviewTechnology?: string; // React, Node.js, Python, etc.
    interviewPosition?: string; // Junior Developer, Senior Engineer, etc.
    interviewCompany?: string;
    interviewCvId?: string;
    interviewDuration?: 'quick' | 'standard' | 'deep_dive';
    interviewStep?:
      | 'mode'
      | 'duration'
      | 'domain'
      | 'technology'
      | 'technology_custom'
      | 'position'
      | 'company'
      | 'cv'
      | 'ready'
      | 'answering'
      | 'waiting_cv'           // Waiting for user to upload CV (for CV-first interview flow)
      | 'waiting_cv_analysis'  // CV uploaded, waiting for queue processor to finish analysis
      | 'cv_confirmed';        // CV profile shown, user choosing duration
    // CV analysis flow state
    cvUploadStep?: 'waiting' | 'analyzing' | 'complete';
    currentCvId?: string;
    // Interview session state
    currentInterviewSessionId?: string;
    currentQuestionIndex?: number;
    pausedInterviewSessionId?: string; // Session ID when interview is paused
    // Live session metadata
    liveSessionMetadata?: {
      domain?: string; // Frontend, Backend, Full Stack, etc.
      technologies?: string[]; // React, Node.js, Python, etc. (multiple)
      position?: string; // Junior Developer, Senior Engineer, etc.
      company?: string;
      jobRole?: string; // Legacy field
      interviewType?: string; // Legacy field
    };
    // Profile update flow
    profileUpdateStep?: 'waiting_for_description';
    liveSessionStep?:
      | 'domain'
      | 'technologies'
      | 'technologies_custom'
      | 'position'
      | 'company'
      | 'active'
      | 'complete';
  };
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot<BotContext>;
  private readonly botToken: string;
  private readonly webhookUrl?: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TelegramCommandsService))
    private readonly commandsService: TelegramCommandsService,
    private readonly voiceService: TelegramVoiceService,
    private readonly liveService: TelegramLiveService,
    @Inject(forwardRef(() => TelegramDailyTaskService))
    private readonly dailyTaskService: TelegramDailyTaskService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') as string;
    this.webhookUrl = this.configService.get<string>('TELEGRAM_WEBHOOK_URL');
  }

  async onModuleInit() {
    await this.initializeBot();
  }

  private async initializeBot() {
    try {
      this.bot = new Bot<BotContext>(this.botToken);

      // Setup session middleware
      this.bot.use(
        session({
          initial: () => ({
            userId: undefined,
            currentInterview: undefined,
            lastCommand: undefined,
            language: undefined, // ✅ No default language - user must select
            // Interview flow state
            interviewMode: undefined,
            interviewDomain: undefined,
            interviewTechnology: undefined,
            interviewPosition: undefined,
            interviewCompany: undefined,
            interviewCvId: undefined,
            interviewStep: undefined,
            // CV analysis flow state
            cvUploadStep: undefined,
            currentCvId: undefined,
            // Interview session state
            currentInterviewSessionId: undefined,
            currentQuestionIndex: undefined,
            pausedInterviewSessionId: undefined,
            // Live session metadata
            liveSessionMetadata: undefined,
            profileUpdateStep: undefined,
          }),
        }),
      );

      // CRITICAL SECURITY: Rate limiting middleware to prevent abuse
      // Limits: 30 actions per minute per user (commands, voice, text)
      this.bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) {
          // No user ID - likely a channel or group message, skip
          return next();
        }

        const rateLimitKey = `ratelimit:telegram:${userId}`;

        try {
          // Increment counter and get current count
          const count = await this.redis.incr(rateLimitKey);

          // Set expiry on first request (count === 1)
          if (count === 1) {
            await this.redis.expire(rateLimitKey, 60); // 60 second window
          }

          // Check if user exceeded limit
          if (count > 30) {
            // Log potential abuse
            this.logger.warn(`Rate limit exceeded for user ${userId}: ${count} requests in 60s`);

            // Send warning to user
            const lang = ctx.session?.language || 'en';
            const warningText: Record<string, string> = {
              uz: `⚠️ Juda ko'p so'rov. Iltimos, bir daqiqa kuting.`,
              ru: `⚠️ Слишком много запросов. Пожалуйста, подождите минуту.`,
              en: `⚠️ Too many requests. Please wait a minute.`,
            };

            await ctx.reply(warningText[lang] || warningText['en']);
            return; // Don't call next() - block request
          }

          // Rate limit OK, continue processing
          return next();
        } catch (error: any) {
          // Redis error - log but don't block user (fail open)
          this.logger.error(`Rate limit check failed for user ${userId}: ${error.message}`);
          return next(); // Allow request if Redis fails
        }
      });

      // Register command handlers
      this.bot.command('start', (ctx) => this.commandsService.handleStart(ctx));
      this.bot.command('stop', (ctx) => this.commandsService.handleStop(ctx));
      this.bot.command('profile', (ctx) => this.commandsService.handleProfile(ctx));
      this.bot.command('interview', (ctx) => this.commandsService.handleInterview(ctx));
      this.bot.command('start_live', (ctx) => this.liveService.handleStartLive(ctx));
      this.bot.command('end_live', (ctx) => this.liveService.handleEndLive(ctx));
      this.bot.command('analyze_cv', (ctx) => this.commandsService.handleAnalyzeCv(ctx));
      this.bot.command('help', (ctx) => this.commandsService.handleHelp(ctx));
      this.bot.command('stats', (ctx) => this.commandsService.handleStats(ctx));
      this.bot.command('settings', (ctx) => this.commandsService.handleSettings(ctx));
      this.bot.command('upgrade', (ctx) => this.commandsService.handleUpgrade(ctx));
      this.bot.command('set_position', (ctx) => this.commandsService.handleSetPosition(ctx));
      this.bot.command('tasks', (ctx) => this.commandsService.handleTasks(ctx));
      this.bot.command('voice', (ctx) => this.commandsService.handleVoice(ctx));
      this.bot.command('progress', (ctx) => this.commandsService.handleProgress(ctx));

      // Voice message handler - check daily task mode first
      this.bot.on('message:voice', async (ctx) => {
        const isDailyTask = await this.dailyTaskService.isInDailyTaskMode(ctx);
        if (isDailyTask) {
          return this.dailyTaskService.handleVoiceAnswer(ctx, ctx.message.voice);
        }
        return this.voiceService.handleVoiceMessage(ctx);
      });

      // Contact message handler (phone number registration)
      this.bot.on('message:contact', (ctx) => this.commandsService.handleContactMessage(ctx));

      // Document handler (for CV upload in interview flow)
      this.bot.on('message:document', (ctx) => this.commandsService.handleDocumentMessage(ctx));

      // Photo handler - for daily task image answers
      this.bot.on('message:photo', async (ctx) => {
        const isDailyTask = await this.dailyTaskService.isInDailyTaskMode(ctx);
        if (isDailyTask) {
          return this.dailyTaskService.handleImageAnswer(ctx, ctx.message.photo);
        }
        // For non-daily task photos, show error or handle differently
        const lang = ctx.session?.language || 'uz';
        const noPhotoText: Record<string, string> = {
          uz: `📸 Rasm faqat kunlik vazifalar javobida qabul qilinadi.\n\n/tasks buyrug'i bilan vazifalarni ko'ring.`,
          ru: `📸 Изображения принимаются только в ответах на ежедневные задания.\n\nИспользуйте /tasks для просмотра заданий.`,
          en: `📸 Photos are only accepted for daily task answers.\n\nUse /tasks to view your tasks.`,
        };
        await ctx.reply(noPhotoText[lang] || noPhotoText.uz);
      });

      // Text message handler - check daily task mode first
      this.bot.on('message:text', async (ctx) => {
        const isDailyTask = await this.dailyTaskService.isInDailyTaskMode(ctx);
        if (isDailyTask) {
          return this.dailyTaskService.handleTextAnswer(ctx, ctx.message.text);
        }
        return this.handleTextMessage(ctx);
      });

      // Callback query handler (for inline keyboards)
      this.bot.on('callback_query', (ctx) => this.handleCallbackQuery(ctx));

      // Setup global error handler
      this.bot.catch = (err: any) => {
        const ctx = err.ctx as BotContext | undefined;
        const error = err.error as Error;
        this.logger.error(
          `Error in bot middleware: ${error?.message || 'Unknown error'}`,
          error?.stack,
        );

        // Handle specific errors
        if (
          (error as any)?.description?.includes('too old') ||
          (error as any)?.description?.includes('invalid')
        ) {
          // Expired callback query - ignore, already handled
          this.logger.debug('Expired callback query error caught by global handler');
          return;
        }

        // For other errors, try to send a user-friendly message
        if (ctx) {
          const lang = ctx.session?.language || 'en';
          const errorText: Record<string, string> = {
            uz: `❌ Xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
            ru: `❌ Произошла ошибка. Пожалуйста, попробуйте снова.`,
            en: `❌ An error occurred. Please try again.`,
          };
          ctx.reply(errorText[lang] || errorText['en']).catch((replyError) => {
            this.logger.error(`Failed to send error message: ${replyError.message}`);
          });
        }
      };

      // Set global commands - organized by category
      await this.bot.api.setMyCommands([
        // Main Features
        { command: 'start', description: '🏠 Main Menu' },
        { command: 'interview', description: '🎯 Start Interview' },
        { command: 'tasks', description: '📋 Daily Tasks' },
        { command: 'analyze_cv', description: '📄 CV Analysis' },

        // User Info
        { command: 'profile', description: '👤 My Profile' },
        { command: 'stats', description: '📊 My Statistics' },
        { command: 'voice', description: '🎤 Voice Quota' },

        // Settings & Help
        { command: 'upgrade', description: '💳 Plans & Pricing' },
        { command: 'settings', description: '⚙️ Settings' },
        { command: 'help', description: '❓ Help & Commands' },
      ]);

      // Setup Bot Menu Button (appears in bottom left corner of input field)
      await this.setupBotMenuButton();

      // Setup webhook or polling
      if (this.webhookUrl) {
        await this.bot.api.setWebhook(this.webhookUrl);
        this.logger.log(`Telegram bot webhook set to: ${this.webhookUrl}`);
      } else {
        this.bot.start();
        this.logger.log('Telegram bot started in polling mode');
      }
    } catch (error) {
      this.logger.error(`Failed to initialize Telegram bot: ${error.message}`, error.stack);
    }
  }

  /**
   * Setup Bot Menu Button (appears in bottom left corner of input field)
   * This is different from inline keyboard buttons - it's a persistent menu button
   */
  private async setupBotMenuButton() {
    try {
      const webAppUrl = this.configService.get<string>('WEB_APP_URL');
      const isHttps = webAppUrl?.startsWith('https://');
      const isDevelopment = this.configService.get<string>('NODE_ENV') === 'development';
      const enabledInDev = this.configService.get<string>('WEB_APP_ENABLED_IN_DEV') === 'true';

      // Only set menu button if URL is HTTPS or explicitly enabled in development
      if (webAppUrl && (isHttps || (isDevelopment && enabledInDev))) {
        // Set menu button for all users
        await this.bot.api.setChatMenuButton({
          menu_button: {
            type: 'web_app',
            text: '🌐 Web App',
            web_app: {
              url: webAppUrl,
            },
          },
        });
        this.logger.log(`Bot menu button set to: ${webAppUrl}`);
      } else {
        // Remove menu button if URL is not HTTPS
        await this.bot.api.setChatMenuButton({
          menu_button: {
            type: 'commands', // Default commands menu
          },
        });
        this.logger.log('Bot menu button disabled (HTTPS required)');
      }
    } catch (error) {
      this.logger.warn(`Failed to set bot menu button: ${error.message}`);
      // Don't throw - menu button is optional
    }
  }

  /**
   * Handle webhook updates
   */
  async handleUpdate(update: any) {
    try {
      await this.bot.handleUpdate(update);
    } catch (error) {
      this.logger.error(`Error handling update: ${error.message}`, error.stack);
    }
  }

  /**
   * Send OTP via Telegram
   */
  async sendOtp(telegramChatId: number, otpCode: string, phoneNumber: string): Promise<void> {
    try {
      const message = `🔐 <b>Authentication Code</b>\n\nYour verification code is: <code>${otpCode}</code>\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this message.`;

      await this.bot.api.sendMessage(telegramChatId, message, {
        parse_mode: 'HTML',
      });

      this.logger.log(`OTP sent to Telegram chat: ${telegramChatId}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send notification to user
   */
  /**
   * Send a notification message to a user via Telegram.
   * FIX #50: Added optional `options` parameter so callers can pass
   * reply_markup (inline keyboards), parse_mode overrides, etc.
   */
  async sendNotification(
    telegramChatId: number,
    message: string,
    options?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.bot.api.sendMessage(telegramChatId, message, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle text messages
   */
  private async handleTextMessage(ctx: BotContext) {
    // Check for Menu Buttons Logic (Reply Keyboard)
    // Priority: Top level check to allow navigation away from flows
    if (await this.commandsService.handleMenuText(ctx)) {
      return;
    }

    // Check if user is collecting live session metadata (PRIORITY: check this first)
    // This handles text input during metadata collection (e.g., company name)
    // Note: 'active' means session is running, not collecting metadata
    const liveStep = ctx.session.liveSessionStep;
    if (liveStep && liveStep !== 'complete' && liveStep !== 'active') {
      await this.liveService.handleLiveMessage(ctx);
      return;
    }

    // Check if user is in live session
    const liveSession = await this.liveService.isInLiveSession(ctx.from?.id as number);
    if (liveSession) {
      await this.liveService.handleLiveMessage(ctx);
      return;
    }

    // Check if user is answering interview questions
    // This handles answers during active interview sessions
    if (ctx.session.currentInterviewSessionId && ctx.session.currentQuestionIndex !== undefined) {
      await this.commandsService.handleInterviewText(ctx);
      return;
    }

    // Check if user is updating profile (AI Normalization)
    if (ctx.session.profileUpdateStep === 'waiting_for_description') {
      await this.commandsService.handleProfileDescription(ctx, ctx.message?.text || '');
      return;
    }

    // Check if user is in interview flow (position, company, etc.)
    if (ctx.session.interviewStep) {
      await this.commandsService.handleInterviewText(ctx);
      return;
    }

    // Check if user has selected language
    const lang = ctx.session?.language || 'en';
    const defaultMessages: Record<string, string> = {
      uz: `Men bu xabarni tushunmadim. Mavjud buyruqlarni ko'rish uchun /help dan foydalaning.`,
      ru: `Я не понял это сообщение. Используйте /help, чтобы увидеть доступные команды.`,
      en: `I didn't understand that. Use /help to see available commands.`,
    };

    await ctx.reply(defaultMessages[lang] || defaultMessages['en']);
  }

  /**
   * Handle callback queries (inline keyboard buttons)
   */
  private async handleCallbackQuery(ctx: BotContext) {
    const data = ctx.callbackQuery?.data as string;

    if (!data) {
      this.logger.warn('Callback query received without data');
      try {
        await ctx.answerCallbackQuery();
      } catch (error: any) {
        // Ignore expired callback query errors
        if (!error.description?.includes('too old') && !error.description?.includes('invalid')) {
          this.logger.warn(`Failed to answer callback query: ${error.message}`);
        }
      }
      return;
    }

    // CRITICAL: Answer callback query IMMEDIATELY to prevent timeout
    // Telegram callback queries expire after a few seconds, so we must answer before processing
    try {
      await ctx.answerCallbackQuery();
    } catch (error: any) {
      // If callback query is already expired, log and continue (don't fail the handler)
      if (error.description?.includes('too old') || error.description?.includes('invalid')) {
        this.logger.warn(
          `Callback query expired (ID: ${ctx.callbackQuery?.id}), but continuing processing: ${data}`,
        );
      } else {
        this.logger.warn(`Failed to answer callback query: ${error.message}`);
        // Still try to process, but don't fail if answerCallbackQuery fails
      }
    }

    try {
      this.logger.debug(`Handling callback query: ${data}`);
      // Process callback (this may take time, e.g., CV analysis)
      await this.commandsService.handleCallback(ctx, data);
    } catch (error: any) {
      this.logger.error(`Error handling callback: ${error.message}`, error.stack);
      // Don't try to answer callback query again - it's already answered or expired
      // Instead, send an error message to the user
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: `❌ Xatolik yuz berdi: ${error.message || "Noma'lum xatolik"}`,
        ru: `❌ Произошла ошибка: ${error.message || 'Неизвестная ошибка'}`,
        en: `❌ An error occurred: ${error.message || 'Unknown error'}`,
      };
      try {
        await ctx.reply(errorText[lang] || errorText['en'], { parse_mode: 'HTML' });
      } catch (replyError) {
        this.logger.error(`Failed to send error message: ${replyError.message}`);
      }
    }
  }

  /**
   * Get bot instance (for testing)
   */
  getBot(): Bot<BotContext> {
    return this.bot;
  }
}
