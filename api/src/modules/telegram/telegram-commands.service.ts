import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { BotContext } from './telegram.service';
import { InlineKeyboard, Keyboard } from 'grammy';
import { InterviewsService } from '../interviews/interviews.service';
import { InterviewsFeedbackService } from '../interviews/interviews-feedback.service';
import { OtpService } from '../otp/otp.service';
import { CvService } from '../cv/cv.service';
import { TelegramLiveService } from './telegram-live.service';
import { TelegramSubscriptionService } from './telegram-subscription.service';
import { TelegramDailyTaskService } from './telegram-daily-task.service';
import { SubscriptionService } from '../payments/subscription.service';
import { SecurityService } from '../security/security.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { EngagementService } from '../engagement/engagement.service';
import { SurveyHandlerService } from '../engagement/survey-handler.service';
import { UnregisteredUserService } from '../engagement/unregistered-user.service';
import { DailyTasksService } from '../tasks/daily-tasks.service';
import { OpenAI } from 'openai';
import { createOpenAIClient, getModelName } from '@common/utils/openai-client.factory';

@Injectable()
export class TelegramCommandsService {
  private readonly logger = new Logger(TelegramCommandsService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly usersService: UsersService,
    private readonly interviewsService: InterviewsService,
    private readonly interviewsFeedbackService: InterviewsFeedbackService,
    private readonly configService: ConfigService,
    private readonly otpService: OtpService,
    private readonly cvService: CvService,
    private readonly liveService: TelegramLiveService,
    private readonly coreSubscriptionService: SubscriptionService,
    private readonly subscriptionService: TelegramSubscriptionService,
    private readonly dailyTaskService: TelegramDailyTaskService,
    private readonly securityService: SecurityService,
    private readonly analyticsService: AnalyticsService,
    private readonly answerService: AiAnswerService,
    @Inject(forwardRef(() => EngagementService))
    private readonly engagementService: EngagementService,
    private readonly surveyHandlerService: SurveyHandlerService,
    @Inject(forwardRef(() => DailyTasksService))
    private readonly dailyTasksService: DailyTasksService,
    private readonly unregisteredUserService: UnregisteredUserService,
  ) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Get user language with proper fallback chain and session sync
   * Priority: session > user.preferences.language > user.language > 'en'
   */
  private getUserLanguage(ctx: BotContext, user: any): string {
    let lang = ctx.session?.language;
    if (!lang && user?.preferences?.language) {
      lang = user.preferences.language;
    }
    if (!lang && user?.language) {
      lang = user.language;
    }
    if (!lang) {
      lang = 'en';
    }
    // Sync to session for future use
    if (ctx.session && !ctx.session.language) {
      ctx.session.language = lang;
    }
    return lang;
  }

