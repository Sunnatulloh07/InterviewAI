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
import { COMPLETE_PLAN_LIMITS } from '../../common/constants/plan-limits.constant';

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

━━━━━━━━━━━━━━━━━━
🌍 <b>Please select your language:</b>
Пожалуйста, выберите язык:
Iltimos, tilni tanlang:`;
      
      // InlineKeyboard for language selection (message buttons, not keyboard)
      const langKeyboard = new InlineKeyboard()
        .text('🇺🇿 O\'zbek', 'lang_uz')
        .text('🇷🇺 Русский', 'lang_ru')
        .text('🇬🇧 English', 'lang_en');

      await ctx.reply(welcomeText, {
        parse_mode: 'HTML',
        reply_markup: langKeyboard, // InlineKeyboard for language selection only
      });

      this.logger.log(`New user started registration: ${telegramId}`);
    } catch (error: any) {
      this.logger.error(`Failed to handle start: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      await ctx.reply(errorText[lang] || errorText.en);
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
<b>Quyidagi tugmalardan birini tanlang:</b>👇`,

      ru: `👋 <b>Добро пожаловать, ${user.firstName}!</b>

${planEmoji[plan]} Тариф: <b>${planNames[plan]?.ru || plan}</b>

📊 <b>Статистика за месяц:</b>
• Mock интервью: ${mockInterviews}
• 🔥 Серия: ${streak} дней
• 🎤 Голосовые: Mock ${mockVoiceRemaining} | Live ${realVoiceRemaining} мин

━━━━━━━━━━━━━━━━━━
<b>Выберите действие:</b>👇`,

      en: `👋 <b>Welcome, ${user.firstName}!</b>

${planEmoji[plan]} Plan: <b>${planNames[plan]?.en || plan}</b>

📊 <b>This month's stats:</b>
• Mock interviews: ${mockInterviews}
• 🔥 Streak: ${streak} days
• 🎤 Voice: Mock ${mockVoiceRemaining} | Live ${realVoiceRemaining} min

