import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { BotContext } from './telegram.service';
import { InlineKeyboard, Keyboard } from 'grammy';
import { InterviewsService } from '../interviews/interviews.service';
import { OtpService } from '../otp/otp.service';
import { CvService } from '../cv/cv.service';
import { TelegramLiveService } from './telegram-live.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { OpenAI } from 'openai';

@Injectable()
export class TelegramCommandsService {
  private readonly logger = new Logger(TelegramCommandsService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly usersService: UsersService,
    private readonly interviewsService: InterviewsService,
    private readonly configService: ConfigService,
    private readonly otpService: OtpService,
    private readonly cvService: CvService,
    private readonly liveService: TelegramLiveService,
    private readonly analyticsService: AnalyticsService,
    private readonly answerService: AiAnswerService,
  ) {
    // Initialize OpenAI client for direct translation (via OpenRouter)
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    const siteUrl = this.configService.get<string>('OPENAI_SITE_URL');
    const siteName = this.configService.get<string>('OPENAI_SITE_NAME');

    if (apiKey && apiKey.trim() && !apiKey.includes('your-') && !apiKey.includes('sk-***')) {
      const config: {
        apiKey: string;
        baseURL?: string;
        defaultHeaders?: Record<string, string>;
      } = {
        apiKey: apiKey.trim(),
      };

      // OpenRouter configuration
      if (baseURL && baseURL.includes('openrouter')) {
        config.baseURL = baseURL;
        config.defaultHeaders = {};

        // Add optional headers for OpenRouter rankings
        if (siteUrl) {
          config.defaultHeaders['HTTP-Referer'] = siteUrl;
        }
        if (siteName) {
          config.defaultHeaders['X-Title'] = siteName;
        }
      }

      this.openai = new OpenAI(config);
      this.logger.log('OpenAI client initialized via OpenRouter');
    } else {
      this.openai = null;
    }
  }

  async handleStart(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;

    // Check if user exists in database first
    const user = await this.usersService.findByTelegramId(telegramId);

    if (user) {
      // Existing user - load language from database
      const savedLang = user.language || user.preferences?.language || 'uz';
      ctx.session.language = savedLang;

      // Show main menu with saved language
      const welcomeText = this.getWelcomeText(savedLang);
      const mainKeyboard = this.getMainKeyboard(savedLang);

      await ctx.reply(welcomeText, {
        reply_markup: mainKeyboard,
        parse_mode: 'HTML',
      });
      return;
    }

    // New user - check if language already selected in session
    if (!ctx.session.language) {
      // Show language selection
      const languageKeyboard = new InlineKeyboard()
        .text("🇺🇿 O'zbekcha", 'lang_uz')
        .row()
        .text('🇷🇺 Русский', 'lang_ru')
        .row()
        .text('🇬🇧 English', 'lang_en');

      // Language selection message (will be shown in all languages for new users)
      const welcomeText =
        '👋 <b>InterviewAI Pro</b>\n\n' +
        'Xush kelibsiz! | Добро пожаловать! | Welcome!\n\n' +
        'Tilni tanlang | Выберите язык | Select language:';

      await ctx.reply(welcomeText, {
        reply_markup: languageKeyboard,
        parse_mode: 'HTML',
      });
      return;
    }

    // Language is set but user not registered - show registration
    const lang = ctx.session.language;
    const regText = this.getRegistrationText(lang);
    const regKeyboard = this.getRegistrationKeyboard(lang);

    await ctx.reply(regText, {
      reply_markup: regKeyboard,
      parse_mode: 'HTML',
    });
  }

  private getMainKeyboard(lang: string): InlineKeyboard {
    const keyboards: Record<string, InlineKeyboard> = {
      uz: new InlineKeyboard()
        .text('🎯 Intervyu', 'interview_start')
        .row()
        .text('📊 Profil', 'profile')
        .row()
        .text('📈 Statistika', 'stats')
        .row()
        .text('ℹ️ Yordam', 'help'),

      ru: new InlineKeyboard()
        .text('🎯 Интервью', 'interview_start')
        .row()
        .text('📊 Профиль', 'profile')
        .row()
        .text('📈 Статистика', 'stats')
        .row()
        .text('ℹ️ Помощь', 'help'),

      en: new InlineKeyboard()
        .text('🎯 Interview', 'interview_start')
        .row()
        .text('📊 Profile', 'profile')
        .row()
        .text('📈 Statistics', 'stats')
        .row()
        .text('ℹ️ Help', 'help'),
    };

    return keyboards[lang] || keyboards['en'];
  }

  private getRegistrationText(lang: string): string {
    const texts: Record<string, string> = {
      uz:
        `🆕 <b>Ro'yxatdan o'tish</b>\n\n` +
        `Ro'yxatdan o'tish uchun quyidagi tugmani bosing va telefon raqamingizni yuboring:\n\n` +
        `Telefon raqamingiz avtomatik yuboriladi va biz sizni ro'yxatdan o'tkazamiz.`,

      ru:
        `🆕 <b>Регистрация</b>\n\n` +
        `Для регистрации нажмите кнопку ниже и отправьте свой номер телефона:\n\n` +
        `Ваш номер телефона будет отправлен автоматически, и мы зарегистрируем вас.`,

      en:
        `🆕 <b>Registration</b>\n\n` +
        `To register, please press the button below and send your phone number:\n\n` +
        `Your phone number will be sent automatically and we will register you.`,
    };

    return texts[lang] || texts['en'];
  }

  private getRegistrationKeyboard(lang: string): Keyboard {
    const buttonTexts: Record<string, string> = {
      uz: '📱 Telefon raqamni yuborish',
      ru: '📱 Отправить номер телефона',
      en: '📱 Send phone number',
    };

    const keyboard = new Keyboard()
      .requestContact(buttonTexts[lang] || buttonTexts['en'])
      .resized()
      .oneTime();

    return keyboard;
  }

  private getWelcomeText(lang: string): string {
    const texts: Record<string, string> = {
      uz:
        `👋 <b>InterviewAI Pro ga xush kelibsiz!</b>\n\n` +
        `Men sizning AI intervyu tayyorlov yordamchingizman. Men sizga yordam bera olaman:\n\n` +
        `✅ Mock intervyularni mashq qilish\n` +
        `✅ CV ni tahlil qilish\n` +
        `✅ Real vaqtda intervyu yordami\n` +
        `✅ Javoblaringizni yaxshilash\n\n` +
        `Keling, boshlaymiz!`,

      ru:
        `👋 <b>Добро пожаловать в InterviewAI Pro!</b>\n\n` +
        `Я ваш AI помощник по подготовке к интервью. Я могу помочь вам:\n\n` +
        `✅ Практиковать mock интервью\n` +
        `✅ Анализировать резюме\n` +
        `✅ Получать помощь в реальном времени\n` +
        `✅ Улучшить ваши ответы\n\n` +
        `Давайте начнём!`,

      en:
        `👋 <b>Welcome to InterviewAI Pro!</b>\n\n` +
        `I'm your AI interview preparation assistant. I can help you:\n\n` +
        `✅ Practice mock interviews\n` +
        `✅ Analyze your CV\n` +
        `✅ Get real-time interview help\n` +
        `✅ Improve your answers\n\n` +
        `Let's get started!`,
    };

    return texts[lang] || texts['en'];
  }