  /**
   * Handle /start command
   * Registration wizard for new users
   */
  async handleStart(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (user) {
        // Existing user - show main menu
        await this.showMainMenu(ctx, user);
        return;
      }

      // New user - start registration
      // Set initial language selection step
      if (!ctx.session) ctx.session = {} as any;

      // Track unregistered user for engagement
      await this.unregisteredUserService.trackUserStart(
        telegramId,
        ctx.from?.first_name,
        ctx.from?.last_name,
        ctx.from?.username,
        'en', // Default language until selected
      );

      // Show language selection
      const welcomeText = `👋 Welcome to InterviewAI Pro!\n\n🌍 Please select your language / Пожалуйста, выберите язык / Iltimos, tilni tanlang:`;
      
      const langKeyboard = new InlineKeyboard()
        .text('🇺🇿 O\'zbek', 'lang_uz')
        .text('🇷🇺 Русский', 'lang_ru')
        .text('🇬🇧 English', 'lang_en');

      await ctx.reply(welcomeText, {
        reply_markup: langKeyboard,
      });

      this.logger.log(`New user started registration: ${telegramId}`);
    } catch (error: any) {
      this.logger.error(`Failed to handle start: ${error.message}`, error.stack);
      await ctx.reply('❌ Error occurred. Please try again.');
    }
  }

  /**
   * Show main menu to user
   */
  private async showMainMenu(ctx: BotContext, user: any) {
    const lang = this.getUserLanguage(ctx, user);
    
    const menuText: Record<string, string> = {
      uz: `👋 <b>Xush kelibsiz, ${user.firstName}!</b>\n\nNima qilmoqchisiz?`,
      ru: `👋 <b>Добро пожаловать, ${user.firstName}!</b>\n\nЧто хотите сделать?`,
      en: `👋 <b>Welcome, ${user.firstName}!</b>\n\nWhat would you like to do?`,
    };

    const keyboard = new InlineKeyboard()
      .text('🎯 Intervyu', 'menu_interview')
      .text('📋 Vazifalar', 'menu_tasks')
      .row()
      .text('👤 Profil', 'menu_profile')
      .text('💳 Tarif', 'menu_upgrade')
      .row()
      .text('❓ Yordam', 'menu_help');

    await ctx.reply(menuText[lang] || menuText['en'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Handle /tasks command - show daily tasks
   */
  async handleTasks(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        const lang = ctx.session?.language || 'en';
        const notRegisteredText: Record<string, string> = {
          uz: `Iltimos avval /start buyrug'i bilan ro'yxatdan o'ting`,
          ru: `Пожалуйста, сначала зарегистрируйтесь используя /start`,
          en: `Please register first using /start`,
        };
        await ctx.reply(notRegisteredText[lang] || notRegisteredText['en']);
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      const userId = (user as any)._id?.toString() || (user as any).id?.toString();

      // ✅ STEP 5 FIX: Auto-start daily task session
      await this.dailyTaskService.startDailyTaskSession(ctx, userId);
      
      this.logger.log(`Daily task session started for user ${userId}`);
    } catch (error: any) {
      this.logger.error(`Failed to handle tasks: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: `❌ Xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `❌ Произошла ошибка. Пожалуйста, попробуйте снова.`,
        en: `❌ Error occurred. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Handle /stop command
   */
  async handleStop(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const stopText: Record<string, string> = {
      uz: `👋 Xayr! Bot to'xtatildi.\n\nQayta ishga tushirish uchun /start bosing.`,
      ru: `👋 До свидания! Бот остановлен.\n\nНажмите /start для перезапуска.`,
      en: `👋 Goodbye! Bot stopped.\n\nPress /start to restart.`,
    };
    await ctx.reply(stopText[lang] || stopText['en']);
  }

  /**
   * Handle /profile command
   */
  async handleProfile(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      
      const profileText = {
        uz: `👤 <b>Profil</b>\n\n` +
            `Ism: ${user.firstName} ${user.lastName}\n` +
            `Telefon: ${user.phoneNumber}\n` +
            `Lavozim: ${user.profile?.position || 'Aniqlanmagan'}\n\n` +
            `📊 <b>Statistika</b>\n` +
            `Intervyular: ${user.usage?.mockInterviewsThisMonth || 0}\n` +
            `CV tahlili: ${user.usage?.cvAnalysesThisMonth || 0}\n` +
            `🔥 Streak: ${user.dailyTasks?.currentStreak || 0} kun`,
        ru: `👤 <b>Профиль</b>\n\n` +
            `Имя: ${user.firstName} ${user.lastName}\n` +
            `Телефон: ${user.phoneNumber}\n` +
            `Должность: ${user.profile?.position || 'Не указана'}\n\n` +
            `📊 <b>Статистика</b>\n` +
            `Интервью: ${user.usage?.mockInterviewsThisMonth || 0}\n` +
            `Анализ CV: ${user.usage?.cvAnalysesThisMonth || 0}\n` +
            `🔥 Серия: ${user.dailyTasks?.currentStreak || 0} дней`,
        en: `👤 <b>Profile</b>\n\n` +
            `Name: ${user.firstName} ${user.lastName}\n` +
            `Phone: ${user.phoneNumber}\n` +
            `Position: ${user.profile?.position || 'Not set'}\n\n` +
            `📊 <b>Statistics</b>\n` +
            `Interviews: ${user.usage?.mockInterviewsThisMonth || 0}\n` +
            `CV Analyses: ${user.usage?.cvAnalysesThisMonth || 0}\n` +
            `🔥 Streak: ${user.dailyTasks?.currentStreak || 0} days`,
      };

      await ctx.reply(profileText[lang as keyof typeof profileText] || profileText['en'], {
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      this.logger.error(`Failed to show profile: ${error.message}`);
      await ctx.reply('❌ Error occurred');
    }
  }

  /**
   * Handle /interview command
   */
  async handleInterview(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      const keyboard = new InlineKeyboard()
        .text('🎯 Mock Intervyu', 'interview_mock')
        .text('🔴 Live Intervyu', 'interview_live')
        .row()
        .text('❌ Bekor qilish', 'interview_cancel');

      const interviewText: Record<string, string> = {
        uz: '🎯 <b>Intervyu turini tanlang:</b>',
        ru: '🎯 <b>Выберите тип интервью:</b>',
        en: '🎯 <b>Select interview type:</b>',
      };

      await ctx.reply(interviewText[lang] || interviewText['en'], {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: any) {
      this.logger.error(`Failed to handle interview: ${error.message}`);
      await ctx.reply('❌ Error occurred');
    }
  }

  /**
   * Handle /upgrade command
   */
  async handleUpgrade(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const plansText: Record<string, string> = {
      uz: `💳 <b>Tariflar</b>\n\n` +
          `🆓 Free Trial - 7 kun\n` +
          `💎 Starter - $9.99/oy\n` +
          `🚀 Pro - $19.99/oy\n` +
          `👑 Elite - $29.99/oy\n\n` +
          `Batafsil: /help`,
      ru: `💳 <b>Тарифы</b>\n\n` +
          `🆓 Free Trial - 7 дней\n` +
          `💎 Starter - $9.99/мес\n` +
          `🚀 Pro - $19.99/мес\n` +
          `👑 Elite - $29.99/мес\n\n` +
          `Подробнее: /help`,
      en: `💳 <b>Plans</b>\n\n` +
          `🆓 Free Trial - 7 days\n` +
          `💎 Starter - $9.99/month\n` +
          `🚀 Pro - $19.99/month\n` +
          `👑 Elite - $29.99/month\n\n` +
          `More info: /help`,
    };
    await ctx.reply(plansText[lang] || plansText['en'], { parse_mode: 'HTML' });
  }

  /**
   * Handle /voice command - show voice quota status
   */
  async handleVoice(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      const voiceQuota = user.voiceQuota;
      
      const quotaText: Record<string, string> = {
        uz: `🎤 <b>Ovozli xabar limiti</b>\n\n` +
            `Mock: ${voiceQuota?.mockVoice?.remaining || 0}/${voiceQuota?.mockVoice?.total || 0} daqiqa\n` +
            `Live: ${voiceQuota?.realVoice?.remaining || 0}/${voiceQuota?.realVoice?.total || 0} daqiqa\n\n` +
            `Yangilanish: ${voiceQuota?.mockVoice?.resetDate ? new Date(voiceQuota.mockVoice.resetDate).toLocaleDateString('uz-UZ') : 'N/A'}`,
        ru: `🎤 <b>Лимит голосовых сообщений</b>\n\n` +
            `Mock: ${voiceQuota?.mockVoice?.remaining || 0}/${voiceQuota?.mockVoice?.total || 0} мин\n` +
            `Live: ${voiceQuota?.realVoice?.remaining || 0}/${voiceQuota?.realVoice?.total || 0} мин\n\n` +
            `Обновление: ${voiceQuota?.mockVoice?.resetDate ? new Date(voiceQuota.mockVoice.resetDate).toLocaleDateString('ru-RU') : 'N/A'}`,
        en: `🎤 <b>Voice Quota Status</b>\n\n` +
            `Mock: ${voiceQuota?.mockVoice?.remaining || 0}/${voiceQuota?.mockVoice?.total || 0} min\n` +
            `Live: ${voiceQuota?.realVoice?.remaining || 0}/${voiceQuota?.realVoice?.total || 0} min\n\n` +
            `Reset: ${voiceQuota?.mockVoice?.resetDate ? new Date(voiceQuota.mockVoice.resetDate).toLocaleDateString('en-US') : 'N/A'}`,
      };
      
      await ctx.reply(quotaText[lang] || quotaText['en'], { parse_mode: 'HTML' });
    } catch (error: any) {
      this.logger.error(`Failed to handle voice command: ${error.message}`);
      await ctx.reply('❌ Error occurred');
    }
  }

  /**
   * Handle /set_position command
   */
  async handleSetPosition(ctx: BotContext) {
    const keyboard = new InlineKeyboard()
      .text('👶 Junior', 'position_junior')
      .text('🧑‍💻 Middle', 'position_middle')
      .row()
      .text('👨‍💼 Senior', 'position_senior')
      .text('👨‍💼 Lead', 'position_lead');

    const lang = ctx.session?.language || 'en';
    const positionText: Record<string, string> = {
      uz: '👤 <b>Lavozimingizni tanlang:</b>',
      ru: '👤 <b>Выберите вашу должность:</b>',
      en: '👤 <b>Select your position:</b>',
    };

    await ctx.reply(positionText[lang] || positionText['en'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Handle /help command
   */
  async handleHelp(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const helpText: Record<string, string> = {
      uz: `❓ <b>Yordam</b>\n\n` +
          `/start - Botni ishga tushirish\n` +
          `/interview - Intervyu boshlash\n` +
          `/tasks - Kunlik vazifalar\n` +
          `/profile - Profilni ko'rish\n` +
          `/upgrade - Tarifni o'zgartirish\n` +
          `/voice - Ovozli xabar limiti\n` +
          `/help - Yordam\n\n` +
          `Savollar uchun: @interviewai_support`,
      ru: `❓ <b>Помощь</b>\n\n` +
          `/start - Запуск бота\n` +
          `/interview - Начать интервью\n` +
          `/tasks - Ежедневные задания\n` +
          `/profile - Профиль\n` +
          `/upgrade - Изменить тариф\n` +
          `/voice - Лимит голосовых\n` +
          `/help - Помощь\n\n` +
          `Поддержка: @interviewai_support`,
      en: `❓ <b>Help</b>\n\n` +
          `/start - Start bot\n` +
          `/interview - Start interview\n` +
          `/tasks - Daily tasks\n` +
          `/profile - View profile\n` +
          `/upgrade - Change plan\n` +
          `/voice - Voice quota status\n` +
          `/help - Help\n\n` +
          `Support: @interviewai_support`,
    };

    await ctx.reply(helpText[lang] || helpText['en'], {
      parse_mode: 'HTML',
    });
  }

  /**
   * Handle /stats command
   */
  async handleStats(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const statsText: Record<string, string> = {
      uz: '📊 Statistika tez orada qo\'shiladi!',
      ru: '📊 Статистика скоро будет добавлена!',
      en: '📊 Statistics coming soon!',
    };
    await ctx.reply(statsText[lang] || statsText['en']);
  }

  /**
   * Handle /settings command
   */
  async handleSettings(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const settingsText: Record<string, string> = {
      uz: '⚙️ Sozlamalar tez orada qo\'shiladi!',
      ru: '⚙️ Настройки скоро будут добавлены!',
      en: '⚙️ Settings coming soon!',
    };
    await ctx.reply(settingsText[lang] || settingsText['en']);
  }

  /**
   * Handle /analyze_cv command
   */
  async handleAnalyzeCv(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const cvText: Record<string, string> = {
      uz: '📄 CV yuklash uchun hujjatni yuboring (PDF, DOCX)',
      ru: '📄 Отправьте документ для анализа CV (PDF, DOCX)',
      en: '📄 Send your CV document for analysis (PDF, DOCX)',
    };
    await ctx.reply(cvText[lang] || cvText['en']);
  }

  /**
   * Handle /progress command
   */
  async handleProgress(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const progressText: Record<string, string> = {
      uz: '📈 Progress tracking tez orada qo\'shiladi!',
      ru: '📈 Отслеживание прогресса скоро будет добавлено!',
      en: '📈 Progress tracking coming soon!',
    };
    await ctx.reply(progressText[lang] || progressText['en']);
  }

  /**
   * Handle contact message (phone number registration)
   */
  async handleContactMessage(ctx: BotContext) {
    // Implementation for phone number registration
    const lang = ctx.session?.language || 'en';
    const contactText: Record<string, string> = {
      uz: '✅ Telefon raqami qabul qilindi!',
      ru: '✅ Номер телефона получен!',
      en: '✅ Phone number received!',
    };
    await ctx.reply(contactText[lang] || contactText['en']);
  }

  /**
   * Handle document message (CV upload)
   */
  async handleDocumentMessage(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const docText: Record<string, string> = {
      uz: '📄 Hujjat qabul qilindi. Tahlil qilinmoqda...',
      ru: '📄 Документ получен. Анализируется...',
      en: '📄 Document received. Analyzing...',
    };
    await ctx.reply(docText[lang] || docText['en']);
  }

  /**
   * Handle callback queries (inline keyboard buttons)
   */
  async handleCallbackQuery(ctx: BotContext) {
    const callbackData = ctx.callbackQuery?.data;
    if (!callbackData) return;

    // Answer callback to remove loading state
    await ctx.answerCallbackQuery();

    // Route to appropriate handler based on callback data
    if (callbackData.startsWith('lang_')) {
      const lang = callbackData.replace('lang_', '');
      ctx.session.language = lang;
      await ctx.reply(`✅ Language set to ${lang.toUpperCase()}`);
    }
    else if (callbackData.startsWith('menu_')) {
      const menu = callbackData.replace('menu_', '');
      switch (menu) {
        case 'interview':
          await this.handleInterview(ctx);
          break;
        case 'tasks':
          await this.handleTasks(ctx);
          break;
        case 'profile':
          await this.handleProfile(ctx);
          break;
        case 'upgrade':
          await this.handleUpgrade(ctx);
          break;
        case 'help':
          await this.handleHelp(ctx);
          break;
      }
    }
    else if (callbackData.startsWith('interview_')) {
      const type = callbackData.replace('interview_', '');
      if (type === 'mock') {
        // Start mock interview flow
        await ctx.reply('🎯 Mock intervyu boshlanmoqda...');
      } else if (type === 'live') {
        // Start live interview flow
        await this.liveService.handleStartLive(ctx);
      }
    }
    else if (callbackData.startsWith('position_')) {
      const position = callbackData.replace('position_', '');
      // Update user position
      await ctx.reply(`✅ Lavozim o'rnatildi: ${position}`);
    }
  }

  /**
   * Handle text messages in different contexts
   */
  async handleTextMessage(ctx: BotContext) {
    const text = ctx.message?.text;
    if (!text) return;

    // Check if in interview flow
    if (ctx.session?.interviewStep) {
      // Handle interview flow text
      await ctx.reply('Interview flow handling...');
      return;
    }

    // Default: show help
    const lang = ctx.session?.language || 'en';
    const unknownText: Record<string, string> = {
      uz: `❓ Tushunarsiz buyruq. /help orqali yordam oling.`,
      ru: `❓ Неизвестная команда. Используйте /help для помощи.`,
      en: `❓ Unknown command. Use /help for assistance.`,
    };
    await ctx.reply(unknownText[lang] || unknownText['en']);
  }

  /**
   * Handle menu text from reply keyboard
   * Returns true if handled, false otherwise
   */
  async handleMenuText(ctx: BotContext): Promise<boolean> {
    const text = ctx.message?.text;
    if (!text) return false;

    // Check for menu button texts
    const menuMap: Record<string, string> = {
      '🎯 Intervyu': 'interview',
      '🎯 Interview': 'interview',
      '🎯 Интервью': 'interview',
      '📋 Vazifalar': 'tasks',
      '📋 Tasks': 'tasks',
      '📋 Задания': 'tasks',
      '👤 Profil': 'profile',
      '👤 Profile': 'profile',
      '👤 Профиль': 'profile',
      '💳 Tarif': 'upgrade',
      '💳 Plans': 'upgrade',
      '💳 Тарифы': 'upgrade',
    };

    const menu = menuMap[text];
    if (menu) {
      switch (menu) {
        case 'interview':
          await this.handleInterview(ctx);
          return true;
        case 'tasks':
          await this.handleTasks(ctx);
          return true;
        case 'profile':
          await this.handleProfile(ctx);
          return true;
        case 'upgrade':
          await this.handleUpgrade(ctx);
          return true;
      }
    }

    return false;
  }

  /**
   * Handle interview text flow
   */
  async handleInterviewText(ctx: BotContext): Promise<void> {
    const lang = ctx.session?.language || 'en';
    const processingText: Record<string, string> = {
      uz: '⏳ Intervyu jarayonida...',
      ru: '⏳ Интервью в процессе...',
      en: '⏳ Interview in progress...',
    };
    await ctx.reply(processingText[lang] || processingText['en']);
  }

  /**
   * Handle callback from telegram.service
   * Wrapper around handleCallbackQuery
   */
  async handleCallback(ctx: BotContext, data: string): Promise<void> {
    // Set the callback data and call our handler
    if (ctx.callbackQuery) {
      (ctx.callbackQuery as any).data = data;
    }
    await this.handleCallbackQuery(ctx);
  }
}
