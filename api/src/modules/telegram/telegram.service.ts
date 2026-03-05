import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Bot, Context, session, InputFile, SessionFlavor } from 'grammy';
import { RedisAdapter } from '@grammyjs/storage-redis';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramVoiceService } from './telegram-voice.service';
import { TelegramLiveService } from './telegram-live.service';
import { TelegramDailyTaskService } from './telegram-daily-task.service';
import { TelegramReadinessService } from '../readiness-test/telegram-readiness.service';
import { StreakService } from '../streak/streak.service';
import { TelegramLeaderboardService } from '../leaderboard/telegram-leaderboard.service';
import { BadgeService } from '../gamification/badge.service';

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
      | 'answering_followup'   // Answering a follow-up question (Phase 3)
      | 'mock_type'            // Selecting mock interview type (Phase 3)
      | 'mock_company'         // Selecting company template (Phase 3, Elite)
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
    // Phase 3: Enhanced mock interview state
    interviewMockType?: string;        // Selected mock interview type (quick_technical, behavioral, etc.)
    interviewCompanyTemplate?: string;  // Selected company template ID (google, amazon, etc.)
    pendingFollowUpQuestion?: string;   // Current follow-up question text awaiting answer
    followUpQuestionStartedAt?: number; // Timestamp when follow-up was shown (for duration calc)
    questionStartedAt?: number;         // FIX P3-M8: Timestamp when main question was shown (for actual duration calc)
    // Live session metadata
    liveSessionMetadata?: {
      domain?: string; // Frontend, Backend, Full Stack, etc.
      technologies?: string[]; // React, Node.js, Python, etc. (multiple)
      position?: string; // Junior Developer, Senior Engineer, etc.
      company?: string;
      jobRole?: string; // Legacy field
      interviewType?: string; // Legacy field
    };
    // IRS (Interview Readiness Score) flow
    irsTestId?: string;
    irsStep?: 'awaiting_techstack' | 'answering_irs';
    irsPosition?: string;
    irsQuestionStartedAt?: number;
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
    @Inject(forwardRef(() => TelegramReadinessService))
    private readonly readinessService: TelegramReadinessService,
    private readonly streakService: StreakService,
    private readonly leaderboardUIService: TelegramLeaderboardService,
    private readonly badgeService: BadgeService,
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

      // Setup session middleware with Redis persistence
      // Sessions survive server restarts/deploys — users won't lose interview state
      const redisStorage = new RedisAdapter({ instance: this.redis });

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
            // IRS flow state
            irsTestId: undefined,
            irsStep: undefined,
            irsPosition: undefined,
            irsQuestionStartedAt: undefined,
            // CV analysis flow state
            cvUploadStep: undefined,
            currentCvId: undefined,
            // Interview session state
            currentInterviewSessionId: undefined,
            currentQuestionIndex: undefined,
            pausedInterviewSessionId: undefined,
            // Phase 3: Enhanced mock interview state
            interviewMockType: undefined,
            interviewCompanyTemplate: undefined,
            pendingFollowUpQuestion: undefined,
            followUpQuestionStartedAt: undefined,
            // Live session metadata
            liveSessionMetadata: undefined,
            profileUpdateStep: undefined,
          }),
          storage: redisStorage,
        }),
      );

      this.logger.log('Grammy session storage: Redis (persistent)');

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
      this.bot.command('irs', (ctx) => this.readinessService.handleIRSStart(ctx));
      this.bot.command('streak', (ctx) => this.handleStreakCommand(ctx));
      this.bot.command('leaderboard', (ctx) => this.leaderboardUIService.handleLeaderboardCommand(ctx));

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

      // Text message handler - check daily task mode first, then IRS
      this.bot.on('message:text', async (ctx) => {
        const isDailyTask = await this.dailyTaskService.isInDailyTaskMode(ctx);
        if (isDailyTask) {
          return this.dailyTaskService.handleTextAnswer(ctx, ctx.message.text);
        }
        // IRS: if user is answering an IRS question, route to readiness service
        if (ctx.session?.irsStep === 'answering_irs') {
          return this.readinessService.handleIRSAnswer(ctx, ctx.message.text);
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
        { command: 'irs', description: '🧪 Interview Readiness Test' },
        { command: 'tasks', description: '📋 Daily Tasks' },
        { command: 'streak', description: '🔥 My Streak' },
        { command: 'leaderboard', description: '🏆 Leaderboard' },
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

      // Leaderboard callbacks — route to leaderboard UI service
      if (data.startsWith('lb_')) {
        await this.leaderboardUIService.handleLeaderboardCallback(ctx, data);
        return;
      }

      // IRS callbacks — route to readiness service
      // FIX TG-1: Removed duplicate answerCallbackQuery() — already answered at line 520
      if (data.startsWith('irs_')) {
        if (data.startsWith('irs_pos_')) {
          const position = data.replace('irs_pos_', '');
          await this.readinessService.handlePositionSelect(ctx, position);
          return;
        }
        if (data.startsWith('irs_tech_')) {
          const techStack = data.replace('irs_tech_', '');
          await this.readinessService.handleTechStackSelect(ctx, techStack);
          return;
        }
        if (data.startsWith('irs_share_')) {
          const testId = data.replace('irs_share_', '');
          await this.readinessService.handleIRSShare(ctx, testId);
          return;
        }
        if (data === 'irs_start_from_deeplink') {
          await this.readinessService.handleIRSStart(ctx);
          return;
        }
      }

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
   * Handle /streak command — show user's streak info with badges
   */
  private async handleStreakCommand(ctx: BotContext) {
    try {
      const userId = ctx.session?.userId;
      if (!userId) {
        const lang = ctx.session?.language || 'uz';
        const regText: Record<string, string> = {
          uz: 'Streak ko\'rish uchun avval ro\'yxatdan o\'ting. /start',
          ru: 'Для просмотра серии сначала зарегистрируйтесь. /start',
          en: 'Register first to see your streak. /start',
        };
        await ctx.reply(regText[lang] || regText.uz);
        return;
      }

      const info = await this.streakService.getStreakInfo(userId);
      const badgeProgress = await this.badgeService.getBadgeProgress(userId);

      const stateEmoji: Record<string, string> = {
        inactive: '⚪',
        active: '🟢',
        at_risk: '🟡',
        frozen: '🥶',
        broken: '🔴',
      };

      // FIX TG-17: Make streak state labels language-aware
      const lang = ctx.session?.language || 'uz';
      const stateLabelsMap: Record<string, Record<string, string>> = {
        inactive: { uz: 'Boshlanmagan', ru: 'Не начато', en: 'Not started' },
        active: { uz: 'Faol', ru: 'Активно', en: 'Active' },
        at_risk: { uz: 'Xavf ostida!', ru: 'Под угрозой!', en: 'At risk!' },
        frozen: { uz: 'Muzlatilgan', ru: 'Заморожено', en: 'Frozen' },
        broken: { uz: 'Uzilgan', ru: 'Прервано', en: 'Broken' },
      };

      const streakLabels: Record<string, Record<string, string>> = {
        streak: { uz: 'Streak', ru: 'Серия', en: 'Streak' },
        status: { uz: 'Holat', ru: 'Статус', en: 'Status' },
        longest: { uz: 'Eng uzun streak', ru: 'Максимальная серия', en: 'Longest streak' },
        activeDays: { uz: 'Faol kunlar', ru: 'Активных дней', en: 'Active days' },
        freezeLeft: { uz: 'Freeze qoldi', ru: 'Заморозок осталось', en: 'Freezes left' },
        day: { uz: 'kun', ru: 'дн', en: 'days' },
        milestones: { uz: 'Milestonelar', ru: 'Достижения', en: 'Milestones' },
        badges: { uz: 'Badgelar', ru: 'Значки', en: 'Badges' },
        startBadge: { uz: 'Birinchi badge uchun streakni boshlang!', ru: 'Начните серию для первого значка!', en: 'Start a streak for your first badge!' },
        todayTasks: { uz: 'Bugungi vazifalar', ru: 'Задания на сегодня', en: "Today's tasks" },
      };

      const sl = (key: string) => streakLabels[key]?.[lang] || streakLabels[key]?.uz || key;

      let message =
        `<b>🔥 ${sl('streak')}: ${info.currentStreak} ${sl('day')}</b>\n` +
        `${stateEmoji[info.state] || '⚪'} ${sl('status')}: ${stateLabelsMap[info.state]?.[lang] || stateLabelsMap[info.state]?.uz || info.state}\n\n` +
        `📈 ${sl('longest')}: ${info.longestStreak} ${sl('day')}\n` +
        `📅 ${sl('activeDays')}: ${info.totalActiveDays}\n` +
        `🧊 ${sl('freezeLeft')}: ${info.freezesRemaining}\n`;

      // Milestones
      if (info.milestones.length > 0) {
        message += `\n<b>🏅 ${sl('milestones')}:</b>\n`;
        for (const m of info.milestones) {
          message += `  ✅ ${m.days} ${sl('day')}\n`;
        }
      }

      // Badges
      if (badgeProgress.earned > 0) {
        message += `\n<b>🎖 ${sl('badges')}:</b> ${badgeProgress.earned}/${badgeProgress.total}\n`;
        const earned = badgeProgress.badges.filter((b) => b.earned);
        message += earned.map((b) => `${b.emoji} ${b.name}`).join(' | ') + '\n';
      } else {
        message += `\n<b>🎖 ${sl('badges')}:</b> 0/${badgeProgress.total}\n`;
        message += `${sl('startBadge')}\n`;
      }

      message += `\n/tasks — ${sl('todayTasks')}`;

      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error: any) {
      this.logger.error(`Streak command failed: ${error.message}`);
      await ctx.reply('Streak ma\'lumotlarini yuklashda xatolik. Qayta urinib ko\'ring.');
    }
  }

  /**
   * Get bot instance (for testing)
   */
  getBot(): Bot<BotContext> {
    return this.bot;
  }
}