━━━━━━━━━━━━━━━━━━
<b>Choose an option:</b>👇`,
    };

    // Button labels for inline keyboard
    const buttonLabels: Record<string, Record<string, string>> = {
      interview: { uz: '🎯 Intervyu', ru: '🎯 Интервью', en: '🎯 Interview' },
      tasks: { uz: '📋 Vazifalar', ru: '📋 Задания', en: '📋 Tasks' },
      cv: { uz: '📄 CV Tahlil', ru: '📄 Анализ CV', en: '📄 CV Analysis' },
      profile: { uz: '👤 Profil', ru: '👤 Профиль', en: '👤 Profile' },
      upgrade: { uz: '💳 Tarif', ru: '💳 Тарифы', en: '💳 Plans' },
      help: { uz: '❓ Yordam', ru: '❓ Помощь', en: '❓ Help' },
    };

    // Inline keyboard with main menu buttons
    const inlineKeyboard = new InlineKeyboard()
      .text(buttonLabels.interview[lang] || buttonLabels.interview.en, 'menu_interview')
      .text(buttonLabels.tasks[lang] || buttonLabels.tasks.en, 'menu_tasks')
      .text(buttonLabels.cv[lang] || buttonLabels.cv.en, 'menu_cv')
      .row()
      .text(buttonLabels.profile[lang] || buttonLabels.profile.en, 'menu_profile')
      .text(buttonLabels.upgrade[lang] || buttonLabels.upgrade.en, 'menu_upgrade')
      .row()
      .text(buttonLabels.help[lang] || buttonLabels.help.en, 'menu_help');

    // STEP 1: Remove persistent keyboard (ReplyKeyboard) first
    await ctx.reply('🔄', {
      reply_markup: { remove_keyboard: true },
    });

    // STEP 2: Send main menu with inline keyboard
    await ctx.reply(menuText[lang] || menuText['en'], {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
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
      
      // Get plan and limits
      const plan = user.subscription?.plan || 'free_trial';
      const planNames: Record<string, Record<string, string>> = {
        'free_trial': { uz: '🆓 Bepul sinov', ru: '🆓 Пробный', en: '🆓 Free Trial' },
        'starter': { uz: '💎 Starter', ru: '💎 Starter', en: '💎 Starter' },
        'pro': { uz: '🚀 Pro', ru: '🚀 Pro', en: '🚀 Pro' },
        'elite': { uz: '👑 Elite', ru: '👑 Elite', en: '👑 Elite' },
      };
      const planName = planNames[plan]?.[lang] || plan;
      
      // Get plan limits
      const limits = COMPLETE_PLAN_LIMITS[plan as keyof typeof COMPLETE_PLAN_LIMITS] || COMPLETE_PLAN_LIMITS.free_trial;
      const mockLimit = limits.mockInterviews.perMonth;
      const liveLimit = limits.voice.realVoice;
      const cvLimit = limits.cvAnalysis.perMonth;
      
      // Get current usage
      const mockUsed = user.usage?.mockInterviewsThisMonth || 0;
      const liveUsed = user.usage?.liveInterviewMinutesThisMonth || 0;
      const cvUsed = user.usage?.cvAnalysesThisMonth || 0;
      const mockVoiceRemaining = user.voiceQuota?.mockVoice?.remaining || 0;
      const liveVoiceRemaining = user.voiceQuota?.realVoice?.remaining || 0;
      
      // Format limits display
      const mockLimitText = mockLimit === -1 ? '∞' : mockLimit;
      const liveLimitText = liveLimit === -1 ? '∞' : liveLimit;
      const cvLimitText = cvLimit === -1 ? '∞' : cvLimit;
      
      const profileText = {
        uz: `👤 <b>Profil</b>\n\n` +
            `Ism: ${user.firstName} ${user.lastName}\n` +
            `Telefon: ${user.phoneNumber}\n` +
            `Lavozim: ${user.profile?.position || 'Aniqlanmagan'}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 <b>Tarif: ${planName}</b>\n\n` +
            `📊 <b>Bu oylik limitlar:</b>\n` +
            `• Mock intervyu: ${mockUsed}/${mockLimitText}\n` +
            `• Live intervyu: ${liveUsed}/${liveLimitText} daq\n` +
            `• CV tahlili: ${cvUsed}/${cvLimitText}\n\n` +
            `🎤 <b>Ovozli:</b>\n` +
            `• Mock: ${mockVoiceRemaining} daq\n` +
            `• Live: ${liveVoiceRemaining} daq\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🔥 Streak: ${user.dailyTasks?.currentStreak || 0} kun`,
        ru: `👤 <b>Профиль</b>\n\n` +
            `Имя: ${user.firstName} ${user.lastName}\n` +
            `Телефон: ${user.phoneNumber}\n` +
            `Должность: ${user.profile?.position || 'Не указана'}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 <b>Тариф: ${planName}</b>\n\n` +
            `📊 <b>Лимиты за месяц:</b>\n` +
            `• Mock-интервью: ${mockUsed}/${mockLimitText}\n` +
            `• Live-интервью: ${liveUsed}/${liveLimitText} мин\n` +
            `• Анализ CV: ${cvUsed}/${cvLimitText}\n\n` +
            `🎤 <b>Голосовые:</b>\n` +
            `• Mock: ${mockVoiceRemaining} мин\n` +
            `• Live: ${liveVoiceRemaining} мин\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🔥 Серия: ${user.dailyTasks?.currentStreak || 0} дней`,
        en: `👤 <b>Profile</b>\n\n` +
            `Name: ${user.firstName} ${user.lastName}\n` +
            `Phone: ${user.phoneNumber}\n` +
            `Position: ${user.profile?.position || 'Not set'}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 <b>Plan: ${planName}</b>\n\n` +
            `📊 <b>Monthly Limits:</b>\n` +
            `• Mock interviews: ${mockUsed}/${mockLimitText}\n` +
            `• Live interviews: ${liveUsed}/${liveLimitText} min\n` +
            `• CV analyses: ${cvUsed}/${cvLimitText}\n\n` +
            `🎤 <b>Voice:</b>\n` +
            `• Mock: ${mockVoiceRemaining} min\n` +
            `• Live: ${liveVoiceRemaining} min\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
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
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      await ctx.reply(errorText[lang] || errorText.en);
    }
  }

  /**
   * Handle /upgrade command
   * ✅ Updated to match COMPLETE_PLAN_LIMITS exactly
   */
  async handleUpgrade(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';
    
    // Get limits from COMPLETE_PLAN_LIMITS
    const freeLimits = COMPLETE_PLAN_LIMITS.free_trial;
    const starterLimits = COMPLETE_PLAN_LIMITS.starter;
    const proLimits = COMPLETE_PLAN_LIMITS.pro;
    const eliteLimits = COMPLETE_PLAN_LIMITS.elite;
    
    const plansText: Record<string, string> = {
      uz: `💳 <b>Tariflar</b>\n\n` +
          `🆓 <b>Free Trial</b> - 7 kun\n` +
          `• ${freeLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
          `• ${freeLimits.voice.mockVoice} daqiqa mock ovoz\n` +
          `• ${freeLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
          `• Faqat matn javoblari\n\n` +
          
          `💎 <b>Starter</b> - $9.99/oy\n` +
          `• ${starterLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
          `• ${starterLimits.voice.mockVoice} daq mock + ${starterLimits.voice.realVoice} daq live ovoz\n` +
          `• ${starterLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
          `• Ovoz va rasm javoblari\n\n` +
          
          `🚀 <b>Pro</b> - $19.99/oy\n` +
          `• ${proLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
          `• ${proLimits.voice.mockVoice} daq mock + ${proLimits.voice.realVoice} daq live ovoz\n` +
          `• ${proLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
          `• Batafsil AI tahlil\n` +
          `• Chrome Extension\n\n` +
          
          `👑 <b>Elite</b> - $29.99/oy\n` +
          `• Cheksiz mock intervyu\n` +
          `• ${eliteLimits.voice.mockVoice} daq mock + ${eliteLimits.voice.realVoice} daq live ovoz\n` +
          `• ${eliteLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
          `• Premium AI modellari\n` +
          `• Priority support\n\n` +
          
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 Tarif o'zgartirish uchun @interviewai_support_bot ga murojaat qiling`,
          
      ru: `💳 <b>Тарифы</b>\n\n` +
          `🆓 <b>Free Trial</b> - 7 дней\n` +
          `• ${freeLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
          `• ${freeLimits.voice.mockVoice} мин mock-голос\n` +
          `• ${freeLimits.cvAnalysis.perMonth} анализа CV\n` +
          `• Только текстовые ответы\n\n` +
          
          `💎 <b>Starter</b> - $9.99/мес\n` +
          `• ${starterLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
          `• ${starterLimits.voice.mockVoice} мин mock + ${starterLimits.voice.realVoice} мин live голос\n` +
          `• ${starterLimits.cvAnalysis.perMonth} анализов CV\n` +
          `• Голос и изображения\n\n` +
          
          `🚀 <b>Pro</b> - $19.99/мес\n` +
          `• ${proLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
          `• ${proLimits.voice.mockVoice} мин mock + ${proLimits.voice.realVoice} мин live голос\n` +
          `• ${proLimits.cvAnalysis.perMonth} анализов CV\n` +
          `• Подробный AI анализ\n` +
          `• Chrome Extension\n\n` +
          
          `👑 <b>Elite</b> - $29.99/мес\n` +
          `• Безлимит mock-интервью\n` +
          `• ${eliteLimits.voice.mockVoice} мин mock + ${eliteLimits.voice.realVoice} мин live голос\n` +
          `• ${eliteLimits.cvAnalysis.perMonth} анализов CV\n` +
          `• Premium AI модели\n` +
          `• Приоритетная поддержка\n\n` +
          
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 Для изменения тарифа обратитесь в @interviewai_support_bot`,
          
      en: `💳 <b>Plans</b>\n\n` +
          `🆓 <b>Free Trial</b> - 7 days\n` +
          `• ${freeLimits.mockInterviews.perMonth} mock interviews/mo\n` +
          `• ${freeLimits.voice.mockVoice} min mock voice\n` +
          `• ${freeLimits.cvAnalysis.perMonth} CV analyses\n` +
          `• Text answers only\n\n` +
          
          `💎 <b>Starter</b> - $9.99/month\n` +
          `• ${starterLimits.mockInterviews.perMonth} mock interviews/mo\n` +
          `• ${starterLimits.voice.mockVoice} min mock + ${starterLimits.voice.realVoice} min live voice\n` +
          `• ${starterLimits.cvAnalysis.perMonth} CV analyses\n` +
          `• Voice & image answers\n\n` +
          
          `🚀 <b>Pro</b> - $19.99/month\n` +
          `• ${proLimits.mockInterviews.perMonth} mock interviews/mo\n` +
          `• ${proLimits.voice.mockVoice} min mock + ${proLimits.voice.realVoice} min live voice\n` +
          `• ${proLimits.cvAnalysis.perMonth} CV analyses\n` +
          `• Detailed AI analysis\n` +
          `• Chrome Extension\n\n` +
          
          `👑 <b>Elite</b> - $29.99/month\n` +
          `• Unlimited mock interviews\n` +
          `• ${eliteLimits.voice.mockVoice} min mock + ${eliteLimits.voice.realVoice} min live voice\n` +
          `• ${eliteLimits.cvAnalysis.perMonth} CV analyses\n` +
          `• Premium AI models\n` +
          `• Priority support\n\n` +
          
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 To change your plan, contact @interviewai_support_bot`,
    };
    
    // Add inline keyboard with support bot link
    const keyboard = new InlineKeyboard()
      .url('📞 Support Bot', 'https://t.me/interviewai_support_bot');
    
    await ctx.reply(plansText[lang] || plansText['en'], { 
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
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
          `<b>Buyruqlar:</b>\n` +
          `▪️ /start - Botni ishga tushirish\n` +
          `▪️ /interview - Intervyu boshlash\n` +
          `▪️ /tasks - Kunlik vazifalar\n` +
          `▪️ /profile - Profilni ko'rish\n` +
          `▪️ /upgrade - Tarifni o'zgartirish\n` +
          `▪️ /voice - Ovozli xabar limiti\n` +
          `▪️ /help - Yordam\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 Savollar uchun: @interviewai_support_bot`,
      ru: `❓ <b>Помощь</b>\n\n` +
          `<b>Команды:</b>\n` +
          `▪️ /start - Запуск бота\n` +
          `▪️ /interview - Начать интервью\n` +
          `▪️ /tasks - Ежедневные задания\n` +
          `▪️ /profile - Профиль\n` +
          `▪️ /upgrade - Изменить тариф\n` +
          `▪️ /voice - Лимит голосовых\n` +
          `▪️ /help - Помощь\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 Поддержка: @interviewai_support_bot`,
      en: `❓ <b>Help</b>\n\n` +
          `<b>Commands:</b>\n` +
          `▪️ /start - Start bot\n` +
          `▪️ /interview - Start interview\n` +
          `▪️ /tasks - Daily tasks\n` +
          `▪️ /profile - View profile\n` +
          `▪️ /upgrade - Change plan\n` +
          `▪️ /voice - Voice quota status\n` +
          `▪️ /help - Help\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📞 Support: @interviewai_support_bot`,
    };
    
    // Add support bot button
    const keyboard = new InlineKeyboard()
      .url('📞 Support Bot', 'https://t.me/interviewai_support_bot');

    await ctx.reply(helpText[lang] || helpText['en'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Handle /stats command
   * Shows detailed statistics for the user
   */
  async handleStats(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      
      // Get usage stats (schema only has monthly tracking)
      const mockInterviews = user.usage?.mockInterviewsThisMonth || 0;
      const liveMinutes = user.usage?.liveInterviewMinutesThisMonth || 0;
      const cvAnalyses = user.usage?.cvAnalysesThisMonth || 0;
      const chromeQuestions = user.usage?.chromeQuestionsThisMonth || 0;
      const streak = user.dailyTasks?.currentStreak || 0;
      const longestStreak = user.dailyTasks?.longestStreak || 0;
      const totalCompleted = user.dailyTasks?.totalCompleted || 0;
      
      const statsText: Record<string, string> = {
        uz: `📊 <b>Statistika</b>

📈 <b>Bu oylik:</b>
• Mock intervyular: ${mockInterviews}
• Live intervyu: ${liveMinutes} daq
• CV tahlillari: ${cvAnalyses}
• Chrome savollari: ${chromeQuestions}

🔥 <b>Streak:</b>
• Joriy: ${streak} kun
• Eng uzun: ${longestStreak} kun
• Jami bajarilgan: ${totalCompleted}`,
        
        ru: `📊 <b>Статистика</b>

📈 <b>За месяц:</b>
• Mock-интервью: ${mockInterviews}
• Live-интервью: ${liveMinutes} мин
• Анализов CV: ${cvAnalyses}
• Chrome вопросы: ${chromeQuestions}

🔥 <b>Серия:</b>
• Текущая: ${streak} дней
• Максимальная: ${longestStreak} дней
• Всего выполнено: ${totalCompleted}`,
        
        en: `📊 <b>Statistics</b>

📈 <b>This Month:</b>
• Mock interviews: ${mockInterviews}
• Live interviews: ${liveMinutes} min
• CV analyses: ${cvAnalyses}
• Chrome questions: ${chromeQuestions}

🔥 <b>Streak:</b>
• Current: ${streak} days
• Longest: ${longestStreak} days
• Total completed: ${totalCompleted}`,
      };
      
      await ctx.reply(statsText[lang] || statsText['en'], {
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      this.logger.error(`Failed to show stats: ${error.message}`);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      await ctx.reply(errorText[lang] || errorText.en);
    }
  }

  /**
   * Handle /settings command
   * Shows available settings
   */
  async handleSettings(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      
      const settingsText: Record<string, string> = {
        uz: `⚙️ <b>Sozlamalar</b>

🔧 <b>Mavjud sozlamalar:</b>

▪️ /set_position - Lavozimni o'zgartirish
▪️ /voice - Ovozli xabar limiti
▪️ /profile - Profil ma'lumotlari

💡 <b>Tez orada qo'shiladi:</b>
• Til sozlamalari
• Xabarnoma sozlamalari
• Intervyu rejimi sozlamalari`,
        
        ru: `⚙️ <b>Настройки</b>

🔧 <b>Доступные настройки:</b>

▪️ /set_position - Изменить должность
▪️ /voice - Лимит голосовых сообщений
▪️ /profile - Информация профиля

💡 <b>Скоро будет добавлено:</b>
• Настройки языка
• Настройки уведомлений
• Настройки режима интервью`,
        
        en: `⚙️ <b>Settings</b>

🔧 <b>Available settings:</b>

▪️ /set_position - Change position
▪️ /voice - Voice message quota
▪️ /profile - Profile information

💡 <b>Coming soon:</b>
• Language settings
• Notification settings
• Interview mode settings`,
      };
      
      const keyboard = new InlineKeyboard()
        .text('👤 Lavozim', 'set_position')
        .text('🎤 Ovozli', 'voice_quota')
        .row()
        .text('🔙 Orqaga', 'back_to_menu');
      
      await ctx.reply(settingsText[lang] || settingsText['en'], {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: any) {
      this.logger.error(`Failed to show settings: ${error.message}`);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      await ctx.reply(errorText[lang] || errorText.en);
    }
  }

  /**
   * Handle /analyze_cv command
   * Shows existing CV or prompts to upload new one
   */
  async handleAnalyzeCv(ctx: BotContext) {
    // Call handleViewCv to show existing CV analysis or upload prompt
    await this.handleViewCv(ctx);
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
   * Complete implementation with file download, validation, and processing
   */
  async handleDocumentMessage(ctx: BotContext) {
    const lang = ctx.session?.language || 'en';

    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        const notRegisteredText: Record<string, string> = {
          uz: `❌ Iltimos avval /start buyrug'i bilan ro'yxatdan o'ting`,
          ru: `❌ Пожалуйста, сначала зарегистрируйтесь используя /start`,
          en: `❌ Please register first using /start`,
        };
        await ctx.reply(notRegisteredText[lang] || notRegisteredText['en']);
        return;
      }

      const document = ctx.message?.document;
      if (!document) {
        const noDocText: Record<string, string> = {
          uz: '❌ Hujjat topilmadi. Iltimos, qayta yuboring.',
          ru: '❌ Документ не найден. Пожалуйста, отправьте снова.',
          en: '❌ Document not found. Please send again.',
        };
        await ctx.reply(noDocText[lang] || noDocText['en']);
        return;
      }

      // Validate file size (max 20MB for Telegram)
      const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
      if (document.file_size && document.file_size > MAX_FILE_SIZE) {
        const sizeErrorText: Record<string, string> = {
          uz: '❌ Hujjat hajmi juda katta. Maksimal hajm: 20MB',
          ru: '❌ Размер документа слишком большой. Максимум: 20MB',
          en: '❌ File size is too large. Maximum: 20MB',
        };
        await ctx.reply(sizeErrorText[lang] || sizeErrorText['en']);
        return;
      }

      // Check plan limits
      const canProceed = await this.subscriptionService.checkCvAnalysisLimit(ctx, user, lang);
      if (!canProceed) {
        return; // Limit reached, error message already sent
      }

      // Check file type
      const allowedMimeTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain',
      ];
      
      const fileName = document.file_name || '';
      const mimeType = document.mime_type || '';
      const fileExtension = fileName.split('.').pop()?.toLowerCase();
      
      const allowedExtensions = ['pdf', 'docx', 'doc', 'txt'];
      
      if (!allowedExtensions.includes(fileExtension || '') && !allowedMimeTypes.includes(mimeType)) {
        const invalidFileText: Record<string, string> = {
          uz: '❌ Noto\'g\'ri fayl formati. Faqat PDF, DOCX, DOC yoki TXT fayllar qabul qilinadi.',
          ru: '❌ Неверный формат файла. Принимаются только PDF, DOCX, DOC или TXT файлы.',
          en: '❌ Invalid file format. Only PDF, DOCX, DOC, or TXT files are accepted.',
        };
        await ctx.reply(invalidFileText[lang] || invalidFileText['en']);
        return;
      }

      // Send processing message
      const processingText: Record<string, string> = {
        uz: '⏳ CV yuklanmoqda va tahlil qilinmoqda... Iltimos, kuting.',
        ru: '⏳ CV загружается и анализируется... Пожалуйста, подождите.',
        en: '⏳ CV is being uploaded and analyzed... Please wait.',
      };
      const processingMsg = await ctx.reply(processingText[lang] || processingText['en']);

      try {
        // Get file from Telegram servers
        const file = await ctx.api.getFile(document.file_id);
        
        if (!file.file_path) {
          throw new Error('File path not available');
        }

        // Download file using Telegram bot API
        const fileUrl = `https://api.telegram.org/file/bot${this.configService.get('TELEGRAM_BOT_TOKEN')}/${file.file_path}`;
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.statusText}`);
        }

        const fileBuffer = Buffer.from(await response.arrayBuffer());

        // Create file object compatible with cvService.uploadCv
        const fileObject = {
          buffer: fileBuffer,
          originalname: fileName,
          mimetype: mimeType || 'application/octet-stream',
          size: document.file_size || fileBuffer.length,
          fieldname: 'file',
        } as Express.Multer.File;

        const userId = (user as any)._id?.toString() || (user as any).id?.toString();

        // Upload CV
        const cv = await this.cvService.uploadCv(userId, fileObject, {
          jobDescription: '',
        });

        // Delete processing message
        try {
          if (ctx.chat?.id) {
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id);
          }
        } catch (deleteError) {
          // Silent fail
        }

        // Send success message
        const fileSizeKB = document.file_size ? (document.file_size / 1024).toFixed(1) : 'Unknown';
        
        const successText: Record<string, string> = {
          uz: `✅ <b>CV muvaffaqiyatli yuklandi!</b>

📄 Fayl: <code>${fileName}</code>
📊 Hajm: ${fileSizeKB} KB
🔄 Status: Tahlil qilinmoqda...

<i>Natijalar tayyor bo'lganda sizga xabar beramiz.</i>`,
          ru: `✅ <b>CV успешно загружен!</b>

📄 Файл: <code>${fileName}</code>
📊 Размер: ${fileSizeKB} KB
🔄 Статус: Анализируется...

<i>Мы сообщим, когда результаты будут готовы.</i>`,
          en: `✅ <b>CV uploaded successfully!</b>

📄 File: <code>${fileName}</code>
📊 Size: ${fileSizeKB} KB
🔄 Status: Analyzing...

<i>We'll notify you when results are ready.</i>`,
        };

        const viewKeyboard = new InlineKeyboard()
          .text('📊 View CV Analysis', 'cv_view')
          .row()
          .text('🔙 Back to Menu', 'back_to_menu');

        await ctx.reply(successText[lang] || successText['en'], {
          parse_mode: 'HTML',
          reply_markup: viewKeyboard,
        });

        this.logger.log(`CV uploaded successfully for user ${telegramId}: ${cv.id}`);

      } catch (uploadError: any) {
        // Delete processing message
        try {
          if (ctx.chat?.id) {
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id);
          }
        } catch (deleteError) {
          // Silent fail
        }

        this.logger.error(`Failed to upload CV: ${uploadError.message}`, uploadError.stack);
        
        const uploadErrorText: Record<string, string> = {
          uz: `❌ <b>CV yuklashda xatolik yuz berdi</b>

${uploadError.message || 'Noma\'lum xatolik'}

Iltimos, qayta urinib ko'ring yoki boshqa fayl yuboring.`,
          ru: `❌ <b>Ошибка при загрузке CV</b>

${uploadError.message || 'Неизвестная ошибка'}

Пожалуйста, попробуйте снова или отправьте другой файл.`,
          en: `❌ <b>Error uploading CV</b>

${uploadError.message || 'Unknown error'}

Please try again or send a different file.`,
        };

        await ctx.reply(uploadErrorText[lang] || uploadErrorText['en'], {
          parse_mode: 'HTML',
        });
      }

    } catch (error: any) {
      this.logger.error(`Failed to handle document message: ${error.message}`, error.stack);
      
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      
      await ctx.reply(errorText[lang] || errorText['en']);
    }
  }

  /**
   * Handle view CV - shows user's CV analysis results or prompts to upload
   */
  async handleViewCv(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        const notRegisteredText: Record<string, string> = {
          uz: `❌ Iltimos avval /start buyrug'i bilan ro'yxatdan o'ting`,
          ru: `❌ Пожалуйста, сначала зарегистрируйтесь используя /start`,
          en: `❌ Please register first using /start`,
        };
        await ctx.reply(notRegisteredText[ctx.session?.language || 'en'] || notRegisteredText['en']);
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      const userId = (user as any)._id?.toString() || (user as any).id?.toString();

      // Get user's latest CV
      const userCvs = await this.cvService.getUserCvs(userId, 1, 0);
      const latestCv = userCvs.length > 0 ? userCvs[0] : null;

      if (!latestCv) {
        // No CV found - prompt to upload
        const noCvText: Record<string, string> = {
          uz: `📄 <b>Sizda hali CV yo'q</b>

CV yuklash uchun hujjatni yuboring (PDF, DOCX)

💡 Faylni shu chatga yuboring`,
          ru: `📄 <b>У вас пока нет CV</b>

Отправьте документ для загрузки CV (PDF, DOCX)

💡 Отправьте файл в этот чат`,
          en: `📄 <b>You don't have a CV yet</b>

Send a document to upload your CV (PDF, DOCX)

💡 Send the file to this chat`,
        };

        const uploadKeyboard = new InlineKeyboard()
          .text('📤 Upload CV', 'cv_upload')
          .row()
          .text('🔙 Back to Menu', 'back_to_menu');

        await ctx.reply(noCvText[lang] || noCvText['en'], {
          parse_mode: 'HTML',
          reply_markup: uploadKeyboard,
        });
        return;
      }

      // CV exists - check analysis status
      const cv = latestCv as any;
      const analysisStatus = cv.analysisStatus || 'pending';

      if (analysisStatus === 'pending') {
        // Analysis pending
        const pendingText: Record<string, string> = {
          uz: `⏳ <b>CV tahlili kutilmoqda</b>

📄 Fayl: <code>${cv.fileName}</code>
🔄 Status: Tahlil qilinmoqda...

<i>Iltimos, biroz kuting. Tahlil tugaganda sizga xabar beramiz.</i>`,
          ru: `⏳ <b>Ожидание анализа CV</b>

📄 Файл: <code>${cv.fileName}</code>
🔄 Статус: Анализируется...

<i>Пожалуйста, подождите. Мы сообщим, когда анализ будет завершен.</i>`,
          en: `⏳ <b>CV Analysis Pending</b>

📄 File: <code>${cv.fileName}</code>
🔄 Status: Analyzing...

<i>Please wait. We'll notify you when the analysis is complete.</i>`,
        };

        const pendingKeyboard = new InlineKeyboard()
          .text('🔄 Check Status', 'cv_view')
          .row()
          .text('🔙 Back to Menu', 'back_to_menu');

        await ctx.reply(pendingText[lang] || pendingText['en'], {
          parse_mode: 'HTML',
          reply_markup: pendingKeyboard,
        });
        return;
      }

      if (analysisStatus === 'failed') {
        // Analysis failed
        const failedText: Record<string, string> = {
          uz: `❌ <b>CV tahlili amalga oshmadi</b>

📄 Fayl: <code>${cv.fileName}</code>
❌ Status: Xatolik yuz berdi

<i>Qayta urinib ko'rishni xohlaysizmi?</i>`,
          ru: `❌ <b>Анализ CV не удался</b>

📄 Файл: <code>${cv.fileName}</code>
❌ Статус: Произошла ошибка

<i>Хотите попробовать снова?</i>`,
          en: `❌ <b>CV Analysis Failed</b>

📄 File: <code>${cv.fileName}</code>
❌ Status: Error occurred

<i>Would you like to try again?</i>`,
        };

        // Check if re-analysis is allowed (within limits)
        const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(ctx, user, lang, false);

        const failedKeyboard = new InlineKeyboard();
        if (canReanalyze) {
          failedKeyboard.text('🔄 Re-analyze', 'cv_reanalyze');
        }
        failedKeyboard.text('📤 Upload New CV', 'cv_upload');
        failedKeyboard.row().text('🔙 Back to Menu', 'back_to_menu');

        await ctx.reply(failedText[lang] || failedText['en'], {
          parse_mode: 'HTML',
          reply_markup: failedKeyboard,
        });
        return;
      }

      // Analysis completed - show results
      const analysis = cv.analysis;
      const overallScore = analysis?.overallScore || 0;
      const strengths = analysis?.strengths || [];
      const improvements = analysis?.improvements || [];
      const recommendations = analysis?.recommendations || [];

      // Format score with emoji
      const scoreEmoji = overallScore >= 80 ? '🟢' : overallScore >= 60 ? '🟡' : '🔴';

      // Format strengths
      const strengthsText = strengths.length > 0
        ? strengths.slice(0, 3).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')
        : 'No specific strengths identified';

      // Format improvements
      const improvementsText = improvements.length > 0
        ? improvements.slice(0, 3).map((imp: string, i: number) => `${i + 1}. ${imp}`).join('\n')
        : 'No specific improvements identified';

      const resultsText: Record<string, string> = {
        uz: `📊 <b>CV Tahlili Natijalari</b>

📄 Fayl: <code>${cv.fileName}</code>
📅 Sana: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Umumiy baho:</b> ${overallScore}/100

💪 <b>Kuchli tomonlar:</b>
${strengthsText}

⚠️ <b>Yaxshilash kerak:</b>
${improvementsText}

<i>To'liq tahlilni ko'rish uchun "Full Analysis" tugmasini bosing</i>`,
        ru: `📊 <b>Результаты Анализа CV</b>

📄 Файл: <code>${cv.fileName}</code>
📅 Дата: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Общая оценка:</b> ${overallScore}/100

💪 <b>Сильные стороны:</b>
${strengthsText}

⚠️ <b>Требует улучшения:</b>
${improvementsText}

<i>Нажмите "Full Analysis" для просмотра полного анализа</i>`,
        en: `📊 <b>CV Analysis Results</b>

📄 File: <code>${cv.fileName}</code>
📅 Date: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Overall Score:</b> ${overallScore}/100

💪 <b>Strengths:</b>
${strengthsText}

⚠️ <b>Areas for Improvement:</b>
${improvementsText}

<i>Click "Full Analysis" to view the complete analysis</i>`,
      };

      // Check if re-analysis is allowed
      const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(ctx, user, lang, false);

      const resultsKeyboard = new InlineKeyboard();
      resultsKeyboard.text('📋 Full Analysis', `cv_full_${cv.id}`);
      resultsKeyboard.row();
      if (canReanalyze) {
        resultsKeyboard.text('🔄 Re-analyze', 'cv_reanalyze');
      }
      resultsKeyboard.text('📤 Upload New CV', 'cv_upload');
      resultsKeyboard.row().text('🔙 Back to Menu', 'back_to_menu');

      await ctx.reply(resultsText[lang] || resultsText['en'], {
        parse_mode: 'HTML',
        reply_markup: resultsKeyboard,
      });

    } catch (error: any) {
      this.logger.error(`Failed to handle view CV: ${error.message}`, error.stack);
      
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: '❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.',
        ru: '❌ Произошла ошибка. Пожалуйста, попробуйте снова.',
        en: '❌ Error occurred. Please try again.',
      };
      
      await ctx.reply(errorText[lang] || errorText['en']);
    }
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
    // CV ANALYSIS CALLBACKS
    // ============================================================
    if (callbackData.startsWith('cv_')) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const userLang = this.getUserLanguage(ctx, user);
      const userId = (user as any)._id?.toString() || (user as any).id?.toString();

      if (callbackData === 'cv_view') {
        // Show CV analysis results
        await this.handleViewCv(ctx);
        return;
      }

      if (callbackData === 'cv_upload') {
        // Prompt user to upload new CV
        const uploadText: Record<string, string> = {
          uz: `📤 <b>Yangi CV yuklash</b>

Hujjatni yuboring (PDF, DOCX, DOC, TXT)

💡 Faylni shu chatga yuboring`,
          ru: `📤 <b>Загрузить новый CV</b>

Отправьте документ (PDF, DOCX, DOC, TXT)

💡 Отправьте файл в этот чат`,
          en: `📤 <b>Upload New CV</b>

Send a document (PDF, DOCX, DOC, TXT)

💡 Send the file to this chat`,
        };

        await ctx.reply(uploadText[userLang] || uploadText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      if (callbackData === 'cv_reanalyze') {
        // Trigger re-analysis of existing CV
        try {
          // Check plan limits first
          const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(ctx, user, userLang);
          if (!canReanalyze) {
            return; // Limit reached, message already sent
          }

          // Get user's latest CV
          const userCvs = await this.cvService.getUserCvs(userId, 1, 0);
          const latestCv = userCvs.length > 0 ? userCvs[0] : null;

          if (!latestCv) {
            const noCvText: Record<string, string> = {
              uz: `❌ <b>CV topilmadi</b>\n\nAvval CV yuklang.`,
              ru: `❌ <b>CV не найден</b>\n\nСначала загрузите CV.`,
              en: `❌ <b>No CV found</b>\n\nPlease upload a CV first.`,
            };
            await ctx.reply(noCvText[userLang] || noCvText['en'], {
              parse_mode: 'HTML',
            });
            return;
          }

          const reanalyzeText: Record<string, string> = {
            uz: `🔄 <b>CV qayta tahlil qilinmoqda...</b>\n\nIltimos, kuting.`,
            ru: `🔄 <b>CV повторно анализируется...</b>\n\nПожалуйста, подождите.`,
            en: `🔄 <b>Re-analyzing CV...</b>\n\nPlease wait.`,
          };
          const msg = await ctx.reply(reanalyzeText[userLang] || reanalyzeText['en']);

          try {
            // Trigger re-analysis
            await this.cvService.analyzeCv(userId, (latestCv as any).id, {
              language: userLang,
            });

            // Delete processing message
            try {
              if (ctx.chat?.id) {
                await ctx.api.deleteMessage(ctx.chat.id, msg.message_id);
              }
            } catch (deleteError) {
              // Silent fail
            }

            const successText: Record<string, string> = {
              uz: `✅ <b>CV qayta tahlil qilindi!</b>\n\nYangilangan natijalarni ko'rish uchun "View Analysis" tugmasini bosing.`,
              ru: `✅ <b>CV повторно проанализирован!</b>\n\nНажмите "View Analysis", чтобы увидеть обновленные результаты.`,
              en: `✅ <b>CV re-analyzed successfully!</b>\n\nClick "View Analysis" to see the updated results.`,
            };

            const keyboard = new InlineKeyboard()
              .text('📊 View Analysis', 'cv_view')
              .row()
              .text('🔙 Back to Menu', 'back_to_menu');

            await ctx.reply(successText[userLang] || successText['en'], {
              parse_mode: 'HTML',
              reply_markup: keyboard,
            });

            this.logger.log(`CV re-analyzed for user ${telegramId}: ${(latestCv as any).id}`);
          } catch (analyzeError: any) {
            // Delete processing message
            try {
              if (ctx.chat?.id) {
                await ctx.api.deleteMessage(ctx.chat.id, msg.message_id);
              }
            } catch (deleteError) {
              // Silent fail
            }

            this.logger.error(`Failed to re-analyze CV: ${analyzeError.message}`, analyzeError.stack);
            
            const errorText: Record<string, string> = {
              uz: `❌ <b>Tahlilda xatolik yuz berdi</b>\n\n${analyzeError.message || 'Noma\'lum xatolik'}`,
              ru: `❌ <b>Ошибка при анализе</b>\n\n${analyzeError.message || 'Неизвестная ошибка'}`,
              en: `❌ <b>Error during analysis</b>\n\n${analyzeError.message || 'Unknown error'}`,
            };

            await ctx.reply(errorText[userLang] || errorText['en'], {
              parse_mode: 'HTML',
            });
          }
        } catch (error: any) {
          this.logger.error(`Failed to handle cv_reanalyze: ${error.message}`, error.stack);
          await ctx.reply('❌ Error occurred. Please try again.');
        }
        return;
      }

      // Handle cv_full_<cvId> - show full analysis
      if (callbackData.startsWith('cv_full_')) {
        const cvId = callbackData.replace('cv_full_', '');
        try {
          const cv = await this.cvService.getCvById(userId, cvId);
          const analysis = (cv as any).analysis;

          if (!analysis) {
            const noAnalysisText: Record<string, string> = {
              uz: `❌ <b>Tahlil mavjud emas</b>\n\nCV hali tahlil qilinmagan.`,
              ru: `❌ <b>Анализ недоступен</b>\n\nCV еще не проанализирован.`,
              en: `❌ <b>Analysis not available</b>\n\nCV has not been analyzed yet.`,
            };
            await ctx.reply(noAnalysisText[userLang] || noAnalysisText['en'], {
              parse_mode: 'HTML',
            });
            return;
          }

          // Format full analysis
          const overallScore = analysis.overallScore || 0;
          const strengths = analysis.strengths || [];
          const improvements = analysis.improvements || [];
          const recommendations = analysis.recommendations || [];
          const summary = analysis.summary || '';

          const fullAnalysisText: Record<string, string> = {
            uz: `📋 <b>To'liq CV Tahlili</b>

📊 <b>Umumiy baho:</b> ${overallScore}/100

📝 <b>Xulosa:</b>
${summary}

💪 <b>Kuchli tomonlar:</b>
${strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') || 'Aniqlanmagan'}

⚠️ <b>Yaxshilash kerak:</b>
${improvements.map((imp: string, i: number) => `${i + 1}. ${imp}`).join('\n') || 'Aniqlanmagan'}

💡 <b>Tavsiyalar:</b>
${recommendations.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n') || 'Tavsiyalar mavjud emas'}`,
            ru: `📋 <b>Полный Анализ CV</b>

📊 <b>Общая оценка:</b> ${overallScore}/100

📝 <b>Резюме:</b>
${summary}

💪 <b>Сильные стороны:</b>
${strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') || 'Не определено'}

⚠️ <b>Требует улучшения:</b>
${improvements.map((imp: string, i: number) => `${i + 1}. ${imp}`).join('\n') || 'Не определено'}

💡 <b>Рекомендации:</b>
${recommendations.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n') || 'Нет рекомендаций'}`,
            en: `📋 <b>Full CV Analysis</b>

📊 <b>Overall Score:</b> ${overallScore}/100

📝 <b>Summary:</b>
${summary}

💪 <b>Strengths:</b>
${strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') || 'Not identified'}

⚠️ <b>Areas for Improvement:</b>
${improvements.map((imp: string, i: number) => `${i + 1}. ${imp}`).join('\n') || 'Not identified'}

💡 <b>Recommendations:</b>
${recommendations.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n') || 'No recommendations'}`,
          };

          const keyboard = new InlineKeyboard()
            .text('🔙 Back to Summary', 'cv_view')
            .row()
            .text('🏠 Main Menu', 'back_to_menu');

          await ctx.reply(fullAnalysisText[userLang] || fullAnalysisText['en'], {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
        } catch (error: any) {
          this.logger.error(`Failed to show full analysis: ${error.message}`);
          await ctx.reply('❌ Error retrieving full analysis.');
        }
        return;
      }
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
      
      // Keyboard button for phone number request (only during registration)
      const keyboard = new Keyboard()
        .requestContact(phoneButton[selectedLang] || phoneButton.en)
        .resized()
        .oneTime(); // Will auto-hide after use
      
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
        case 'cv':
          await this.handleAnalyzeCv(ctx);
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
      
      if (type === 'cancel') {
        // Cancel interview selection - go back to main menu
        const telegramId = ctx.from?.id as number;
        const user = await this.usersService.findByTelegramId(telegramId);
        if (user) {
          await this.showMainMenu(ctx, user);
        } else {
          await this.handleStart(ctx);
        }
        return;
      }
      
      if (type === 'mock') {
        // Start mock interview wizard - ask for domain first
        ctx.session.interviewMode = 'mock';
        ctx.session.interviewStep = 'domain';
        
        const domainText: Record<string, string> = {
          uz: `🎯 <b>Mock Intervyu Boshlash</b>

Qaysi sohada intervyu olishni xohlaysiz?

📝 <i>Quyidagi tugmalardan birini tanlang:</i>`,
          
          ru: `🎯 <b>Начать Mock Интервью</b>

В какой области хотите пройти интервью?

📝 <i>Выберите одну из кнопок ниже:</i>`,
          
          en: `🎯 <b>Start Mock Interview</b>

Which domain would you like to practice?

📝 <i>Select one of the buttons below:</i>`,
        };
        
        const domainKeyboard = new InlineKeyboard()
          .text('💻 Frontend', 'mock_domain_frontend')
          .text('⚙️ Backend', 'mock_domain_backend')
          .row()
          .text('🔄 Full Stack', 'mock_domain_fullstack')
          .text('📱 Mobile', 'mock_domain_mobile')
          .row()
          .text('🤖 AI/ML', 'mock_domain_ai')
          .text('☁️ DevOps', 'mock_domain_devops')
          .row()
          .text('❌ Bekor qilish', 'interview_cancel');
        
        await ctx.reply(domainText[lang] || domainText.en, {
          parse_mode: 'HTML',
          reply_markup: domainKeyboard,
        });
        
        this.logger.log(`Mock interview wizard started - domain selection`);
        return;
      } 
      
      if (type === 'live') {
        // Start live interview flow
        await this.liveService.handleStartLive(ctx);
        return;
      }
      
      // Unknown interview type
      this.logger.warn(`Unknown interview type: ${type}`);
      return;
    }

    // ============================================================
    // POSITION SELECTION
    // ============================================================
    if (callbackData.startsWith('position_')) {
      const position = callbackData.replace('position_', '');
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }
      
      try {
        // Update user profile with position
        await this.usersService.updateProfile((user as any).id || (user as any)._id?.toString(), {
          jobRole: position,
        } as any);
        
        const confirmText: Record<string, string> = {
          uz: `✅ Lavozim o'rnatildi: <b>${position}</b>`,
          ru: `✅ Должность установлена: <b>${position}</b>`,
          en: `✅ Position set: <b>${position}</b>`,
        };
        
        await ctx.reply(confirmText[lang] || confirmText.en, { parse_mode: 'HTML' });
        
        this.logger.log(`User ${telegramId} updated position to: ${position}`);
      } catch (error: any) {
        this.logger.error(`Failed to update position: ${error.message}`);
        await ctx.reply('❌ Failed to update position');
      }
      
      return;
    }

    // ============================================================
    // MOCK INTERVIEW WIZARD - DOMAIN SELECTION
    // ============================================================
    if (callbackData.startsWith('mock_domain_')) {
      const domain = callbackData.replace('mock_domain_', '');
      ctx.session.interviewDomain = domain;
      ctx.session.interviewStep = 'technology';
      
      const techText: Record<string, string> = {
        uz: `✅ Soha: <b>${domain}</b>

💻 Qaysi texnologiya/til bo'yicha intervyu olishni xohlaysiz?

📝 <i>Quyidagi tugmalardan birini tanlang:</i>`,
        
        ru: `✅ Область: <b>${domain}</b>

💻 Какую технологию/язык хотите практиковать?

📝 <i>Выберите одну из кнопок ниже:</i>`,
        
        en: `✅ Domain: <b>${domain}</b>

💻 Which technology/language would you like to practice?

📝 <i>Select one of the buttons below:</i>`,
      };
      
      // Technology keyboard based on domain
      const techKeyboard = new InlineKeyboard();
      
      if (domain === 'frontend') {
        techKeyboard
          .text('⚛️ React', 'mock_tech_react')
          .text('🅰️ Angular', 'mock_tech_angular')
          .row()
          .text('💚 Vue.js', 'mock_tech_vue')
          .text('🔷 TypeScript', 'mock_tech_typescript')
          .row();
      } else if (domain === 'backend') {
        techKeyboard
          .text('🟢 Node.js', 'mock_tech_nodejs')
          .text('🐍 Python', 'mock_tech_python')
          .row()
          .text('☕ Java', 'mock_tech_java')
          .text('🔶 Go', 'mock_tech_go')
          .row();
      } else if (domain === 'mobile') {
        techKeyboard
          .text('📱 React Native', 'mock_tech_react_native')
          .text('🍎 Swift', 'mock_tech_swift')
          .row()
          .text('🤖 Kotlin', 'mock_tech_kotlin')
          .text('🎯 Flutter', 'mock_tech_flutter')
          .row();
      } else if (domain === 'ai') {
        techKeyboard
          .text('🐍 Python/ML', 'mock_tech_python_ml')
          .text('🧠 TensorFlow', 'mock_tech_tensorflow')
          .row()
          .text('🔥 PyTorch', 'mock_tech_pytorch')
          .text('📊 Data Science', 'mock_tech_data_science')
          .row();
      } else if (domain === 'devops') {
        techKeyboard
          .text('🐳 Docker', 'mock_tech_docker')
          .text('☸️ Kubernetes', 'mock_tech_kubernetes')
          .row()
          .text('☁️ AWS', 'mock_tech_aws')
          .text('🔵 Azure', 'mock_tech_azure')
          .row();
      } else {
        // Full Stack or other domains
        techKeyboard
          .text('⚛️ React', 'mock_tech_react')
          .text('🟢 Node.js', 'mock_tech_nodejs')
          .row()
          .text('🐍 Python', 'mock_tech_python')
          .text('☕ Java', 'mock_tech_java')
          .row();
      }
      
      techKeyboard.text('❌ Bekor qilish', 'interview_cancel');
      
      await ctx.reply(techText[lang] || techText.en, {
        parse_mode: 'HTML',
        reply_markup: techKeyboard,
      });
      
      return;
    }

    // ============================================================
    // MOCK INTERVIEW WIZARD - TECHNOLOGY SELECTION
    // ============================================================
    if (callbackData.startsWith('mock_tech_')) {
      const technology = callbackData.replace('mock_tech_', '');
      ctx.session.interviewTechnology = technology;
      ctx.session.interviewStep = 'duration';
      
      const durationText: Record<string, string> = {
        uz: `✅ Texnologiya: <b>${technology}</b>

⏱️ Intervyu davomiyligini tanlang:

📌 <i>Davomiyligi qancha savollar berilishini belgilaydi</i>`,
        
        ru: `✅ Технология: <b>${technology}</b>

⏱️ Выберите продолжительность интервью:

📌 <i>Продолжительность определяет количество вопросов</i>`,
        
        en: `✅ Technology: <b>${technology}</b>

⏱️ Choose interview duration:

📌 <i>Duration determines the number of questions</i>`,
      };
      
      const durationKeyboard = new InlineKeyboard()
        .text('⚡ Tez (5-7 savol)', 'mock_duration_quick')
        .row()
        .text('📊 Standart (10-12 savol)', 'mock_duration_standard')
        .row()
        .text('🎯 Chuqur (15-20 savol)', 'mock_duration_deep_dive')
        .row()
        .text('❌ Bekor qilish', 'interview_cancel');
      
      await ctx.reply(durationText[lang] || durationText.en, {
        parse_mode: 'HTML',
        reply_markup: durationKeyboard,
      });
      
      return;
    }

    // ============================================================
    // MOCK INTERVIEW WIZARD - DURATION & START INTERVIEW
    // ============================================================
    if (callbackData.startsWith('mock_duration_')) {
      const duration = callbackData.replace('mock_duration_', '') as 'quick' | 'standard' | 'deep_dive';
      ctx.session.interviewDuration = duration;
      
      // Get user to check plan limits
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }
      
      // Check mock interview limit
      const canProceed = await this.subscriptionService.checkMockInterviewLimit(ctx, user, lang);
      if (!canProceed) {
        return; // Limit reached, error message already sent
      }
      
      // Get user position (for difficulty level)
      const position = user.profile?.position || 'junior';
      
      // Prepare StartInterviewDto
      const startDto = {
        type: 'technical',
        difficulty: position === 'lead' ? 'senior' : position, // Map lead to senior
        domain: ctx.session.interviewDomain || 'general',
        technology: [ctx.session.interviewTechnology || 'general'],
        interviewDuration: duration,
        mode: 'text', // Default to text mode
        language: lang,
      };
      
      // Show loading message while questions are being generated
      const loadingText: Record<string, string> = {
        uz: '⏳ <b>Intervyu tayyorlanmoqda...</b>\n\nSavollar yaratilmoqda, bir necha soniya kuting.',
        ru: '⏳ <b>Подготовка интервью...</b>\n\nВопросы генерируются, подождите несколько секунд.',
        en: '⏳ <b>Preparing interview...</b>\n\nGenerating questions, please wait a few seconds.',
      };
      const loadingMsg = await ctx.reply(loadingText[lang] || loadingText.en, {
        parse_mode: 'HTML',
      });
      
      try {
        // Start the interview
        const userId = (user as any).id || (user as any)._id?.toString();
        const session = await this.interviewsService.startInterview(userId, startDto as any);
        
        // Delete loading message
        try {
          if (ctx.chat?.id) {
            await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id);
          }
        } catch (deleteError) {
          // Silent fail - message might be already deleted
        }
        
        // Save session ID to context
        ctx.session.currentInterviewSessionId = session.id;
        ctx.session.currentQuestionIndex = 0;
        ctx.session.interviewStep = 'answering';
        
        // Get first question from session
        // Session has questions array populated
        const sessionWithQuestions = await this.interviewsService.getSession(userId, session.id);
        const questions = sessionWithQuestions.questions as any[];
        
        // Check if questions exist
        if (!questions || questions.length === 0) {
          const noQuestionsText: Record<string, string> = {
            uz: `❌ <b>Savollar yaratilmadi</b>

Texnik xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.

Yoki boshqa soha/texnologiya tanlang.`,
            ru: `❌ <b>Вопросы не созданы</b>

Произошла техническая ошибка. Пожалуйста, попробуйте снова.

Или выберите другую область/технологию.`,
            en: `❌ <b>No questions created</b>

A technical error occurred. Please try again.

Or select a different domain/technology.`,
          };
          
          await ctx.reply(noQuestionsText[lang] || noQuestionsText.en, {
            parse_mode: 'HTML',
          });
          
          // Reset session
          ctx.session.interviewMode = undefined;
          ctx.session.interviewStep = undefined;
          return;
        }
        
        const firstQuestion = questions[0];
        
        const startText: Record<string, string> = {
          uz: `🎯 <b>Mock Intervyu Boshlandi!</b>

📋 Intervyu ma'lumotlari:
• Soha: ${ctx.session.interviewDomain}
• Texnologiya: ${ctx.session.interviewTechnology}
• Davomiyligi: ${duration === 'quick' ? 'Tez' : duration === 'standard' ? 'Standart' : 'Chuqur'}
• Savollar soni: ${session.numQuestions}

━━━━━━━━━━━━━━━━━━

<b>Savol ${session.currentQuestionIndex + 1}/${session.numQuestions}:</b>

${firstQuestion.question || firstQuestion.text || 'Savol yuklanmoqda...'}

${firstQuestion.codeSnippet || firstQuestion.sampleAnswer ? `\n\`\`\`\n${firstQuestion.codeSnippet || firstQuestion.sampleAnswer}\n\`\`\`\n` : ''}

💡 <i>Javobingizni yozing yoki ovozli xabar yuboring</i>`,
          
          ru: `🎯 <b>Mock Интервью Начато!</b>

📋 Информация об интервью:
• Область: ${ctx.session.interviewDomain}
• Технология: ${ctx.session.interviewTechnology}
• Продолжительность: ${duration === 'quick' ? 'Быстрое' : duration === 'standard' ? 'Стандартное' : 'Глубокое'}
• Количество вопросов: ${session.numQuestions}

━━━━━━━━━━━━━━━━━━

<b>Вопрос ${session.currentQuestionIndex + 1}/${session.numQuestions}:</b>

${firstQuestion.question || firstQuestion.text || 'Вопрос загружается...'}

${firstQuestion.codeSnippet || firstQuestion.sampleAnswer ? `\n\`\`\`\n${firstQuestion.codeSnippet || firstQuestion.sampleAnswer}\n\`\`\`\n` : ''}

💡 <i>Напишите ответ или отправьте голосовое сообщение</i>`,
          
          en: `🎯 <b>Mock Interview Started!</b>

📋 Interview Details:
• Domain: ${ctx.session.interviewDomain}
• Technology: ${ctx.session.interviewTechnology}
• Duration: ${duration === 'quick' ? 'Quick' : duration === 'standard' ? 'Standard' : 'Deep Dive'}
• Questions: ${session.numQuestions}

━━━━━━━━━━━━━━━━━━

<b>Question ${session.currentQuestionIndex + 1}/${session.numQuestions}:</b>

${firstQuestion.question || firstQuestion.text || 'Loading question...'}

${firstQuestion.codeSnippet || firstQuestion.sampleAnswer ? `\n\`\`\`\n${firstQuestion.codeSnippet || firstQuestion.sampleAnswer}\n\`\`\`\n` : ''}

💡 <i>Type your answer or send a voice message</i>`,
        };
        
        const answerKeyboard = new InlineKeyboard()
          .text('⏭️ Skip', `skip_question_${session.id}`)
          .text('🛑 End Interview', `end_interview_${session.id}`);
        
        await ctx.reply(startText[lang] || startText.en, {
          parse_mode: 'HTML',
          reply_markup: answerKeyboard,
        });
        
        this.logger.log(`Mock interview started: session ${session.id} for user ${userId}`);
      } catch (error: any) {
        this.logger.error(`Failed to start mock interview: ${error.message}`);
        
        const errorText: Record<string, string> = {
          uz: `❌ Intervyu boshlanmadi. Iltimos, qaytadan urinib ko'ring.

${error.message || 'Noma\'lum xatolik'}`,
          ru: `❌ Не удалось начать интервью. Пожалуйста, попробуйте снова.

${error.message || 'Неизвестная ошибка'}`,
          en: `❌ Failed to start interview. Please try again.

${error.message || 'Unknown error'}`,
        };
        
        await ctx.reply(errorText[lang] || errorText.en, {
          parse_mode: 'HTML',
        });
      }
      
      return;
    }

    // ============================================================
    // SKIP QUESTION HANDLER
    // ============================================================
    if (callbackData.startsWith('skip_question_')) {
      const sessionId = callbackData.replace('skip_question_', '');
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }
      
      const userId = (user as any).id || (user as any)._id?.toString();
      
      try {
        // Get current session and question
        const currentSession = await this.interviewsService.getSession(userId, sessionId);
        const currentQuestion = (currentSession.questions as any)[currentSession.currentQuestionIndex];
        
        // Skip current question (submit empty answer)
        await this.interviewsService.submitAnswer(userId, sessionId, {
          questionId: currentQuestion._id?.toString() || currentQuestion.id?.toString(),
          answerText: '[SKIPPED]',
          answerType: 'text',
          duration: 0,
        });
        
        // Get next question
        const session = await this.interviewsService.getSession(userId, sessionId);
        
        if (session.status === 'completed') {
          const finishText: Record<string, string> = {
            uz: `🎉 <b>Mock Intervyu Yakunlandi!</b>

Tabriklaymiz! Siz barcha savollarga javob berdingiz.

📊 Natijalaringizni ko'rish uchun /profile buyrug'idan foydalaning.`,
            
            ru: `🎉 <b>Mock Интервью Завершено!</b>

Поздравляем! Вы ответили на все вопросы.

📊 Используйте /profile чтобы посмотреть результаты.`,
            
            en: `🎉 <b>Mock Interview Completed!</b>

Congratulations! You've completed all questions.

📊 Use /profile to view your results.`,
          };
          
          await ctx.reply(finishText[lang] || finishText.en, { parse_mode: 'HTML' });
          
          // Clear session
          ctx.session.interviewStep = undefined;
          ctx.session.currentInterviewSessionId = undefined;
          ctx.session.currentQuestionIndex = undefined;
          
          await this.showMainMenu(ctx, user);
          return;
        }
        
        const sessionAfterSkip = await this.interviewsService.getSession(userId, sessionId);
        const nextQuestion = (sessionAfterSkip.questions as any)[sessionAfterSkip.currentQuestionIndex];
        ctx.session.currentQuestionIndex = sessionAfterSkip.currentQuestionIndex;
        
        const skipText: Record<string, string> = {
          uz: `⏭️ <b>Savol o'tkazib yuborildi</b>

<b>Savol ${sessionAfterSkip.currentQuestionIndex + 1}/${sessionAfterSkip.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}`,
          
          ru: `⏭️ <b>Вопрос пропущен</b>

<b>Вопрос ${sessionAfterSkip.currentQuestionIndex + 1}/${sessionAfterSkip.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}`,
          
          en: `⏭️ <b>Question Skipped</b>

<b>Question ${sessionAfterSkip.currentQuestionIndex + 1}/${sessionAfterSkip.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}`,
        };
        
        const keyboard = new InlineKeyboard()
          .text('⏭️ Skip', `skip_question_${sessionId}`)
          .text('🛑 End Interview', `end_interview_${sessionId}`);
        
        await ctx.reply(skipText[lang] || skipText.en, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        
      } catch (error: any) {
        this.logger.error(`Failed to skip question: ${error.message}`);
        await ctx.reply('❌ Error skipping question');
      }
      
      return;
    }

    // ============================================================
    // END INTERVIEW HANDLER
    // ============================================================
    if (callbackData.startsWith('end_interview_')) {
      const sessionId = callbackData.replace('end_interview_', '');
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }
      
      const userId = (user as any).id || (user as any)._id?.toString();
      
      try {
        // End the interview session
        await this.interviewsService.completeSession(userId, sessionId);
        
        const endText: Record<string, string> = {
          uz: `🛑 <b>Intervyu To'xtatildi</b>

Intervyu yakunlandi. Natijalaringizni ko'rish uchun /profile buyrug'idan foydalaning.`,
          
          ru: `🛑 <b>Интервью Остановлено</b>

Интервью завершено. Используйте /profile чтобы посмотреть результаты.`,
          
          en: `🛑 <b>Interview Ended</b>

Interview session has been ended. Use /profile to view your results.`,
        };
        
        await ctx.reply(endText[lang] || endText.en, { parse_mode: 'HTML' });
        
        // Clear session state
        ctx.session.interviewStep = undefined;
        ctx.session.currentInterviewSessionId = undefined;
        ctx.session.currentQuestionIndex = undefined;
        ctx.session.interviewDomain = undefined;
        ctx.session.interviewTechnology = undefined;
        ctx.session.interviewDuration = undefined;
        
        // Show main menu
        await this.showMainMenu(ctx, user);
        
      } catch (error: any) {
        this.logger.error(`Failed to end interview: ${error.message}`);
        await ctx.reply('❌ Error ending interview');
      }
      
      return;
    }

    // ============================================================
    // SETTINGS CALLBACKS
    // ============================================================
    if (callbackData === 'set_position') {
      await this.handleSetPosition(ctx);
      return;
    }
    
    if (callbackData === 'voice_quota') {
      await this.handleVoice(ctx);
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

    // Check for menu button texts (Reply Keyboard)
    // Includes both current and legacy button texts for backward compatibility
    const menuMap: Record<string, string> = {
      // Interview buttons
      '🎯 Intervyu': 'interview',
      '🎯 Interview': 'interview',
      '🎯 Интервью': 'interview',
      
      // Tasks buttons
      '📋 Vazifalar': 'tasks',
      '📋 Tasks': 'tasks',
      '📋 Задания': 'tasks',
      
      // Profile buttons (current and legacy)
      '👤 Profil': 'profile',
      '👤 Profile': 'profile',
      '👤 Профиль': 'profile',
      '📊 Profil': 'profile',  // Legacy
      '📊 Profile': 'profile',  // Legacy
      '📊 Профиль': 'profile',  // Legacy
      
      // Upgrade/Tariff buttons
      '💳 Tarif': 'upgrade',
      '💳 Plans': 'upgrade',
      '💳 Тарифы': 'upgrade',
      '💳 Tariflar': 'upgrade',  // Legacy
      
      // Help buttons (legacy - not in current inline menu)
      '❓ Yordam': 'help',
      '❓ Help': 'help',
      '❓ Помощь': 'help',
      'ℹ️ Yordam': 'help',  // Legacy
      'ℹ️ Help': 'help',  // Legacy
      'ℹ️ Помощь': 'help',  // Legacy
      
      // Settings buttons (legacy)
      '⚙️ Sozlamalar': 'settings',
      '⚙️ Settings': 'settings',
      '⚙️ Настройки': 'settings',
      
      // CV Analysis buttons (legacy)
      '📄 CV Tahlil': 'cv',
      '📄 CV Analysis': 'cv',
      '📄 Анализ CV': 'cv',
      
      // Statistics buttons (legacy)
      '📈 Statistika': 'stats',
      '📈 Statistics': 'stats',
      '📈 Статистика': 'stats',
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
        case 'help':
          await this.handleHelp(ctx);
          return true;
        case 'settings':
          await this.handleSettings(ctx);
          return true;
        case 'cv':
          await this.handleAnalyzeCv(ctx);
          return true;
        case 'stats':
          await this.handleStats(ctx);
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
    const text = ctx.message?.text;
    
    if (!text) {
      return;
    }
    
    // Check if user is currently answering a mock interview question
    if (ctx.session?.interviewStep === 'answering' && ctx.session?.currentInterviewSessionId) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      
      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }
      
      const userId = (user as any).id || (user as any)._id?.toString();
      const sessionId = ctx.session.currentInterviewSessionId;
      
      try {
        // Show processing message
        const processingText: Record<string, string> = {
          uz: '⏳ Javobingiz tahlil qilinmoqda...',
          ru: '⏳ Анализируем ваш ответ...',
          en: '⏳ Analyzing your answer...',
        };
        await ctx.reply(processingText[lang] || processingText.en);
        
        // Get current session and question
        const currentSession = await this.interviewsService.getSession(userId, sessionId);
        const currentQuestion = (currentSession.questions as any)[currentSession.currentQuestionIndex];
        
        // Submit the answer
        await this.interviewsService.submitAnswer(userId, sessionId, {
          questionId: currentQuestion._id?.toString() || currentQuestion.id?.toString(),
          answerText: text,
          answerType: 'text',
          duration: 60, // Default 60 seconds for text answers
        });
        
        // Get next question or finish interview
        const session = await this.interviewsService.getSession(userId, sessionId);
        
        if (session.status === 'completed') {
          // Interview finished
          const finishText: Record<string, string> = {
            uz: `🎉 <b>Mock Intervyu Yakunlandi!</b>

Tabriklaymiz! Siz barcha savollarga javob berdingiz.

📊 Natijalaringizni ko'rish uchun /profile buyrug'idan foydalaning.`,
            
            ru: `🎉 <b>Mock Интервью Завершено!</b>

Поздравляем! Вы ответили на все вопросы.

📊 Используйте /profile чтобы посмотреть результаты.`,
            
            en: `🎉 <b>Mock Interview Completed!</b>

Congratulations! You've answered all questions.

📊 Use /profile to view your results.`,
          };
          
          await ctx.reply(finishText[lang] || finishText.en, {
            parse_mode: 'HTML',
          });
          
          // Clear session state
          ctx.session.interviewStep = undefined;
          ctx.session.currentInterviewSessionId = undefined;
          ctx.session.currentQuestionIndex = undefined;
          ctx.session.interviewDomain = undefined;
          ctx.session.interviewTechnology = undefined;
          ctx.session.interviewDuration = undefined;
          
          // Show main menu
          await this.showMainMenu(ctx, user);
          return;
        }
        
        // Get next question
        const updatedSession = await this.interviewsService.getSession(userId, sessionId);
        const nextQuestion = (updatedSession.questions as any)[updatedSession.currentQuestionIndex];
        ctx.session.currentQuestionIndex = updatedSession.currentQuestionIndex;
        
        const nextText: Record<string, string> = {
          uz: `✅ <b>Javob qabul qilindi!</b>

━━━━━━━━━━━━━━━━━━

<b>Savol ${updatedSession.currentQuestionIndex + 1}/${updatedSession.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}

💡 <i>Javobingizni yozing yoki ovozli xabar yuboring</i>`,
          
          ru: `✅ <b>Ответ принят!</b>

━━━━━━━━━━━━━━━━━━

<b>Вопрос ${updatedSession.currentQuestionIndex + 1}/${updatedSession.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}

💡 <i>Напишите ответ или отправьте голосовое сообщение</i>`,
          
          en: `✅ <b>Answer received!</b>

━━━━━━━━━━━━━━━━━━

<b>Question ${updatedSession.currentQuestionIndex + 1}/${updatedSession.numQuestions}:</b>

${nextQuestion.text}

${nextQuestion.codeSnippet ? `\n\`\`\`\n${nextQuestion.codeSnippet}\n\`\`\`\n` : ''}

💡 <i>Type your answer or send a voice message</i>`,
        };
        
        const answerKeyboard = new InlineKeyboard()
          .text('⏭️ Skip', `skip_question_${sessionId}`)
          .text('🛑 End Interview', `end_interview_${sessionId}`);
        
        await ctx.reply(nextText[lang] || nextText.en, {
          parse_mode: 'HTML',
          reply_markup: answerKeyboard,
        });
        
      } catch (error: any) {
        this.logger.error(`Failed to submit answer: ${error.message}`);
        
        const errorText: Record<string, string> = {
          uz: `❌ Javob yuborishda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.`,
          ru: `❌ Ошибка при отправке ответа. Пожалуйста, попробуйте снова.`,
          en: `❌ Failed to submit answer. Please try again.`,
        };
        
        await ctx.reply(errorText[lang] || errorText.en);
      }
      
      return;
    }
    
    // Default fallback
    const processingText: Record<string, string> = {
      uz: '⏳ Intervyu jarayonida...',
      ru: '⏳ Интервью в процессе...',
      en: '⏳ Interview in progress...',
    };
    await ctx.reply(processingText[lang] || processingText.en);
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
