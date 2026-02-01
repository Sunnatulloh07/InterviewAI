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
        // Existing user - show main menu with full info
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

      // Show comprehensive welcome message with language selection
      const welcomeText = 
`👋 <b>Welcome to InterviewAI Pro!</b>

🤖 <b>What is this bot?</b>
AI-powered interview preparation assistant that helps you:

✅ <b>Mock Interviews</b> - Practice with AI interviewer
✅ <b>Live Interview Help</b> - Real-time answers during interviews
✅ <b>Daily Tasks</b> - Daily practice questions to stay sharp
✅ <b>CV Analysis</b> - AI-powered resume review
✅ <b>Voice Support</b> - Answer with voice messages

🌍 <b>Please select your language:</b>
Пожалуйста, выберите язык:
Iltimos, tilni tanlang:`;
      
      const langKeyboard = new InlineKeyboard()
        .text('🇺🇿 O\'zbek', 'lang_uz')
        .text('🇷🇺 Русский', 'lang_ru')
        .text('🇬🇧 English', 'lang_en');

      await ctx.reply(welcomeText, {
        parse_mode: 'HTML',
        reply_markup: langKeyboard,
      });

      this.logger.log(`New user started registration: ${telegramId}`);
    } catch (error: any) {
      this.logger.error(`Failed to handle start: ${error.message}`, error.stack);
      await ctx.reply('❌ Error occurred. Please try again.');
    }
  }

  /**
   * Show main menu to user with comprehensive information
   */
  private async showMainMenu(ctx: BotContext, user: any) {
    const lang = this.getUserLanguage(ctx, user);
    
    // Get subscription info
    const plan = user.subscription?.plan || 'free_trial';
    const planEmoji: Record<string, string> = {
      'free_trial': '🆓',
      'starter': '💎',
      'pro': '🚀',
      'elite': '👑',
    };
    const planNames: Record<string, Record<string, string>> = {
      'free_trial': { uz: 'Bepul sinov', ru: 'Пробный', en: 'Free Trial' },
      'starter': { uz: 'Starter', ru: 'Starter', en: 'Starter' },
      'pro': { uz: 'Pro', ru: 'Pro', en: 'Pro' },
      'elite': { uz: 'Elite', ru: 'Elite', en: 'Elite' },
    };

    // Get usage stats
    const mockInterviews = user.usage?.mockInterviewsThisMonth || 0;
    const streak = user.dailyTasks?.currentStreak || 0;
    const mockVoiceRemaining = user.voiceQuota?.mockVoice?.remaining || 0;
    const realVoiceRemaining = user.voiceQuota?.realVoice?.remaining || 0;

    const menuText: Record<string, string> = {
      uz: `👋 <b>Xush kelibsiz, ${user.firstName}!</b>

${planEmoji[plan]} Tarif: <b>${planNames[plan]?.uz || plan}</b>

📊 <b>Bu oylik statistika:</b>
• Mock intervyular: ${mockInterviews}
• 🔥 Streak: ${streak} kun
• 🎤 Ovozli: Mock ${mockVoiceRemaining} | Live ${realVoiceRemaining} daqiqa

━━━━━━━━━━━━━━━━━━
<b>Nima qilmoqchisiz?</b>`,

      ru: `👋 <b>Добро пожаловать, ${user.firstName}!</b>

${planEmoji[plan]} Тариф: <b>${planNames[plan]?.ru || plan}</b>

📊 <b>Статистика за месяц:</b>
• Mock интервью: ${mockInterviews}
• 🔥 Серия: ${streak} дней
• 🎤 Голосовые: Mock ${mockVoiceRemaining} | Live ${realVoiceRemaining} мин

━━━━━━━━━━━━━━━━━━
<b>Что хотите сделать?</b>`,

      en: `👋 <b>Welcome, ${user.firstName}!</b>

${planEmoji[plan]} Plan: <b>${planNames[plan]?.en || plan}</b>

📊 <b>This month's stats:</b>
• Mock interviews: ${mockInterviews}
• 🔥 Streak: ${streak} days
• 🎤 Voice: Mock ${mockVoiceRemaining} | Live ${realVoiceRemaining} min

━━━━━━━━━━━━━━━━━━
<b>What would you like to do?</b>`,
    };

    const buttonLabels: Record<string, Record<string, string>> = {
      interview: { uz: '🎯 Intervyu', ru: '🎯 Интервью', en: '🎯 Interview' },
      tasks: { uz: '📋 Vazifalar', ru: '📋 Задания', en: '📋 Tasks' },
      profile: { uz: '👤 Profil', ru: '👤 Профиль', en: '👤 Profile' },
      upgrade: { uz: '💳 Tarif', ru: '💳 Тарифы', en: '💳 Plans' },
      help: { uz: '❓ Yordam', ru: '❓ Помощь', en: '❓ Help' },
    };

    const keyboard = new InlineKeyboard()
      .text(buttonLabels.interview[lang] || buttonLabels.interview.en, 'menu_interview')
      .text(buttonLabels.tasks[lang] || buttonLabels.tasks.en, 'menu_tasks')
      .row()
      .text(buttonLabels.profile[lang] || buttonLabels.profile.en, 'menu_profile')
      .text(buttonLabels.upgrade[lang] || buttonLabels.upgrade.en, 'menu_upgrade')
      .row()
      .text(buttonLabels.help[lang] || buttonLabels.help.en, 'menu_help');

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
    try {
      const contact = ctx.message?.contact;
      if (!contact || !contact.phone_number) {
        const lang = ctx.session?.language || 'en';
        const errorText: Record<string, string> = {
          uz: '❌ Telefon raqami topilmadi. Iltimos qayta urinib ko\'ring.',
          ru: '❌ Номер телефона не найден. Пожалуйста, попробуйте снова.',
          en: '❌ Phone number not found. Please try again.',
        };
        await ctx.reply(errorText[lang] || errorText.en);
        return;
      }

      const lang = ctx.session?.language || 'en';
      let phoneNumber = contact.phone_number;
      const telegramId = ctx.from?.id as number;

      // Format phone number to international format
      phoneNumber = this.otpService.formatPhoneNumber(phoneNumber);

      // Update unregistered user status
      await this.unregisteredUserService.updateRegistrationStatus(telegramId, 'phone_entered');

      // Check if user already exists
      let user = await this.usersService.findByPhoneNumber(phoneNumber);

      if (user) {
        // User exists - update telegram ID if not set and log in
        if (!user.telegramId || user.telegramId !== telegramId) {
          await this.usersService.updateProfile((user as any).id || (user as any)._id?.toString(), {
            telegramId,
            telegramUsername: ctx.from?.username,
            telegramFirstName: ctx.from?.first_name,
            telegramLastName: ctx.from?.last_name,
          } as any);
        }

        // User is logged in - show main menu
        ctx.session.userId = (user as any).id?.toString() || (user as any)._id?.toString();

        const welcomeBackText: Record<string, string> = {
          uz: `✅ <b>Xush kelibsiz, ${user.firstName || user.telegramUsername || 'foydalanuvchi'}!</b>`,
          ru: `✅ <b>С возвращением, ${user.firstName || user.telegramUsername || 'пользователь'}!</b>`,
          en: `✅ <b>Welcome back, ${user.firstName || user.telegramUsername || 'user'}!</b>`,
        };
        
        await ctx.reply(welcomeBackText[lang] || welcomeBackText.en, {
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true },
        });

        // Show main menu
        await this.showMainMenu(ctx, user);

        this.logger.log(`Existing user ${telegramId} logged in with phone ${phoneNumber.substring(0, 5)}***`);
        return;
      }

      // New user - create account
      user = await this.usersService.create({
        phoneNumber,
        telegramId,
        telegramUsername: ctx.from?.username,
        telegramFirstName: ctx.from?.first_name,
        telegramLastName: ctx.from?.last_name,
        firstName: ctx.from?.first_name || ctx.from?.username || 'User',
        lastName: ctx.from?.last_name || '',
        language: lang,
      });

      // Set user ID in session
      ctx.session.userId = (user as any).id?.toString() || (user as any)._id?.toString();

      const welcomeText: Record<string, string> = {
        uz: `🎉 <b>Xush kelibsiz, ${user.firstName || user.telegramUsername || 'foydalanuvchi'}!</b>

✅ Siz muvaffaqiyatli ro'yxatdan o'tdingiz!

📊 <b>Bepul sinov davri:</b>
• 30 kun bepul
• 5 ta mock intervyu
• 10 daqiqa ovozli javoblar

Keling, boshlaymiz! 🚀`,
        
        ru: `🎉 <b>Добро пожаловать, ${user.firstName || user.telegramUsername || 'пользователь'}!</b>

✅ Вы успешно зарегистрированы!

📊 <b>Пробный период:</b>
• 30 дней бесплатно
• 5 пробных интервью
• 10 минут голосовых ответов

Давайте начнем! 🚀`,
        
        en: `🎉 <b>Welcome, ${user.firstName || user.telegramUsername || 'user'}!</b>

✅ You've successfully registered!

📊 <b>Free trial:</b>
• 30 days free
• 5 mock interviews
• 10 minutes voice answers

Let's get started! 🚀`,
      };

      await ctx.reply(welcomeText[lang] || welcomeText.en, {
        parse_mode: 'HTML',
        reply_markup: { remove_keyboard: true },
      });

      // Show main menu
      await this.showMainMenu(ctx, user);

      // Log analytics
      try {
        await this.analyticsService.trackEvent({
          userId: ctx.session.userId as any,
          eventType: 'user_registered',
          metadata: {
            userAgent: 'telegram_bot',
            ipAddress: '0.0.0.0',
            platform: 'telegram',
            version: '1.0',
          } as any,
        });
      } catch (error: any) {
        this.logger.warn(`Failed to track analytics: ${error.message}`);
      }

      this.logger.log(`New user ${telegramId} registered with phone ${phoneNumber.substring(0, 5)}***`);
    } catch (error: any) {
      this.logger.error(`Failed to handle contact message: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos /start bosib qayta urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, нажмите /start и попробуйте снова.',
        en: '❌ Error occurred. Please press /start and try again.',
      };
      await ctx.reply(errorText[lang] || errorText.en);
    }
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

    const lang = ctx.session?.language || 'en';

    // Note: ctx.answerCallbackQuery() is already called by telegram.service.ts
    // before this method. Do NOT call it again here to avoid "query is too old" errors.

    // Route to appropriate handler based on callback data

    // ============================================================
    // LIVE SESSION CALLBACKS - route to live service
    // ============================================================
    if (callbackData.startsWith('live_domain_') || 
        callbackData.startsWith('live_tech_') || 
        callbackData.startsWith('live_position_')) {
      await this.liveService.handleLiveMetadataCallback(ctx, callbackData);
      return;
    }

    // ============================================================
    // SUBSCRIPTION CALLBACKS - route to subscription service
    // ============================================================
    if (callbackData.startsWith('upgrade_') || 
        callbackData === 'show_plans' || 
        callbackData === 'contact_support' ||
        callbackData === 'back_to_menu') {
      
      // Special case: back_to_menu returns to main menu
      if (callbackData === 'back_to_menu') {
        // Get user to pass to showMainMenu
        const userId = ctx.session?.userId;
        if (userId) {
          const user = await this.usersService.findById(userId);
          if (user) {
            await this.showMainMenu(ctx, user);
            return;
          }
        }
        // Fallback: redirect to /start if no user found
        await this.handleStart(ctx);
        return;
      }
      
      const handled = await this.subscriptionService.handleSubscriptionCallback(ctx, callbackData, lang);
      if (handled) return;
    }

    // ============================================================
    // LANGUAGE SELECTION
    // ============================================================
    if (callbackData.startsWith('lang_')) {
      const selectedLang = callbackData.replace('lang_', '');
      ctx.session.language = selectedLang;
      
      const telegramId = ctx.from?.id;
      if (telegramId) {
        await this.unregisteredUserService.trackUserStart(
          telegramId,
          ctx.from?.first_name,
          ctx.from?.last_name,
          ctx.from?.username,
          selectedLang,
        );
      }
      
      // Show phone number request
      const registrationText: Record<string, string> = {
        uz: `✅ <b>Til o'rnatildi!</b>

🔐 <b>Ro'yxatdan o'tish</b>

Botdan foydalanish uchun telefon raqamingizni tasdiqlang.

Quyidagi tugmani bosing 👇`,
        
        ru: `✅ <b>Язык установлен!</b>

🔐 <b>Регистрация</b>

Для использования бота подтвердите номер телефона.

Нажмите кнопку ниже 👇`,
        
        en: `✅ <b>Language set!</b>

🔐 <b>Registration</b>

To use the bot, verify your phone number.

Press the button below 👇`,
      };
      
      const phoneButton: Record<string, string> = {
        uz: '📱 Telefon raqamni yuborish',
        ru: '📱 Отправить номер',
        en: '📱 Share phone number',
      };
      
      const keyboard = new Keyboard()
        .requestContact(phoneButton[selectedLang] || phoneButton.en)
        .resized()
        .oneTime();
      
      await ctx.reply(registrationText[selectedLang] || registrationText.en, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      
      this.logger.log(`User ${telegramId} selected language: ${selectedLang}`);
      return;
    }

    // ============================================================
    // MAIN MENU CALLBACKS
    // ============================================================
    if (callbackData.startsWith('menu_')) {
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
      return;
    }

    // ============================================================
    // INTERVIEW TYPE SELECTION
    // ============================================================
    if (callbackData.startsWith('interview_')) {
      const type = callbackData.replace('interview_', '');
      if (type === 'mock') {
        // Start mock interview flow
        await ctx.reply('🎯 Mock intervyu boshlanmoqda...');
      } else if (type === 'live') {
        // Start live interview flow
        await this.liveService.handleStartLive(ctx);
      }
      return;
    }

    // ============================================================
    // POSITION SELECTION
    // ============================================================
    if (callbackData.startsWith('position_')) {
      const position = callbackData.replace('position_', '');
      // Update user position
      await ctx.reply(`✅ Lavozim o'rnatildi: ${position}`);
      return;
    }

    // Unknown callback - log for debugging
    this.logger.warn(`Unknown callback data: ${callbackData}`);
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
