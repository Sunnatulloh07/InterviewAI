import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Bot, Context, session } from 'grammy';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramVoiceService } from './telegram-voice.service';
import { TelegramLiveService } from './telegram-live.service';

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
    interviewStep?: 'mode' | 'domain' | 'technology' | 'position' | 'company' | 'cv' | 'ready';
    // CV analysis flow state
    cvUploadStep?: 'waiting' | 'analyzing' | 'complete';
    currentCvId?: string;
    // Interview session state
    currentInterviewSessionId?: string;
    currentQuestionIndex?: number;
    // Live session metadata
    liveSessionMetadata?: {
      jobRole?: string;
      company?: string;
      interviewType?: string;
    };
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
    private readonly commandsService: TelegramCommandsService,
    private readonly voiceService: TelegramVoiceService,
    private readonly liveService: TelegramLiveService,
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
            // Live session metadata
            liveSessionMetadata: undefined,
          }),
        }),
      );

      // Register command handlers
      this.bot.command('start', (ctx) => this.commandsService.handleStart(ctx));
      this.bot.command('profile', (ctx) => this.commandsService.handleProfile(ctx));
      this.bot.command('interview', (ctx) => this.commandsService.handleInterview(ctx));
      this.bot.command('start_live', (ctx) => this.liveService.handleStartLive(ctx));
      this.bot.command('end_live', (ctx) => this.liveService.handleEndLive(ctx));
      this.bot.command('analyze_cv', (ctx) => this.commandsService.handleAnalyzeCv(ctx));
      this.bot.command('help', (ctx) => this.commandsService.handleHelp(ctx));
      this.bot.command('stats', (ctx) => this.commandsService.handleStats(ctx));
      this.bot.command('settings', (ctx) => this.commandsService.handleSettings(ctx));

      // Voice message handler
      this.bot.on('message:voice', (ctx) => this.voiceService.handleVoiceMessage(ctx));

      // Contact message handler (phone number registration)
      this.bot.on('message:contact', (ctx) => this.commandsService.handleContactMessage(ctx));

      // Document handler (for CV upload in interview flow)
      this.bot.on('message:document', (ctx) => this.commandsService.handleDocumentMessage(ctx));

      // Text message handler
      this.bot.on('message:text', (ctx) => this.handleTextMessage(ctx));

      // Callback query handler (for inline keyboards)
      this.bot.on('callback_query', (ctx) => this.handleCallbackQuery(ctx));

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
      const message = `🔐 *Authentication Code*\n\nYour verification code is: \`${otpCode}\`\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this message.`;

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
  async sendNotification(telegramChatId: number, message: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(telegramChatId, message, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle text messages
   */
  private async handleTextMessage(ctx: BotContext) {
    // Check if user is in live session
    const liveSession = await this.liveService.isInLiveSession(ctx.from?.id as number);
    if (liveSession) {
      await this.liveService.handleLiveMessage(ctx);
      return;
    }

    // Check if user is in interview flow
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
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      this.logger.debug(`Handling callback query: ${data}`);
      await this.commandsService.handleCallback(ctx, data);
      await ctx.answerCallbackQuery();
    } catch (error) {
      this.logger.error(`Error handling callback: ${error.message}`, error.stack);
      const errorMessage = error.message || 'An error occurred';
      await ctx.answerCallbackQuery(errorMessage.substring(0, 200)); // Telegram limit
    }
  }

  /**
   * Get bot instance (for testing)
   */
  getBot(): Bot<BotContext> {
    return this.bot;
  }
}