  async handleProfile(ctx: BotContext) {
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

      // Get language from session, user preferences, or database
      let lang = ctx.session?.language;
      if (!lang) {
        lang = user.preferences?.language || user.language || 'en';
        // Save to session for future use
        if (ctx.session) {
          ctx.session.language = lang;
        }
      }

      const profileText = this.getProfileText(lang, user);
      await ctx.reply(profileText, { parse_mode: 'HTML' });
    } catch (_error) {
      const lang = ctx.session.language || 'en';
      const errorText: Record<string, string> = {
        uz: `Xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `Произошла ошибка. Пожалуйста, попробуйте снова.`,
        en: `Error occurred. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  private getProfileText(lang: string, user: any): string {
    const texts: Record<string, string> = {
      uz:
        `📊 <b>Sizning Profilingiz</b>\n\n` +
        `<b>Ism:</b> ${user.firstName} ${user.lastName}\n` +
        `<b>Rejа:</b> ${user.subscription?.plan || 'free'}\n` +
        `<b>Bu oy intervyular:</b> ${user.usage.mockInterviewsThisMonth}\n` +
        `<b>CV tahlillari:</b> ${user.usage.cvAnalysesThisMonth}`,

      ru:
        `📊 <b>Ваш Профиль</b>\n\n` +
        `<b>Имя:</b> ${user.firstName} ${user.lastName}\n` +
        `<b>План:</b> ${user.subscription?.plan || 'free'}\n` +
        `<b>Интервью в этом месяце:</b> ${user.usage.mockInterviewsThisMonth}\n` +
        `<b>Анализы CV:</b> ${user.usage.cvAnalysesThisMonth}`,

      en:
        `📊 <b>Your Profile</b>\n\n` +
        `<b>Name:</b> ${user.firstName} ${user.lastName}\n` +
        `<b>Plan:</b> ${user.subscription?.plan || 'free'}\n` +
        `<b>Interviews this month:</b> ${user.usage.mockInterviewsThisMonth}\n` +
        `<b>CV analyses:</b> ${user.usage.cvAnalysesThisMonth}`,
    };

    return texts[lang] || texts['en'];
  }

  async handleInterview(ctx: BotContext) {
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

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    // Reset interview state
    ctx.session.interviewStep = 'mode';
    ctx.session.interviewMode = undefined;
    ctx.session.interviewDomain = undefined;
    ctx.session.interviewTechnology = undefined;
    ctx.session.interviewPosition = undefined;
    ctx.session.interviewCompany = undefined;
    ctx.session.interviewCvId = undefined;

    // Step 1: Ask for interview mode (Mock or Real)
    const modeText: Record<string, string> = {
      uz: `🎯 <b>Intervyu turini tanlang</b>\n\nQaysi turdagi intervyuni boshlashni xohlaysiz?`,
      ru: `🎯 <b>Выберите тип интервью</b>\n\nКакой тип интервью вы хотите начать?`,
      en: `🎯 <b>Select Interview Type</b>\n\nWhat type of interview would you like to start?`,
    };

    // Interview mode buttons - multi-language
    const modeButtonTexts: Record<string, { mock: string; real: string }> = {
      uz: {
        mock: '🎭 Mock Intervyu',
        real: '💼 Real Intervyu',
      },
      ru: {
        mock: '🎭 Mock Интервью',
        real: '💼 Реальное Интервью',
      },
      en: {
        mock: '🎭 Mock Interview',
        real: '💼 Real Interview',
      },
    };

    const modeButtons = modeButtonTexts[lang] || modeButtonTexts['en'];
    const modeKeyboard = new InlineKeyboard()
      .text(modeButtons.mock, 'interview_mode_mock')
      .row()
      .text(modeButtons.real, 'interview_mode_real');

    await ctx.reply(modeText[lang] || modeText['en'], {
      reply_markup: modeKeyboard,
      parse_mode: 'HTML',
    });
  }

  async handleAnalyzeCv(ctx: BotContext) {
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

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    // Check if user has existing CVs
    const userCvs = await this.cvService.getUserCvs(userId, 5, 0);

    if (userCvs.length > 0) {
      // Show CV list with option to upload new
      const cvListText: Record<string, string> = {
        uz: `📄 <b>CV'lar ro'yxati</b>\n\nQuyidagi CV'lardan birini tanlang yoki yangi CV yuklang:`,
        ru: `📄 <b>Список CV</b>\n\nВыберите одно из CV ниже или загрузите новое:`,
        en: `📄 <b>CV List</b>\n\nSelect one of the CVs below or upload a new one:`,
      };

      const keyboard = new InlineKeyboard();
      userCvs.forEach((cv, index) => {
        const statusEmoji =
          cv.analysisStatus === 'completed'
            ? '✅'
            : cv.analysisStatus === 'processing'
              ? '⏳'
              : '📄';
        keyboard.text(
          `${statusEmoji} CV v${cv.version}${cv.analysisStatus === 'completed' ? ` (${cv.analysis?.atsScore || 0}%)` : ''}`,
          `cv_view_${cv.id}`,
        );
        if ((index + 1) % 2 === 0) keyboard.row();
      });
      // CV upload button - multi-language
      const uploadButtonTexts: Record<string, string> = {
        uz: '➕ Yangi CV yuklash',
        ru: '➕ Загрузить новое CV',
        en: '➕ Upload New CV',
      };
      keyboard.row().text(uploadButtonTexts[lang] || uploadButtonTexts['en'], 'cv_upload_new');

      await ctx.reply(cvListText[lang] || cvListText['en'], {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
      return;
    }

    // No CVs - ask to upload
    ctx.session.cvUploadStep = 'waiting';
    const cvText: Record<string, string> = {
      uz: `📄 <b>CV Tahlili</b>\n\nIltimos CV'ingizni PDF yoki DOCX formatida yuklang.\n\nMaksimal hajm: 5MB`,
      ru: `📄 <b>Анализ CV</b>\n\nПожалуйста, загрузите ваше CV в формате PDF или DOCX.\n\nМаксимальный размер: 5MB`,
      en: `📄 <b>CV Analysis</b>\n\nPlease upload your CV as a PDF or DOCX file.\n\nMax size: 5MB`,
    };

    await ctx.reply(cvText[lang] || cvText['en'], { parse_mode: 'HTML' });
  }

  async handleHelp(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const helpText = this.getHelpText(lang);

    const keyboard = new InlineKeyboard();
    if (user) {
      // Quick action buttons - multi-language
      const buttonTexts: Record<
        string,
        {
          profile: string;
          stats: string;
          interview: string;
          cv: string;
          live: string;
          settings: string;
          language: string;
        }
      > = {
        uz: {
          profile: '📊 Profil',
          stats: '📈 Statistika',
          interview: '🎯 Intervyu',
          cv: '📄 CV Tahlil',
          live: '🎯 Live Rejim',
          settings: '⚙️ Sozlamalar',
          language: "🌐 Tilni o'zgartirish",
        },
        ru: {
          profile: '📊 Профиль',
          stats: '📈 Статистика',
          interview: '🎯 Интервью',
          cv: '📄 Анализ CV',
          live: '🎯 Live Режим',
          settings: '⚙️ Настройки',
          language: '🌐 Изменить язык',
        },
        en: {
          profile: '📊 Profile',
          stats: '📈 Statistics',
          interview: '🎯 Interview',
          cv: '📄 CV Analysis',
          live: '🎯 Live Mode',
          settings: '⚙️ Settings',
          language: '🌐 Change language',
        },
      };

      const buttons = buttonTexts[lang] || buttonTexts['en'];
      keyboard
        .text(buttons.profile, 'profile')
        .text(buttons.stats, 'stats')
        .row()
        .text(buttons.interview, 'interview_start')
        .text(buttons.cv, 'cv_quick')
        .row()
        .text(buttons.live, 'live_quick')
        .text(buttons.settings, 'settings_quick')
        .row()
        .text(buttons.language, 'settings_language');
    } else {
      // For non-registered users, only show registration
      const registerTexts: Record<string, string> = {
        uz: "🚀 Ro'yxatdan o'tish",
        ru: '🚀 Зарегистрироваться',
        en: '🚀 Register',
      };
      keyboard.text(registerTexts[lang] || registerTexts['en'], 'register_quick');
    }

    await ctx.reply(helpText, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  private getHelpText(lang: string): string {
    const texts: Record<string, string> = {
      uz:
        `📖 <b>Mavjud Buyruqlar</b>\n\n` +
        `<code>/start</code> - Botni boshlash\n` +
        `<code>/profile</code> - Profilingizni ko'rish\n` +
        `<code>/interview</code> - Mock intervyu boshlash\n` +
        `<code>/start_live</code> - Live intervyu sessiyasini boshlash\n` +
        `<code>/end_live</code> - Live sessiyani tugatish\n` +
        `<code>/analyze_cv</code> - CV'ingizni tahlil qilish\n` +
        `<code>/stats</code> - Statistikalarni ko'rish\n` +
        `<code>/settings</code> - Sozlamalarni sozlash\n` +
        `<code>/help</code> - Yordam xabari`,

      ru:
        `📖 <b>Доступные Команды</b>\n\n` +
        `<code>/start</code> - Запустить бота\n` +
        `<code>/profile</code> - Просмотреть профиль\n` +
        `<code>/interview</code> - Начать mock интервью\n` +
        `<code>/start_live</code> - Начать live сессию интервью\n` +
        `<code>/end_live</code> - Завершить live сессию\n` +
        `<code>/analyze_cv</code> - Анализировать CV\n` +
        `<code>/stats</code> - Просмотреть статистику\n` +
        `<code>/settings</code> - Настроить параметры\n` +
        `<code>/help</code> - Показать это сообщение`,

      en:
        `📖 <b>Available Commands</b>\n\n` +
        `<code>/start</code> - Start the bot\n` +
        `<code>/profile</code> - View your profile\n` +
        `<code>/interview</code> - Start mock interview\n` +
        `<code>/start_live</code> - Start live interview session\n` +
        `<code>/end_live</code> - End live session\n` +
        `<code>/analyze_cv</code> - Analyze your CV\n` +
        `<code>/stats</code> - View statistics\n` +
        `<code>/settings</code> - Configure settings\n` +
        `<code>/help</code> - Show this help message`,
    };

    return texts[lang] || texts['en'];
  }

  async handleStats(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        const lang = ctx.session?.language || 'en';
        const notRegisteredText: Record<string, string> = {
          uz: `Iltimos avval ro'yxatdan o'ting`,
          ru: `Пожалуйста, сначала зарегистрируйтесь`,
          en: `Please register first`,
        };
        await ctx.reply(notRegisteredText[lang] || notRegisteredText['en']);
        return;
      }

      // Get user ID (handle both _id and id fields)
      const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
      if (!userId) {
        this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
        return;
      }

      // Get language from session, user preferences, or database
      let lang = ctx.session?.language;
      if (!lang) {
        lang = user.preferences?.language || user.language || 'en';
        // Save to session for future use
        if (ctx.session) {
          ctx.session.language = lang;
        }
      }

      const analytics = await this.interviewsService.getAnalytics(userId);
      const statsText = this.getStatsText(lang, analytics);

      await ctx.reply(statsText, { parse_mode: 'HTML' });
    } catch (_error) {
      const lang = ctx.session.language || 'en';
      const errorText: Record<string, string> = {
        uz: `Statistikalarni yuklashda xatolik`,
        ru: `Ошибка загрузки статистики`,
        en: `Error fetching statistics`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  private getStatsText(lang: string, analytics: any): string {
    const texts: Record<string, string> = {
      uz:
        `📊 <b>Sizning Statistikangiz</b>\n\n` +
        `<b>Jami intervyular:</b> ${analytics.totalInterviews}\n` +
        `<b>Tugallangan:</b> ${analytics.completedInterviews}\n` +
        `<b>O'rtacha ball:</b> ${analytics.averageScore}`,

      ru:
        `📊 <b>Ваша Статистика</b>\n\n` +
        `<b>Всего интервью:</b> ${analytics.totalInterviews}\n` +
        `<b>Завершено:</b> ${analytics.completedInterviews}\n` +
        `<b>Средний балл:</b> ${analytics.averageScore}`,

      en:
        `📊 <b>Your Statistics</b>\n\n` +
        `<b>Total Interviews:</b> ${analytics.totalInterviews}\n` +
        `<b>Completed:</b> ${analytics.completedInterviews}\n` +
        `<b>Average Score:</b> ${analytics.averageScore}`,
    };

    return texts[lang] || texts['en'];
  }

  async handleSettings(ctx: BotContext) {
    const lang = ctx.session.language || 'en';

    const settingsText: Record<string, string> = {
      uz: `⚙️ <b>Sozlamalar</b>\n\nNimani sozlamoqchisiz?`,
      ru: `⚙️ <b>Настройки</b>\n\nЧто вы хотите настроить?`,
      en: `⚙️ <b>Settings</b>\n\nWhat would you like to configure?`,
    };

    const keyboard = new InlineKeyboard()
      .text('🔔', 'settings_notifications')
      .text('🌐', 'settings_language');

    await ctx.reply(settingsText[lang] || settingsText['en'], {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  }

  async handleCallback(ctx: BotContext, data: string) {
    // Language selection
    if (data.startsWith('lang_')) {
      const lang = data.replace('lang_', '');
      ctx.session.language = lang;

      // Check if user exists in database
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (user) {
        // Existing user - save language to database
        try {
          // Get user ID (handle both _id and id fields)
          const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
          if (userId) {
            // Update preferences.language
            await this.usersService.updatePreferences(userId, { language: lang });
            // Also update main language field
            await this.usersService.updateLanguage(userId, lang);
          }
        } catch (error) {
          this.logger.error(`Failed to update user language: ${error.message}`);
        }

        // Show main menu immediately
        const welcomeText = this.getWelcomeText(lang);
        const mainKeyboard = this.getMainKeyboard(lang);

        const confirmText: Record<string, string> = {
          uz: `✅ <b>Til o'zgartirildi: O'zbekcha</b>`,
          ru: `✅ <b>Язык изменён: Русский</b>`,
          en: `✅ <b>Language changed: English</b>`,
        };

        await ctx.reply(confirmText[lang] || confirmText['en'], {
          reply_markup: mainKeyboard,
          parse_mode: 'HTML',
        });
        return;
      }

      // New user - show registration message with phone number button
      const regText = this.getRegistrationText(lang);
      const regKeyboard = this.getRegistrationKeyboard(lang);

      await ctx.reply(regText, {
        reply_markup: regKeyboard,
        parse_mode: 'HTML',
      });
      return;
    }

    // Settings language change
    if (data === 'settings_language') {
      const lang = ctx.session?.language || 'en';
      const languageKeyboard = new InlineKeyboard()
        .text("🇺🇿 O'zbekcha", 'lang_uz')
        .row()
        .text('🇷🇺 Русский', 'lang_ru')
        .row()
        .text('🇬🇧 English', 'lang_en');

      const selectText: Record<string, string> = {
        uz: `🌐 <b>Tilni tanlang:</b>`,
        ru: `🌐 <b>Выберите язык:</b>`,
        en: `🌐 <b>Select language:</b>`,
      };

      await ctx.reply(selectText[lang] || selectText['en'], {
        reply_markup: languageKeyboard,
        parse_mode: 'HTML',
      });
      return;
    }

    // Main menu buttons
    if (data === 'interview_start') {
      await this.handleInterview(ctx);
      return;
    }

    if (data === 'profile') {
      await this.handleProfile(ctx);
      return;
    }

    if (data === 'stats') {
      await this.handleStats(ctx);
      return;
    }

    if (data === 'help') {
      await this.handleHelp(ctx);
      return;
    }

    // Quick action callbacks from help menu
    if (data === 'cv_quick') {
      await this.handleAnalyzeCv(ctx);
      return;
    }

    if (data === 'live_quick') {
      // Delegate to live service
      const telegramId = ctx.from?.id as number;
      const isLive = await this.liveService.isInLiveSession(telegramId);
      if (isLive) {
        const lang = ctx.session?.language || 'en';
        const alreadyLiveText: Record<string, string> = {
          uz: `✅ Live rejim allaqachon faol!\n\nSavollaringizni yuboring yoki /end_live bilan to'xtating.`,
          ru: `✅ Live режим уже активен!\n\nОтправляйте вопросы или остановите с /end_live.`,
          en: `✅ Live mode is already active!\n\nSend your questions or stop with /end_live.`,
        };
        await ctx.reply(alreadyLiveText[lang] || alreadyLiveText['en'], {
          parse_mode: 'HTML',
        });
      } else {
        await this.liveService.handleStartLive(ctx);
      }
      return;
    }

    if (data === 'settings_quick') {
      await this.handleSettings(ctx);
      return;
    }

    if (data === 'register_quick') {
      await this.handleStart(ctx);
      return;
    }

    // Settings callbacks
    if (data === 'settings_notifications') {
      const lang = ctx.session?.language || 'en';
      const notifText: Record<string, string> = {
        uz: `🔔 <b>Bildirishnomalar</b>\n\nBildirishnomalar sozlamalari tez orada qo'shiladi.`,
        ru: `🔔 <b>Уведомления</b>\n\nНастройки уведомлений будут добавлены в ближайшее время.`,
        en: `🔔 <b>Notifications</b>\n\nNotification settings will be added soon.`,
      };
      await ctx.reply(notifText[lang] || notifText['en'], {
        parse_mode: 'HTML',
      });
      return;
    }

    // Interview mode selection (Mock or Real)
    if (data === 'interview_mode_mock') {
      ctx.session.interviewMode = 'mock';
      ctx.session.interviewStep = 'domain';
      await this.askInterviewDomain(ctx);
      return;
    }

    if (data === 'interview_mode_real') {
      ctx.session.interviewMode = 'real';
      ctx.session.interviewStep = 'domain';
      await this.askInterviewDomain(ctx);
      return;
    }

    // Domain selection
    if (data.startsWith('domain_')) {
      const domain = data.replace('domain_', '');
      ctx.session.interviewDomain = domain;
      ctx.session.interviewStep = 'technology';
      await this.askInterviewTechnology(ctx);
      return;
    }

    // Technology selection
    if (data.startsWith('tech_')) {
      const technology = data.replace('tech_', '');
      ctx.session.interviewTechnology = technology;
      ctx.session.interviewStep = 'position';
      await this.askInterviewPosition(ctx);
      return;
    }

    // CV management callbacks
    if (data === 'cv_upload_new') {
      ctx.session.cvUploadStep = 'waiting';
      const lang = ctx.session?.language || 'en';
      const cvText: Record<string, string> = {
        uz: `📄 <b>Yangi CV yuklash</b>\n\nIltimos CV'ingizni PDF yoki DOCX formatida yuklang.\n\nMaksimal hajm: 5MB`,
        ru: `📄 <b>Загрузить новое CV</b>\n\nПожалуйста, загрузите ваше CV в формате PDF или DOCX.\n\nМаксимальный размер: 5MB`,
        en: `📄 <b>Upload New CV</b>\n\nPlease upload your CV as a PDF or DOCX file.\n\nMax size: 5MB`,
      };
      await ctx.reply(cvText[lang] || cvText['en'], { parse_mode: 'HTML' });
      return;
    }

    if (data === 'cv_list') {
      await this.handleAnalyzeCv(ctx);
      return;
    }

    if (data.startsWith('cv_view_')) {
      const cvId = data.replace('cv_view_', '');
      await this.showCvDetails(ctx, cvId);
      return;
    }

    if (data.startsWith('cv_reanalyze_')) {
      const cvId = data.replace('cv_reanalyze_', '');
      await this.reanalyzeCv(ctx, cvId);
      return;
    }

    // Interview control callbacks
    if (data === 'interview_skip') {
      const sessionId = ctx.session.currentInterviewSessionId;
      if (sessionId) {
        const telegramId = ctx.from?.id as number;
        const user = await this.usersService.findByTelegramId(telegramId);

        if (!user) {
          return;
        }

        // Get user ID
        const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
        if (!userId) {
          return;
        }

        try {
          // Get current session to check current index
          const session = await this.interviewsService.getSession(userId, sessionId);
          const newIndex = session.currentQuestionIndex + 1;

          // Update both session state and database
          ctx.session.currentQuestionIndex = newIndex;

          // Update database session
          await this.interviewsService.updateSessionIndex(userId, sessionId, newIndex);

          await this.showCurrentQuestion(ctx, sessionId);
        } catch (error) {
          this.logger.error(`Error skipping question: ${error.message}`, error.stack);
          // Fallback: just update session state
          ctx.session.currentQuestionIndex = (ctx.session.currentQuestionIndex || 0) + 1;
          await this.showCurrentQuestion(ctx, sessionId);
        }
      }
      return;
    }

    if (data === 'interview_pause') {
      const lang = ctx.session?.language || 'en';
      const pauseText: Record<string, string> = {
        uz: `⏸️ Intervyu to'xtatildi. Davom etish uchun /interview buyrug'ini qayta yuboring.`,
        ru: `⏸️ Интервью приостановлено. Отправьте /interview для продолжения.`,
        en: `⏸️ Interview paused. Send /interview to continue.`,
      };
      await ctx.reply(pauseText[lang] || pauseText['en']);
      return;
    }

    if (data === 'interview_end') {
      const sessionId = ctx.session.currentInterviewSessionId;
      if (sessionId) {
        await this.completeInterview(ctx, sessionId);
      }
      return;
    }

    if (data === 'interview_new') {
      await this.handleInterview(ctx);
      return;
    }

    if (data.startsWith('interview_detail_')) {
      const sessionId = data.replace('interview_detail_', '');
      // TODO: Show detailed interview results
      return;
    }

    // Interview position received (from text message)
    // This will be handled in handleTextMessage
  }

  /**
   * Show CV details
   */
  private async showCvDetails(ctx: BotContext, cvId: string) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    if (!user) {
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi topilmadi.`,
        ru: `Ошибка: Пользователь не найден.`,
        en: `Error: User not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    try {
      const cv = await this.cvService.getCvById(userId, cvId);

      if (cv.analysisStatus === 'completed' && cv.analysis) {
        await this.displayCvAnalysis(ctx, cv);
      } else if (cv.analysisStatus === 'processing') {
        const processingText: Record<string, string> = {
          uz: `⏳ CV hali tahlil qilinmoqda...\n\nIltimos biroz kuting.`,
          ru: `⏳ CV еще анализируется...\n\nПожалуйста, подождите.`,
          en: `⏳ CV is still being analyzed...\n\nPlease wait.`,
        };
        await ctx.reply(processingText[lang] || processingText['en'], {
          parse_mode: 'HTML',
        });
      } else {
        const noAnalysisText: Record<string, string> = {
          uz: `📄 CV yuklangan, lekin tahlil qilinmagan.\n\nTahlil qilish uchun "Qayta tahlil qilish" tugmasini bosing.`,
          ru: `📄 CV загружено, но не проанализировано.\n\nНажмите "Переанализировать" для анализа.`,
          en: `📄 CV uploaded but not analyzed.\n\nClick "Re-analyze" to analyze.`,
        };
        const keyboard = new InlineKeyboard().text(
          '🔄 Qayta tahlil qilish',
          `cv_reanalyze_${cvId}`,
        );
        await ctx.reply(noAnalysisText[lang] || noAnalysisText['en'], {
          reply_markup: keyboard,
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      this.logger.error(`Error showing CV details: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `CV ma'lumotlarini ko'rsatishda xatolik.`,
        ru: `Ошибка при отображении информации о CV.`,
        en: `Error showing CV details.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Re-analyze CV
   */
  private async reanalyzeCv(ctx: BotContext, cvId: string) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    if (!user) {
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi topilmadi.`,
        ru: `Ошибка: Пользователь не найден.`,
        en: `Error: User not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    try {
      const processingText: Record<string, string> = {
        uz: `⏳ CV qayta tahlil qilinmoqda...\n\nBu bir necha daqiqa vaqt olishi mumkin.`,
        ru: `⏳ CV переанализируется...\n\nЭто может занять несколько минут.`,
        en: `⏳ Re-analyzing CV...\n\nThis may take a few minutes.`,
      };
      await ctx.reply(processingText[lang] || processingText['en'], {
        parse_mode: 'HTML',
      });

      // Get user language preference
      const userLanguage = user.preferences?.language || user.language || lang || 'en';

      await this.cvService.analyzeCv(userId, cvId, {
        language: userLanguage, // Pass user's language preference
      });

      // Poll for completion
      await this.pollCvAnalysis(ctx, cvId, userId);
    } catch (error) {
      this.logger.error(`Error re-analyzing CV: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `CV qayta tahlil qilishda xatolik.`,
        ru: `Ошибка при переанализе CV.`,
        en: `Error re-analyzing CV.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Handle contact message (phone number registration)
   */
  async handleContactMessage(ctx: BotContext) {
    try {
      const lang = ctx.session?.language || 'en';
      const telegramId = ctx.from?.id as number;
      const contact = ctx.message?.contact;

      if (!contact || !contact.phone_number) {
        const errorText: Record<string, string> = {
          uz: `❌ Telefon raqam topilmadi. Iltimos qayta urinib ko'ring.`,
          ru: `❌ Номер телефона не найден. Пожалуйста, попробуйте снова.`,
          en: `❌ Phone number not found. Please try again.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      // Check if user already exists
      const existingUser = await this.usersService.findByTelegramId(telegramId);
      if (existingUser) {
        const alreadyRegisteredText: Record<string, string> = {
          uz: `✅ Siz allaqachon ro'yxatdan o'tgansiz!`,
          ru: `✅ Вы уже зарегистрированы!`,
          en: `✅ You are already registered!`,
        };
        await ctx.reply(alreadyRegisteredText[lang] || alreadyRegisteredText['en']);

        // Show main menu
        const welcomeText = this.getWelcomeText(lang);
        const mainKeyboard = this.getMainKeyboard(lang);
        await ctx.reply(welcomeText, {
          reply_markup: mainKeyboard,
          parse_mode: 'HTML',
        });
        return;
      }

      // Format phone number
      const phoneNumber = this.otpService.formatPhoneNumber(contact.phone_number);

      // Check if phone number already exists
      const userByPhone = await this.usersService.findByPhoneNumber(phoneNumber);
      if (userByPhone) {
        const phoneExistsText: Record<string, string> = {
          uz: `❌ Bu telefon raqam allaqachon ro'yxatdan o'tgan. Iltimos boshqa raqam yuboring.`,
          ru: `❌ Этот номер телефона уже зарегистрирован. Пожалуйста, отправьте другой номер.`,
          en: `❌ This phone number is already registered. Please send a different number.`,
        };
        await ctx.reply(phoneExistsText[lang] || phoneExistsText['en']);
        return;
      }

      // Get user info from Telegram
      // Ensure firstName and lastName are not empty (required fields)
      const firstName = ctx.from?.first_name || contact.first_name || 'User';
      const lastName = ctx.from?.last_name || contact.last_name || firstName || 'User'; // Use firstName as fallback if lastName is empty
      const telegramUsername = ctx.from?.username;
      const telegramFirstName = ctx.from?.first_name;
      const telegramLastName = ctx.from?.last_name;

      // Create user
      const newUser = await this.usersService.create({
        phoneNumber,
        telegramId,
        telegramUsername,
        telegramFirstName,
        telegramLastName,
        firstName,
        lastName,
        language: lang,
      });

      // Mark phone as verified (contact sharing means verified)
      await this.usersService.updatePhoneVerified(newUser.id, true);

      this.logger.log(`New user registered via Telegram: ${phoneNumber} (${telegramId})`);

      // Success message
      const successText: Record<string, string> = {
        uz:
          `✅ <b>Ro'yxatdan o'tish muvaffaqiyatli!</b>\n\n` +
          `Sizning telefon raqamingiz: <code>${phoneNumber}</code>\n\n` +
          `Endi InterviewAI Pro'dan to'liq foydalanishingiz mumkin!`,
        ru:
          `✅ <b>Регистрация успешна!</b>\n\n` +
          `Ваш номер телефона: <code>${phoneNumber}</code>\n\n` +
          `Теперь вы можете полноценно использовать InterviewAI Pro!`,
        en:
          `✅ <b>Registration successful!</b>\n\n` +
          `Your phone number: <code>${phoneNumber}</code>\n\n` +
          `You can now fully use InterviewAI Pro!`,
      };

      await ctx.reply(successText[lang] || successText['en'], { parse_mode: 'HTML' });

      // Show main menu
      const welcomeText = this.getWelcomeText(lang);
      const mainKeyboard = this.getMainKeyboard(lang);
      await ctx.reply(welcomeText, {
        reply_markup: mainKeyboard,
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Error handling contact message: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: `❌ Ro'yxatdan o'tishda xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `❌ Произошла ошибка при регистрации. Пожалуйста, попробуйте снова.`,
        en: `❌ An error occurred during registration. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Ask for interview domain (soha)
   */
  private async askInterviewDomain(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const domainText: Record<string, string> = {
      uz: `🎯 <b>Soha tanlang</b>\n\nQaysi soha bo'yicha intervyu o'tkazmoqchisiz?`,
      ru: `🎯 <b>Выберите область</b>\n\nВ какой области вы проходите интервью?`,
      en: `🎯 <b>Select Domain</b>\n\nWhat domain are you interviewing for?`,
    };

    // Domain buttons - multi-language
    const domainButtonTexts: Record<string, Record<string, string>> = {
      uz: {
        frontend: '🌐 Frontend',
        backend: '⚙️ Backend',
        fullstack: '🔄 Full Stack',
        mobile: '📱 Mobile',
        devops: '☁️ DevOps',
        ai: '🤖 AI/ML',
        data: '💾 Data Science',
        security: '🔒 Cybersecurity',
      },
      ru: {
        frontend: '🌐 Frontend',
        backend: '⚙️ Backend',
        fullstack: '🔄 Full Stack',
        mobile: '📱 Mobile',
        devops: '☁️ DevOps',
        ai: '🤖 AI/ML',
        data: '💾 Data Science',
        security: '🔒 Кибербезопасность',
      },
      en: {
        frontend: '🌐 Frontend',
        backend: '⚙️ Backend',
        fullstack: '🔄 Full Stack',
        mobile: '📱 Mobile',
        devops: '☁️ DevOps',
        ai: '🤖 AI/ML',
        data: '💾 Data Science',
        security: '🔒 Cybersecurity',
      },
    };

    const domainButtons = domainButtonTexts[lang] || domainButtonTexts['en'];
    const domainKeyboard = new InlineKeyboard()
      .text(domainButtons.frontend, 'domain_frontend')
      .text(domainButtons.backend, 'domain_backend')
      .row()
      .text(domainButtons.fullstack, 'domain_fullstack')
      .text(domainButtons.mobile, 'domain_mobile')
      .row()
      .text(domainButtons.devops, 'domain_devops')
      .text(domainButtons.ai, 'domain_ai')
      .row()
      .text(domainButtons.data, 'domain_data')
      .text(domainButtons.security, 'domain_security');

    await ctx.reply(domainText[lang] || domainText['en'], {
      reply_markup: domainKeyboard,
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for interview technology
   */
  private async askInterviewTechnology(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const domain = ctx.session.interviewDomain;

    const techText: Record<string, string> = {
      uz: `⚙️ <b>Texnologiya tanlang</b>\n\nQaysi texnologiya bo'yicha intervyu o'tkazmoqchisiz?`,
      ru: `⚙️ <b>Выберите технологию</b>\n\nПо какой технологии вы проходите интервью?`,
      en: `⚙️ <b>Select Technology</b>\n\nWhat technology are you interviewing for?`,
    };

    // Technology options based on domain
    let techKeyboard = new InlineKeyboard();

    if (domain === 'frontend') {
      techKeyboard
        .text('⚛️ React', 'tech_react')
        .text('🅰️ Angular', 'tech_angular')
        .row()
        .text('🟢 Vue.js', 'tech_vue')
        .text('📘 TypeScript', 'tech_typescript')
        .row()
        .text('🎨 Next.js', 'tech_nextjs')
        .text('⚡ Svelte', 'tech_svelte');
    } else if (domain === 'backend') {
      techKeyboard
        .text('🟢 Node.js', 'tech_nodejs')
        .text('🐍 Python', 'tech_python')
        .row()
        .text('☕ Java', 'tech_java')
        .text('🔷 C#', 'tech_csharp')
        .row()
        .text('🦀 Rust', 'tech_rust')
        .text('🐹 Go', 'tech_go')
        .row()
        .text('🐘 PHP', 'tech_php')
        .text('💎 Ruby', 'tech_ruby');
    } else if (domain === 'fullstack') {
      techKeyboard
        .text('⚛️ React + Node.js', 'tech_react_node')
        .text('🅰️ Angular + .NET', 'tech_angular_dotnet')
        .row()
        .text('🟢 Vue + Python', 'tech_vue_python')
        .text('📘 Next.js Full Stack', 'tech_nextjs_full')
        .row()
        .text('☕ Java Spring', 'tech_java_spring')
        .text('🐍 Django + React', 'tech_django_react');
    } else if (domain === 'mobile') {
      techKeyboard
        .text('📱 React Native', 'tech_reactnative')
        .text('🍎 iOS (Swift)', 'tech_ios')
        .row()
        .text('🤖 Android (Kotlin)', 'tech_android')
        .text('⚡ Flutter', 'tech_flutter')
        .row()
        .text('💜 Xamarin', 'tech_xamarin')
        .text('📘 Ionic', 'tech_ionic');
    } else if (domain === 'devops') {
      techKeyboard
        .text('🐳 Docker', 'tech_docker')
        .text('☸️ Kubernetes', 'tech_kubernetes')
        .row()
        .text('☁️ AWS', 'tech_aws')
        .text('☁️ Azure', 'tech_azure')
        .row()
        .text('🐧 Linux', 'tech_linux')
        .text('🔧 CI/CD', 'tech_cicd');
    } else if (domain === 'ai') {
      techKeyboard
        .text('🧠 Machine Learning', 'tech_ml')
        .text('🤖 Deep Learning', 'tech_deeplearning')
        .row()
        .text('📊 TensorFlow', 'tech_tensorflow')
        .text('🔥 PyTorch', 'tech_pytorch')
        .row()
        .text('💬 NLP', 'tech_nlp')
        .text('👁️ Computer Vision', 'tech_cv');
    } else if (domain === 'data') {
      techKeyboard
        .text('🐼 Python (Pandas)', 'tech_pandas')
        .text('☕ Apache Spark', 'tech_spark')
        .row()
        .text('📊 SQL', 'tech_sql')
        .text('🔷 R', 'tech_r')
        .row()
        .text('📈 Tableau', 'tech_tableau')
        .text('💾 Hadoop', 'tech_hadoop');
    } else if (domain === 'security') {
      techKeyboard
        .text('🔒 Penetration Testing', 'tech_pentest')
        .text('🛡️ Network Security', 'tech_network')
        .row()
        .text('🔐 Cryptography', 'tech_crypto')
        .text('🕵️ Ethical Hacking', 'tech_hacking')
        .row()
        .text('🛠️ Security Tools', 'tech_tools')
        .text('📋 Compliance', 'tech_compliance');
    } else {
      // Default technologies
      techKeyboard
        .text('⚛️ React', 'tech_react')
        .text('🟢 Node.js', 'tech_nodejs')
        .row()
        .text('🐍 Python', 'tech_python')
        .text('☕ Java', 'tech_java')
        .row()
        .text('📘 TypeScript', 'tech_typescript')
        .text('🔷 C#', 'tech_csharp');
    }

    await ctx.reply(techText[lang] || techText['en'], {
      reply_markup: techKeyboard,
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for interview position
   */
  private async askInterviewPosition(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const positionText: Record<string, string> = {
      uz: `💼 <b>Pozitsiya</b>\n\nQaysi pozitsiya bo'yicha intervyu o'tkazmoqchisiz?\n\nMasalan: Junior Developer, Middle Developer, Senior Developer, Team Lead, va hokazo.\n\nYoki o'zingizning pozitsiyangizni yozing.`,
      ru: `💼 <b>Позиция</b>\n\nНа какую позицию вы проходите интервью?\n\nНапример: Junior Developer, Middle Developer, Senior Developer, Team Lead и т.д.\n\nИли напишите свою позицию.`,
      en: `💼 <b>Position</b>\n\nWhat position are you interviewing for?\n\nFor example: Junior Developer, Middle Developer, Senior Developer, Team Lead, etc.\n\nOr type your position.`,
    };

    await ctx.reply(positionText[lang] || positionText['en'], {
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for company (for real interviews)
   */
  private async askInterviewCompany(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const companyText: Record<string, string> = {
      uz: `🏢 <b>Kompaniya</b>\n\nQaysi kompaniyaga intervyu bermoqchisiz?\n\nKompaniya nomini yuboring.`,
      ru: `🏢 <b>Компания</b>\n\nВ какую компанию вы проходите интервью?\n\nОтправьте название компании.`,
      en: `🏢 <b>Company</b>\n\nWhich company are you interviewing with?\n\nPlease send the company name.`,
    };

    await ctx.reply(companyText[lang] || companyText['en'], {
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for CV (for real interviews)
   */
  private async askInterviewCv(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const cvText: Record<string, string> = {
      uz: `📄 <b>CV yuklash</b>\n\nIltimos, CV'ingizni PDF yoki DOCX formatida yuklang.\n\nBu CV intervyu uchun kontekst sifatida ishlatiladi.`,
      ru: `📄 <b>Загрузка CV</b>\n\nПожалуйста, загрузите ваше CV в формате PDF или DOCX.\n\nЭто CV будет использоваться как контекст для интервью.`,
      en: `📄 <b>Upload CV</b>\n\nPlease upload your CV in PDF or DOCX format.\n\nThis CV will be used as context for the interview.`,
    };

    await ctx.reply(cvText[lang] || cvText['en'], {
      parse_mode: 'HTML',
    });
  }

  /**
   * Handle text messages during interview flow
   */
  async handleInterviewText(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const text = ctx.message?.text?.trim();

    if (!text) {
      const emptyText: Record<string, string> = {
        uz: `Iltimos matn yuboring.`,
        ru: `Пожалуйста, отправьте текст.`,
        en: `Please send text.`,
      };
      await ctx.reply(emptyText[lang] || emptyText['en']);
      return;
    }

    const step = ctx.session.interviewStep;

    if (step === 'position') {
      // Save position and move to next step
      ctx.session.interviewPosition = text;

      if (ctx.session.interviewMode === 'real') {
        // Real interview: ask for company
        ctx.session.interviewStep = 'company';
        await this.askInterviewCompany(ctx);
      } else {
        // Mock interview: ready to start
        ctx.session.interviewStep = 'ready';
        await this.startInterviewSession(ctx);
      }
      return;
    }

    // If user sends text during domain/technology selection, show error
    if (step === 'domain' || step === 'technology') {
      const wrongInputText: Record<string, string> = {
        uz: `Iltimos, tugmalardan birini tanlang.`,
        ru: `Пожалуйста, выберите одну из кнопок.`,
        en: `Please select one of the buttons.`,
      };
      await ctx.reply(wrongInputText[lang] || wrongInputText['en']);
      return;
    }

    if (step === 'company') {
      // Save company and move to CV step
      ctx.session.interviewCompany = text;
      ctx.session.interviewStep = 'cv';
      await this.askInterviewCv(ctx);
      return;
    }

    // Check if there's an active interview session (answering questions)
    const sessionId = ctx.session.currentInterviewSessionId;
    if (sessionId && ctx.session.currentQuestionIndex !== undefined) {
      await this.handleInterviewAnswer(ctx, text);
      return;
    }

    // Other steps handled separately
    const unknownText: Record<string, string> = {
      uz: `Iltimos kutilayotgan ma'lumotni yuboring.`,
      ru: `Пожалуйста, отправьте ожидаемую информацию.`,
      en: `Please send the expected information.`,
    };
    await ctx.reply(unknownText[lang] || unknownText['en']);
  }

  /**
   * Start interview session
   */
  private async startInterviewSession(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    if (!user) {
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi topilmadi.`,
        ru: `Ошибка: Пользователь не найден.`,
        en: `Error: User not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi ID topilmadi.`,
        ru: `Ошибка: ID пользователя не найден.`,
        en: `Error: User ID not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    try {
      const mode = ctx.session.interviewMode;
      const domain = ctx.session.interviewDomain;
      const technology = ctx.session.interviewTechnology;
      const position = ctx.session.interviewPosition;

      if (mode === 'mock') {
        // Map position to difficulty
        if (!position) {
          throw new Error('Position is required');
        }
        const difficulty = this.mapPositionToDifficulty(position);

        // Map domain/technology to interview type (default to technical)
        const interviewType = 'technical'; // Can be enhanced to detect behavioral/case_study

        // Create interview DTO
        const interviewDto = {
          type: interviewType,
          difficulty,
          domain: domain?.toLowerCase(),
          technology: technology ? [technology.toLowerCase()] : [],
          numQuestions: 10, // Default 10 questions
          mode: 'text' as const, // Default to text mode for Telegram
          timeLimit: 5, // 5 minutes per question
          language: lang, // Pass user's language preference
        };

        // Start interview session
        const session = await this.interviewsService.startInterview(userId, interviewDto);

        // Store session ID
        ctx.session.currentInterviewSessionId = session.id;
        ctx.session.currentQuestionIndex = 0;
        ctx.session.interviewStep = undefined;

        // Show start message
        const startText: Record<string, string> = {
          uz:
            `🎭 <b>Mock Intervyu boshlanmoqda...</b>\n\n` +
            `Soha: <b>${domain}</b>\n` +
            `Texnologiya: <b>${technology}</b>\n` +
            `Pozitsiya: <b>${position}</b>\n` +
            `Savollar soni: <b>${session.numQuestions}</b>\n\n` +
            `Birinchi savolga o'tamiz...`,
          ru:
            `🎭 <b>Начинается Mock интервью...</b>\n\n` +
            `Область: <b>${domain}</b>\n` +
            `Технология: <b>${technology}</b>\n` +
            `Позиция: <b>${position}</b>\n` +
            `Количество вопросов: <b>${session.numQuestions}</b>\n\n` +
            `Переходим к первому вопросу...`,
          en:
            `🎭 <b>Starting Mock Interview...</b>\n\n` +
            `Domain: <b>${domain}</b>\n` +
            `Technology: <b>${technology}</b>\n` +
            `Position: <b>${position}</b>\n` +
            `Number of questions: <b>${session.numQuestions}</b>\n\n` +
            `Moving to the first question...`,
        };

        await ctx.reply(startText[lang] || startText['en'], {
          parse_mode: 'HTML',
        });

        // Show first question
        await this.showCurrentQuestion(ctx, session.id);
      } else if (mode === 'real') {
        // Real interview - check if CV is uploaded
        if (!ctx.session.interviewCvId) {
          const cvNeededText: Record<string, string> = {
            uz: `Iltimos CV'ingizni yuklang.`,
            ru: `Пожалуйста, загрузите ваше CV.`,
            en: `Please upload your CV.`,
          };
          await ctx.reply(cvNeededText[lang] || cvNeededText['en']);
          return;
        }

        // Map position to difficulty
        if (!position) {
          throw new Error('Position is required');
        }
        const difficulty = this.mapPositionToDifficulty(position);

        // For real interviews, use mixed type to cover all aspects
        const interviewType = 'mixed';

        // Create interview DTO
        const interviewDto = {
          type: interviewType,
          difficulty,
          domain: domain?.toLowerCase(),
          technology: technology ? [technology.toLowerCase()] : [],
          numQuestions: 10, // Default 10 questions
          mode: 'text' as const,
          timeLimit: 5,
          language: lang, // Pass user's language preference
        };

        // Start interview session
        const session = await this.interviewsService.startInterview(userId, interviewDto);

        // Store session ID
        ctx.session.currentInterviewSessionId = session.id;
        ctx.session.currentQuestionIndex = 0;
        ctx.session.interviewStep = undefined;

        // Show start message
        const startText: Record<string, string> = {
          uz:
            `💼 <b>Real Intervyu boshlanmoqda...</b>\n\n` +
            `Soha: <b>${domain}</b>\n` +
            `Texnologiya: <b>${technology}</b>\n` +
            `Pozitsiya: <b>${position}</b>\n` +
            `Kompaniya: <b>${ctx.session.interviewCompany}</b>\n` +
            `Savollar soni: <b>${session.numQuestions}</b>\n\n` +
            `Birinchi savolga o'tamiz...`,
          ru:
            `💼 <b>Начинается Real интервью...</b>\n\n` +
            `Область: <b>${domain}</b>\n` +
            `Технология: <b>${technology}</b>\n` +
            `Позиция: <b>${position}</b>\n` +
            `Компания: <b>${ctx.session.interviewCompany}</b>\n` +
            `Количество вопросов: <b>${session.numQuestions}</b>\n\n` +
            `Переходим к первому вопросу...`,
          en:
            `💼 <b>Starting Real Interview...</b>\n\n` +
            `Domain: <b>${domain}</b>\n` +
            `Technology: <b>${technology}</b>\n` +
            `Position: <b>${position}</b>\n` +
            `Company: <b>${ctx.session.interviewCompany}</b>\n` +
            `Number of questions: <b>${session.numQuestions}</b>\n\n` +
            `Moving to the first question...`,
        };

        await ctx.reply(startText[lang] || startText['en'], {
          parse_mode: 'HTML',
        });

        // Show first question
        await this.showCurrentQuestion(ctx, session.id);
      }
    } catch (error) {
      this.logger.error(`Error starting interview: ${error.message}`, error.stack);

      // Handle specific error types
      if (error instanceof ForbiddenException) {
        // Usage limit reached
        const limitText: Record<string, string> = {
          uz:
            `⚠️ <b>Limitga yetildi</b>\n\n` +
            `Sizning bepul rejangizda mock intervyu limitiga yetdingiz.\n\n` +
            `Ko'proq intervyu o'tkazish uchun rejangizni yangilang:\n` +
            `• Pro reja - cheksiz intervyular\n` +
            `• Elite reja - barcha funksiyalar\n\n` +
            `Rejani yangilash uchun /settings buyrug'ini yuboring.`,
          ru:
            `⚠️ <b>Достигнут лимит</b>\n\n` +
            `Вы достигли лимита mock интервью на бесплатном тарифе.\n\n` +
            `Чтобы проводить больше интервью, обновите тариф:\n` +
            `• Pro тариф - неограниченные интервью\n` +
            `• Elite тариф - все функции\n\n` +
            `Для обновления тарифа отправьте /settings.`,
          en:
            `⚠️ <b>Limit Reached</b>\n\n` +
            `You've reached the mock interview limit on your free plan.\n\n` +
            `To practice more interviews, upgrade your plan:\n` +
            `• Pro plan - unlimited interviews\n` +
            `• Elite plan - all features\n\n` +
            `Send /settings to upgrade your plan.`,
        };
        await ctx.reply(limitText[lang] || limitText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // Check for OpenAI API quota/rate limit errors
      // Check both error message and if it's a BadRequestException with quota-related message
      const errorMessage = error.message || '';
      const isQuotaError =
        errorMessage.includes('quota') ||
        errorMessage.includes('exceeded') ||
        errorMessage.includes('429') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('OpenAI API quota') ||
        errorMessage.includes('quota limit reached');

      if (isQuotaError) {
        const quotaText: Record<string, string> = {
          uz:
            `⚠️ <b>AI xizmati limitga yetdi</b>\n\n` +
            `OpenAI API limitiga yetib kelindi. Bu vaqtda savollar yaratib bo'lmaydi.\n\n` +
            `Iltimos:\n` +
            `• Bir necha daqiqa kutib, qayta urinib ko'ring\n` +
            `• Yoki OpenAI hisobingizni tekshiring\n` +
            `• Admin bilan bog'laning\n\n` +
            `Kechirasiz, qulaylik yaratganimiz uchun.`,
          ru:
            `⚠️ <b>Достигнут лимит AI сервиса</b>\n\n` +
            `Достигнут лимит OpenAI API. В данный момент невозможно создать вопросы.\n\n` +
            `Пожалуйста:\n` +
            `• Подождите несколько минут и попробуйте снова\n` +
            `• Или проверьте ваш аккаунт OpenAI\n` +
            `• Свяжитесь с администратором\n\n` +
            `Извините за неудобства.`,
          en:
            `⚠️ <b>AI Service Limit Reached</b>\n\n` +
            `OpenAI API quota limit has been reached. Cannot generate questions at this time.\n\n` +
            `Please:\n` +
            `• Wait a few minutes and try again\n` +
            `• Or check your OpenAI account billing\n` +
            `• Contact administrator\n\n` +
            `Sorry for the inconvenience.`,
        };
        await ctx.reply(quotaText[lang] || quotaText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // Generic error
      const errorText: Record<string, string> = {
        uz: `❌ <b>Intervyu boshlashda xatolik yuz berdi</b>\n\nIltimos qayta urinib ko'ring.`,
        ru: `❌ <b>Произошла ошибка при запуске интервью</b>\n\nПожалуйста, попробуйте снова.`,
        en: `❌ <b>Error starting interview</b>\n\nPlease try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en'], {
        parse_mode: 'HTML',
      });
    }
  }

  /**
   * Handle document messages (CV upload for analysis or real interviews)
   */
  async handleDocumentMessage(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    const cvUploadStep = ctx.session.cvUploadStep;
    const interviewStep = ctx.session.interviewStep;

    // Check if this is CV analysis upload
    if (cvUploadStep === 'waiting') {
      await this.handleCvUploadForAnalysis(ctx);
      return;
    }

    // Check if this is interview CV upload
    if (interviewStep === 'cv') {
      await this.handleCvUploadForInterview(ctx);
      return;
    }

    // Unknown document upload
    const wrongStepText: Record<string, string> = {
      uz: `Iltimos, CV yuklash bosqichida fayl yuboring.`,
      ru: `Пожалуйста, отправьте файл на этапе загрузки CV.`,
      en: `Please send file during CV upload step.`,
    };
    await ctx.reply(wrongStepText[lang] || wrongStepText['en']);
  }

  /**
   * Handle CV upload for analysis
   */
  private async handleCvUploadForAnalysis(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const document = ctx.message?.document;

    if (!document) {
      const noDocText: Record<string, string> = {
        uz: `Fayl topilmadi. Iltimos qayta urinib ko'ring.`,
        ru: `Файл не найден. Пожалуйста, попробуйте снова.`,
        en: `File not found. Please try again.`,
      };
      await ctx.reply(noDocText[lang] || noDocText['en']);
      return;
    }

    // Check file type (PDF or DOCX)
    const fileExtension = document.file_name?.split('.').pop()?.toLowerCase();
    if (!fileExtension || !['pdf', 'docx', 'doc'].includes(fileExtension)) {
      const wrongFormatText: Record<string, string> = {
        uz: `❌ Noto'g'ri format!\n\nIltimos PDF yoki DOCX formatida fayl yuboring.`,
        ru: `❌ Неверный формат!\n\nПожалуйста, отправьте файл в формате PDF или DOCX.`,
        en: `❌ Wrong format!\n\nPlease send a file in PDF or DOCX format.`,
      };
      await ctx.reply(wrongFormatText[lang] || wrongFormatText['en'], {
        parse_mode: 'HTML',
      });
      return;
    }

    // Check file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (document.file_size && document.file_size > maxSize) {
      const sizeErrorText: Record<string, string> = {
        uz: `❌ Fayl hajmi juda katta!\n\nMaksimal hajm: 5MB\nSizning faylingiz: ${(document.file_size / 1024 / 1024).toFixed(2)}MB`,
        ru: `❌ Файл слишком большой!\n\nМаксимальный размер: 5MB\nВаш файл: ${(document.file_size / 1024 / 1024).toFixed(2)}MB`,
        en: `❌ File too large!\n\nMax size: 5MB\nYour file: ${(document.file_size / 1024 / 1024).toFixed(2)}MB`,
      };
      await ctx.reply(sizeErrorText[lang] || sizeErrorText['en'], {
        parse_mode: 'HTML',
      });
      return;
    }

    if (!user) {
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi topilmadi.`,
        ru: `Ошибка: Пользователь не найден.`,
        en: `Error: User not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    try {
      // Show processing message
      const processingText: Record<string, string> = {
        uz: `⏳ CV yuklanmoqda va tahlil qilinmoqda...\n\nBu bir necha daqiqa vaqt olishi mumkin.`,
        ru: `⏳ CV загружается и анализируется...\n\nЭто может занять несколько минут.`,
        en: `⏳ Uploading and analyzing CV...\n\nThis may take a few minutes.`,
      };
      await ctx.reply(processingText[lang] || processingText['en'], {
        parse_mode: 'HTML',
      });

      ctx.session.cvUploadStep = 'analyzing';

      // Download file from Telegram
      const file = await ctx.api.getFile(document.file_id);
      const filePath = file.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${filePath}`;

      // Download file
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('Failed to download file from Telegram');
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine MIME type
      const mimeTypes: Record<string, string> = {
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
      };
      const mimeType = mimeTypes[fileExtension] || 'application/octet-stream';

      // Create Express.Multer.File-like object
      const multerFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: document.file_name || `cv.${fileExtension}`,
        encoding: '7bit',
        mimetype: mimeType,
        size: buffer.length,
        buffer: buffer,
        destination: '',
        filename: document.file_name || `cv.${fileExtension}`,
        path: '',
      } as Express.Multer.File;

      // Upload CV
      const cv = await this.cvService.uploadCv(userId, multerFile, {});

      ctx.session.currentCvId = cv.id;
      ctx.session.cvUploadStep = 'complete';

      // Show success and start polling for analysis
      const successText: Record<string, string> = {
        uz: `✅ <b>CV yuklandi!</b>\n\nCV muvaffaqiyatli yuklandi va tahlil qilish boshlandi.\n\nTahlil natijalari tez orada tayyor bo'ladi...`,
        ru: `✅ <b>CV загружено!</b>\n\nCV успешно загружено и анализ начат.\n\nРезультаты анализа будут готовы в ближайшее время...`,
        en: `✅ <b>CV uploaded!</b>\n\nCV uploaded successfully and analysis started.\n\nAnalysis results will be ready shortly...`,
      };

      await ctx.reply(successText[lang] || successText['en'], {
        parse_mode: 'HTML',
      });

      // Poll for analysis completion
      await this.pollCvAnalysis(ctx, cv.id, userId);
    } catch (error) {
      this.logger.error(`Error handling CV upload: ${error.message}`, error.stack);
      ctx.session.cvUploadStep = undefined;
      const errorText: Record<string, string> = {
        uz: `CV yuklashda xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `Произошла ошибка при загрузке CV. Пожалуйста, попробуйте снова.`,
        en: `An error occurred while uploading CV. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Handle CV upload for interview (real interview flow)
   */
  private async handleCvUploadForInterview(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const document = ctx.message?.document;

    if (!document) {
      const noDocText: Record<string, string> = {
        uz: `Fayl topilmadi. Iltimos qayta urinib ko'ring.`,
        ru: `Файл не найден. Пожалуйста, попробуйте снова.`,
        en: `File not found. Please try again.`,
      };
      await ctx.reply(noDocText[lang] || noDocText['en']);
      return;
    }

    // Check file type (PDF or DOCX)
    const fileExtension = document.file_name?.split('.').pop()?.toLowerCase();
    if (!fileExtension || !['pdf', 'docx', 'doc'].includes(fileExtension)) {
      const wrongFormatText: Record<string, string> = {
        uz: `❌ Noto'g'ri format!\n\nIltimos PDF yoki DOCX formatida fayl yuboring.`,
        ru: `❌ Неверный формат!\n\nПожалуйста, отправьте файл в формате PDF или DOCX.`,
        en: `❌ Wrong format!\n\nPlease send a file in PDF or DOCX format.`,
      };
      await ctx.reply(wrongFormatText[lang] || wrongFormatText['en'], {
        parse_mode: 'HTML',
      });
      return;
    }

    if (!user) {
      const errorText: Record<string, string> = {
        uz: `Xatolik: Foydalanuvchi topilmadi.`,
        ru: `Ошибка: Пользователь не найден.`,
        en: `Error: User not found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    try {
      // Download file from Telegram
      const file = await ctx.api.getFile(document.file_id);
      const filePath = file.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.configService.get<string>('TELEGRAM_BOT_TOKEN')}/${filePath}`;

      // Download file
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('Failed to download file from Telegram');
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine MIME type
      const mimeTypes: Record<string, string> = {
        pdf: 'application/pdf',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
      };
      const mimeType = mimeTypes[fileExtension] || 'application/octet-stream';

      // Create Express.Multer.File-like object
      const multerFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: document.file_name || `cv.${fileExtension}`,
        encoding: '7bit',
        mimetype: mimeType,
        size: buffer.length,
        buffer: buffer,
        destination: '',
        filename: document.file_name || `cv.${fileExtension}`,
        path: '',
      } as Express.Multer.File;

      // Upload CV
      const cv = await this.cvService.uploadCv(userId, multerFile, {
        jobDescription: `Position: ${ctx.session.interviewPosition}, Company: ${ctx.session.interviewCompany}`,
      });

      ctx.session.interviewCvId = cv.id;
      ctx.session.interviewStep = 'ready';

      const successText: Record<string, string> = {
        uz: `✅ <b>CV yuklandi!</b>\n\nCV muvaffaqiyatli yuklandi. Intervyu boshlanmoqda...`,
        ru: `✅ <b>CV загружено!</b>\n\nCV успешно загружено. Интервью начинается...`,
        en: `✅ <b>CV uploaded!</b>\n\nCV uploaded successfully. Starting interview...`,
      };

      await ctx.reply(successText[lang] || successText['en'], {
        parse_mode: 'HTML',
      });

      // Start interview
      await this.startInterviewSession(ctx);
    } catch (error) {
      this.logger.error(`Error handling document: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `CV yuklashda xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `Произошла ошибка при загрузке CV. Пожалуйста, попробуйте снова.`,
        en: `An error occurred while uploading CV. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Poll for CV analysis completion
   */
  private async pollCvAnalysis(ctx: BotContext, cvId: string, userId: string, attempts = 0) {
    const maxAttempts = 30; // 30 attempts = ~2.5 minutes (5 second intervals)

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
        // Save to session for future use
        if (ctx.session) {
          ctx.session.language = lang;
        }
      } else {
        lang = 'en';
      }
    }

    try {
      const cv = await this.cvService.getCvById(userId, cvId);

      if (cv.analysisStatus === 'completed' && cv.analysis) {
        // Analysis complete - show results
        await this.displayCvAnalysis(ctx, cv);
        ctx.session.cvUploadStep = undefined;
        return;
      }

      if (cv.analysisStatus === 'failed') {
        const errorText: Record<string, string> = {
          uz: `❌ CV tahlili muvaffaqiyatsiz bo'ldi.\n\nIltimos qayta urinib ko'ring yoki boshqa CV yuklang.`,
          ru: `❌ Анализ CV не удался.\n\nПожалуйста, попробуйте снова или загрузите другое CV.`,
          en: `❌ CV analysis failed.\n\nPlease try again or upload a different CV.`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        ctx.session.cvUploadStep = undefined;
        return;
      }

      // Still processing - poll again
      if (attempts < maxAttempts) {
        setTimeout(() => {
          this.pollCvAnalysis(ctx, cvId, userId, attempts + 1);
        }, 5000); // Poll every 5 seconds
      } else {
        // Timeout
        const timeoutText: Record<string, string> = {
          uz: `⏱️ Tahlil vaqti uzaydi. Iltimos keyinroq /analyze_cv buyrug'ini qayta yuboring.`,
          ru: `⏱️ Анализ занимает больше времени. Пожалуйста, отправьте /analyze_cv позже.`,
          en: `⏱️ Analysis is taking longer. Please send /analyze_cv again later.`,
        };
        await ctx.reply(timeoutText[lang] || timeoutText['en'], {
          parse_mode: 'HTML',
        });
        ctx.session.cvUploadStep = undefined;
      }
    } catch (error) {
      this.logger.error(`Error polling CV analysis: ${error.message}`, error.stack);
      ctx.session.cvUploadStep = undefined;
    }
  }

  /**
   * Display CV analysis results
   */
  private async displayCvAnalysis(ctx: BotContext, cv: any) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const analysis = cv.analysis;

    if (!analysis) {
      const noAnalysisText: Record<string, string> = {
        uz: `Tahlil natijalari hali tayyor emas.`,
        ru: `Результаты анализа еще не готовы.`,
        en: `Analysis results are not ready yet.`,
      };
      await ctx.reply(noAnalysisText[lang] || noAnalysisText['en']);
      return;
    }

    // Format analysis results
    const analysisText: Record<string, string> = {
      uz:
        `📊 <b>CV Tahlil Natijalari</b>\n\n` +
        `📈 <b>ATS Balli:</b> ${analysis.atsScore}%\n` +
        `⭐ <b>Umumiy Reyting:</b> ${analysis.overallRating}/10\n\n` +
        `✅ <b>Kuchli tomonlar:</b>\n${analysis.strengths.map((s: string) => `• ${s}`).join('\n')}\n\n` +
        `⚠️ <b>Zaif tomonlar:</b>\n${analysis.weaknesses.map((w: string) => `• ${w}`).join('\n')}\n\n` +
        `💡 <b>Tavsiyalar:</b>\n${analysis.suggestions
          .slice(0, 5)
          .map((s: any) => `• ${s.message}`)
          .join('\n')}`,
      ru:
        `📊 <b>Результаты анализа CV</b>\n\n` +
        `📈 <b>ATS Балл:</b> ${analysis.atsScore}%\n` +
        `⭐ <b>Общий Рейтинг:</b> ${analysis.overallRating}/10\n\n` +
        `✅ <b>Сильные стороны:</b>\n${analysis.strengths.map((s: string) => `• ${s}`).join('\n')}\n\n` +
        `⚠️ <b>Слабые стороны:</b>\n${analysis.weaknesses.map((w: string) => `• ${w}`).join('\n')}\n\n` +
        `💡 <b>Рекомендации:</b>\n${analysis.suggestions
          .slice(0, 5)
          .map((s: any) => `• ${s.message}`)
          .join('\n')}`,
      en:
        `📊 <b>CV Analysis Results</b>\n\n` +
        `📈 <b>ATS Score:</b> ${analysis.atsScore}%\n` +
        `⭐ <b>Overall Rating:</b> ${analysis.overallRating}/10\n\n` +
        `✅ <b>Strengths:</b>\n${analysis.strengths.map((s: string) => `• ${s}`).join('\n')}\n\n` +
        `⚠️ <b>Weaknesses:</b>\n${analysis.weaknesses.map((w: string) => `• ${w}`).join('\n')}\n\n` +
        `💡 <b>Suggestions:</b>\n${analysis.suggestions
          .slice(0, 5)
          .map((s: any) => `• ${s.message}`)
          .join('\n')}`,
    };

    // CV analysis buttons - multi-language
    const cvButtonTexts: Record<string, { details: string; reanalyze: string; all: string }> = {
      uz: {
        details: '📄 Batafsil',
        reanalyze: '🔄 Qayta tahlil qilish',
        all: "📋 Barcha CV'lar",
      },
      ru: {
        details: '📄 Подробнее',
        reanalyze: '🔄 Переанализировать',
        all: '📋 Все CV',
      },
      en: {
        details: '📄 Details',
        reanalyze: '🔄 Re-analyze',
        all: '📋 All CVs',
      },
    };

    const cvButtons = cvButtonTexts[lang] || cvButtonTexts['en'];
    const keyboard = new InlineKeyboard()
      .text(cvButtons.details, `cv_detail_${cv.id}`)
      .row()
      .text(cvButtons.reanalyze, `cv_reanalyze_${cv.id}`)
      .text(cvButtons.all, 'cv_list');

    await ctx.reply(analysisText[lang] || analysisText['en'], {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  }

  /**
   * Map position to interview difficulty
   */
  private mapPositionToDifficulty(position: string): 'junior' | 'mid' | 'senior' {
    const posLower = position.toLowerCase();
    if (
      posLower.includes('senior') ||
      posLower.includes('lead') ||
      posLower.includes('principal')
    ) {
      return 'senior';
    }
    if (posLower.includes('junior') || posLower.includes('entry') || posLower.includes('intern')) {
      return 'junior';
    }
    return 'mid'; // Default to mid-level
  }

  /**
   * Show current question to user
   */
  private async showCurrentQuestion(ctx: BotContext, sessionId: string) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    if (!user) {
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      // Get from user preferences or main language field
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    try {
      const session = await this.interviewsService.getSession(userId, sessionId);

      if (session.status !== 'active' && session.status !== 'paused') {
        const errorText: Record<string, string> = {
          uz: `Intervyu yakunlangan yoki to'xtatilgan.`,
          ru: `Интервью завершено или приостановлено.`,
          en: `Interview is completed or paused.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      // Use session state index if available, otherwise use DB index
      // This ensures consistency between Telegram session and DB
      let questionIndex = ctx.session.currentQuestionIndex;
      if (questionIndex === undefined || questionIndex === null) {
        questionIndex = session.currentQuestionIndex;
        // Sync session state with DB
        ctx.session.currentQuestionIndex = questionIndex;
      }

      const questions = session.questions as any[];

      if (questionIndex >= questions.length) {
        // Interview completed
        await this.completeInterview(ctx, sessionId);
        return;
      }

      const question = questions[questionIndex];
      const questionNumber = questionIndex + 1;
      const totalQuestions = questions.length;

      // Translate question if needed (if question is in English and user's language is not English)
      let questionTextTranslated = question.question;
      if (lang !== 'en' && question.question && this.openai) {
        try {
          // Use direct OpenAI API call for faster, simpler translation
          const languageName = lang === 'uz' ? "O'zbek" : lang === 'ru' ? 'Русский' : 'English';
          const translationPrompt = `Translate the following interview question to ${languageName} language. Return ONLY the translated question text, nothing else, no explanations, no JSON, no quotes, just the pure translation:\n\n${question.question}`;

          const completion = await this.openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: `You are a professional translator. Translate interview questions accurately and naturally. Return only the translated text, no explanations.`,
              },
              {
                role: 'user',
                content: translationPrompt,
              },
            ],
            max_tokens: 200,
            temperature: 0.3, // Lower temperature for more consistent translations
          });

          const translated = completion.choices[0]?.message?.content?.trim();

          if (translated && translated.length > 5 && translated !== question.question) {
            // Clean up the translation
            questionTextTranslated = translated
              .replace(/^["']|["']$/g, '') // Remove surrounding quotes
              .replace(/^(Translation|Tarjima|Перевод|Ответ|Answer|Javob):\s*/i, '') // Remove prefixes
              .trim();

            this.logger.log(
              `Question translated to ${lang}: ${questionTextTranslated.substring(0, 50)}...`,
            );
          } else {
            this.logger.warn(`Translation result invalid, using original question`);
          }
        } catch (error) {
          this.logger.warn(`Failed to translate question: ${error.message}`, error.stack);
          // Fallback to original question
          questionTextTranslated = question.question;
        }
      }

      const questionText: Record<string, string> = {
        uz:
          `❓ <b>Savol ${questionNumber}/${totalQuestions}</b>\n\n` +
          `${questionTextTranslated}\n\n` +
          `Javobingizni yuboring (matn yoki ovozli xabar):`,
        ru:
          `❓ <b>Вопрос ${questionNumber}/${totalQuestions}</b>\n\n` +
          `${questionTextTranslated}\n\n` +
          `Отправьте ваш ответ (текст или голосовое сообщение):`,
        en:
          `❓ <b>Question ${questionNumber}/${totalQuestions}</b>\n\n` +
          `${questionTextTranslated}\n\n` +
          `Send your answer (text or voice message):`,
      };

      // Interview control buttons - multi-language
      const controlButtonTexts: Record<string, { skip: string; pause: string; end: string }> = {
        uz: {
          skip: '⏭️ Keyingi savol',
          pause: "⏸️ To'xtatish",
          end: '❌ Tugatish',
        },
        ru: {
          skip: '⏭️ Следующий вопрос',
          pause: '⏸️ Пауза',
          end: '❌ Завершить',
        },
        en: {
          skip: '⏭️ Skip',
          pause: '⏸️ Pause',
          end: '❌ End',
        },
      };

      const controlButtons = controlButtonTexts[lang] || controlButtonTexts['en'];
      const keyboard = new InlineKeyboard()
        .text(controlButtons.skip, 'interview_skip')
        .row()
        .text(controlButtons.pause, 'interview_pause')
        .text(controlButtons.end, 'interview_end');

      await ctx.reply(questionText[lang] || questionText['en'], {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });

      // Update session state
      ctx.session.currentQuestionIndex = questionIndex;
    } catch (error) {
      this.logger.error(`Error showing question: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `Savolni ko'rsatishda xatolik.`,
        ru: `Ошибка при отображении вопроса.`,
        en: `Error showing question.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Handle interview answer submission
   */
  async handleInterviewAnswer(ctx: BotContext, answerText: string) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const sessionId = ctx.session.currentInterviewSessionId;
    const questionIndex = ctx.session.currentQuestionIndex;

    if (!sessionId || questionIndex === undefined) {
      const errorText: Record<string, string> = {
        uz: `Aktiv intervyu topilmadi.`,
        ru: `Активное интервью не найдено.`,
        en: `No active interview found.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
      return;
    }

    if (!user) {
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    try {
      const session = await this.interviewsService.getSession(userId, sessionId);
      const questions = session.questions as any[];
      const currentQuestion = questions[questionIndex];

      if (!currentQuestion) {
        const errorText: Record<string, string> = {
          uz: `Savol topilmadi.`,
          ru: `Вопрос не найден.`,
          en: `Question not found.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      // Show processing message
      const processingText: Record<string, string> = {
        uz: `⏳ Javobingiz tahlil qilinmoqda...`,
        ru: `⏳ Ваш ответ анализируется...`,
        en: `⏳ Analyzing your answer...`,
      };
      await ctx.reply(processingText[lang] || processingText['en']);

      // Submit answer
      await this.interviewsService.submitAnswer(userId, sessionId, {
        questionId: currentQuestion.id || currentQuestion._id.toString(),
        answerType: 'text',
        answerText,
        duration: 0, // Can be calculated if needed
      });

      // Show success and move to next question
      const successText: Record<string, string> = {
        uz: `✅ Javob qabul qilindi!\n\nKeyingi savolga o'tamiz...`,
        ru: `✅ Ответ принят!\n\nПереходим к следующему вопросу...`,
        en: `✅ Answer submitted!\n\nMoving to next question...`,
      };
      await ctx.reply(successText[lang] || successText['en']);

      // Show next question
      ctx.session.currentQuestionIndex = questionIndex + 1;
      await this.showCurrentQuestion(ctx, sessionId);
    } catch (error) {
      this.logger.error(`Error submitting answer: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `Javob yuborishda xatolik.`,
        ru: `Ошибка при отправке ответа.`,
        en: `Error submitting answer.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Complete interview session
   */
  private async completeInterview(ctx: BotContext, sessionId: string) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    if (!user) {
      return;
    }

    // Get user ID (handle both _id and id fields)
    const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
    if (!userId) {
      this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
      return;
    }

    try {
      // Complete session
      const session = await this.interviewsService.completeSession(userId, sessionId);

      // Clear session state
      ctx.session.currentInterviewSessionId = undefined;
      ctx.session.currentQuestionIndex = undefined;

      const completionText: Record<string, string> = {
        uz:
          `🎉 <b>Intervyu yakunlandi!</b>\n\n` +
          `Jami savollar: <b>${session.questions.length}</b>\n` +
          `Javob berilgan: <b>${session.answers.length}</b>\n\n` +
          `Umumiy natijalar tez orada tayyor bo'ladi...`,
        ru:
          `🎉 <b>Интервью завершено!</b>\n\n` +
          `Всего вопросов: <b>${session.questions.length}</b>\n` +
          `Отвечено: <b>${session.answers.length}</b>\n\n` +
          `Общие результаты будут готовы в ближайшее время...`,
        en:
          `🎉 <b>Interview completed!</b>\n\n` +
          `Total questions: <b>${session.questions.length}</b>\n` +
          `Answered: <b>${session.answers.length}</b>\n\n` +
          `Overall results will be ready shortly...`,
      };

      await ctx.reply(completionText[lang] || completionText['en'], {
        parse_mode: 'HTML',
      });

      // Poll for feedback completion
      await this.pollInterviewFeedback(ctx, sessionId, userId);
    } catch (error) {
      this.logger.error(`Error completing interview: ${error.message}`, error.stack);
      const errorText: Record<string, string> = {
        uz: `Intervyuni yakunlashda xatolik.`,
        ru: `Ошибка при завершении интервью.`,
        en: `Error completing interview.`,
      };
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Poll for interview feedback completion
   */
  private async pollInterviewFeedback(
    ctx: BotContext,
    sessionId: string,
    userId: string,
    attempts = 0,
  ) {
    const maxAttempts = 30; // 30 attempts = ~2.5 minutes

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
        // Save to session for future use
        if (ctx.session) {
          ctx.session.language = lang;
        }
      } else {
        lang = 'en';
      }
    }

    if (!lang) {
      const user = await this.usersService.findById(userId);
      lang = user?.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    try {
      const session = await this.interviewsService.getSession(userId, sessionId);

      if (session.feedback && session.overallScore !== undefined) {
        // Feedback complete - show results
        await this.displayInterviewResults(ctx, session);
        return;
      }

      // Still processing - poll again
      if (attempts < maxAttempts) {
        setTimeout(() => {
          this.pollInterviewFeedback(ctx, sessionId, userId, attempts + 1);
        }, 5000); // Poll every 5 seconds
      } else {
        // Timeout
        const timeoutText: Record<string, string> = {
          uz: `⏱️ Tahlil vaqti uzaydi. Iltimos keyinroq natijalarni ko'ring.`,
          ru: `⏱️ Анализ занимает больше времени. Пожалуйста, посмотрите результаты позже.`,
          en: `⏱️ Analysis is taking longer. Please check results later.`,
        };
        await ctx.reply(timeoutText[lang] || timeoutText['en'], {
          parse_mode: 'HTML',
        });
      }
    } catch (error) {
      this.logger.error(`Error polling interview feedback: ${error.message}`, error.stack);
    }
  }

  /**
   * Display interview results
   */
  private async displayInterviewResults(ctx: BotContext, session: any) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    let lang = ctx.session?.language;
    if (!lang) {
      if (user) {
        lang = user.preferences?.language || user.language || 'en';
      } else {
        lang = 'en';
      }
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    }

    const feedback = session.feedback;

    if (!feedback) {
      return;
    }

    const resultsText: Record<string, string> = {
      uz:
        `📊 <b>Intervyu Natijalari</b>\n\n` +
        `⭐ <b>Umumiy Ball:</b> ${session.overallScore}/10\n\n` +
        `✅ <b>Kuchli tomonlar:</b>\n${feedback.summary?.strengths?.map((s: string) => `• ${s}`).join('\n') || 'N/A'}\n\n` +
        `⚠️ <b>Zaif tomonlar:</b>\n${feedback.summary?.weaknesses?.map((w: string) => `• ${w}`).join('\n') || 'N/A'}\n\n` +
        `💡 <b>Tavsiyalar:</b>\n${feedback.recommendations?.map((r: string) => `• ${r}`).join('\n') || 'N/A'}`,
      ru:
        `📊 <b>Результаты интервью</b>\n\n` +
        `⭐ <b>Общий Балл:</b> ${session.overallScore}/10\n\n` +
        `✅ <b>Сильные стороны:</b>\n${feedback.summary?.strengths?.map((s: string) => `• ${s}`).join('\n') || 'N/A'}\n\n` +
        `⚠️ <b>Слабые стороны:</b>\n${feedback.summary?.weaknesses?.map((w: string) => `• ${w}`).join('\n') || 'N/A'}\n\n` +
        `💡 <b>Рекомендации:</b>\n${feedback.recommendations?.map((r: string) => `• ${r}`).join('\n') || 'N/A'}`,
      en:
        `📊 <b>Interview Results</b>\n\n` +
        `⭐ <b>Overall Score:</b> ${session.overallScore}/10\n\n` +
        `✅ <b>Strengths:</b>\n${feedback.summary?.strengths?.map((s: string) => `• ${s}`).join('\n') || 'N/A'}\n\n` +
        `⚠️ <b>Weaknesses:</b>\n${feedback.summary?.weaknesses?.map((w: string) => `• ${w}`).join('\n') || 'N/A'}\n\n` +
        `💡 <b>Recommendations:</b>\n${feedback.recommendations?.map((r: string) => `• ${r}`).join('\n') || 'N/A'}`,
    };

    // Interview results buttons - multi-language
    const resultButtonTexts: Record<string, { details: string; new: string }> = {
      uz: {
        details: '📄 Batafsil',
        new: '🔄 Yangi intervyu',
      },
      ru: {
        details: '📄 Подробнее',
        new: '🔄 Новое интервью',
      },
      en: {
        details: '📄 Details',
        new: '🔄 New Interview',
      },
    };

    const resultButtons = resultButtonTexts[lang] || resultButtonTexts['en'];
    const keyboard = new InlineKeyboard()
      .text(resultButtons.details, `interview_detail_${session.id}`)
      .row()
      .text(resultButtons.new, 'interview_new');

    await ctx.reply(resultsText[lang] || resultsText['en'], {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  }
}
