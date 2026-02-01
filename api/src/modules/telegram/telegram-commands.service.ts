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
      cv: { uz: '📄 CV Tahlil', ru: '📄 Анализ CV', en: '📄 CV Analysis' },
      profile: { uz: '👤 Profil', ru: '👤 Профиль', en: '👤 Profile' },
      upgrade: { uz: '💳 Tarif', ru: '💳 Тарифы', en: '💳 Plans' },
      help: { uz: '❓ Yordam', ru: '❓ Помощь', en: '❓ Help' },
    };

    // Inline keyboard (message buttons) - ALL main features
    const inlineKeyboard = new InlineKeyboard()
      .text(buttonLabels.interview[lang] || buttonLabels.interview.en, 'menu_interview')
      .text(buttonLabels.tasks[lang] || buttonLabels.tasks.en, 'menu_tasks')
      .text(buttonLabels.cv[lang] || buttonLabels.cv.en, 'menu_cv')
      .row()
      .text(buttonLabels.profile[lang] || buttonLabels.profile.en, 'menu_profile')
      .text(buttonLabels.upgrade[lang] || buttonLabels.upgrade.en, 'menu_upgrade')
      .row()
      .text(buttonLabels.help[lang] || buttonLabels.help.en, 'menu_help');

    // Reply keyboard (persistent bottom keyboard) - SAME buttons as inline
    const replyKeyboard = new Keyboard()
      .text(buttonLabels.interview[lang] || buttonLabels.interview.en)
      .text(buttonLabels.tasks[lang] || buttonLabels.tasks.en)
      .text(buttonLabels.cv[lang] || buttonLabels.cv.en)
      .row()
      .text(buttonLabels.profile[lang] || buttonLabels.profile.en)
      .text(buttonLabels.upgrade[lang] || buttonLabels.upgrade.en)
      .row()
      .text(buttonLabels.help[lang] || buttonLabels.help.en)
      .resized()
      .persistent();

    // Send main menu with inline keyboard (for nice clickable UI)
    await ctx.reply(menuText[lang] || menuText['en'], {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
    
    // Also set the persistent reply keyboard at bottom (invisible separator message)
    // This ensures ReplyKeyboard matches InlineKeyboard buttons
    await ctx.reply('·', {
      reply_markup: replyKeyboard,
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
      
      // Get usage stats
      const mockInterviews = user.usage?.mockInterviewsThisMonth || 0;
      const totalMockInterviews = user.usage?.totalMockInterviews || 0;
      const liveMinutes = user.usage?.liveInterviewMinutesThisMonth || 0;
      const totalLiveMinutes = user.usage?.totalLiveInterviewMinutes || 0;
      const cvAnalyses = user.usage?.cvAnalysesThisMonth || 0;
      const totalCvAnalyses = user.usage?.totalCvAnalyses || 0;
      const streak = user.dailyTasks?.currentStreak || 0;
      const maxStreak = user.dailyTasks?.maxStreak || 0;
      
      const statsText: Record<string, string> = {
        uz: `📊 <b>Statistika</b>

📈 <b>Bu oylik:</b>
• Mock intervyular: ${mockInterviews}
• Live intervyu: ${liveMinutes} daq
• CV tahlillari: ${cvAnalyses}
• 🔥 Streak: ${streak} kun

📊 <b>Jami:</b>
• Mock intervyular: ${totalMockInterviews}
• Live intervyu: ${totalLiveMinutes} daq
• CV tahlillari: ${totalCvAnalyses}
• 🔥 Eng uzun streak: ${maxStreak} kun`,
        
        ru: `📊 <b>Статистика</b>

📈 <b>За месяц:</b>
• Mock-интервью: ${mockInterviews}
• Live-интервью: ${liveMinutes} мин
• Анализов CV: ${cvAnalyses}
• 🔥 Серия: ${streak} дней

📊 <b>Всего:</b>
• Mock-интервью: ${totalMockInterviews}
• Live-интервью: ${totalLiveMinutes} мин
• Анализов CV: ${totalCvAnalyses}
• 🔥 Макс. серия: ${maxStreak} дней`,
        
        en: `📊 <b>Statistics</b>

📈 <b>This Month:</b>
• Mock interviews: ${mockInterviews}
• Live interviews: ${liveMinutes} min
• CV analyses: ${cvAnalyses}
• 🔥 Streak: ${streak} days

📊 <b>Total:</b>
• Mock interviews: ${totalMockInterviews}
• Live interviews: ${totalLiveMinutes} min
• CV analyses: ${totalCvAnalyses}
• 🔥 Max streak: ${maxStreak} days`,
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
      
      try {
        // Start the interview
        const userId = (user as any).id || (user as any)._id?.toString();
        const session = await this.interviewsService.startInterview(userId, startDto as any);
        
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

${firstQuestion.text}

${firstQuestion.codeSnippet ? `\n\`\`\`\n${firstQuestion.codeSnippet}\n\`\`\`\n` : ''}

💡 <i>Javobingizni yozing yoki ovozli xabar yuboring</i>`,
          
          ru: `🎯 <b>Mock Интервью Начато!</b>

📋 Информация об интервью:
• Область: ${ctx.session.interviewDomain}
• Технология: ${ctx.session.interviewTechnology}
• Продолжительность: ${duration === 'quick' ? 'Быстрое' : duration === 'standard' ? 'Стандартное' : 'Глубокое'}
• Количество вопросов: ${session.numQuestions}

━━━━━━━━━━━━━━━━━━

<b>Вопрос ${session.currentQuestionIndex + 1}/${session.numQuestions}:</b>

${firstQuestion.text}

${firstQuestion.codeSnippet ? `\n\`\`\`\n${firstQuestion.codeSnippet}\n\`\`\`\n` : ''}

💡 <i>Напишите ответ или отправьте голосовое сообщение</i>`,
          
          en: `🎯 <b>Mock Interview Started!</b>

📋 Interview Details:
• Domain: ${ctx.session.interviewDomain}
• Technology: ${ctx.session.interviewTechnology}
• Duration: ${duration === 'quick' ? 'Quick' : duration === 'standard' ? 'Standard' : 'Deep Dive'}
• Questions: ${session.numQuestions}

━━━━━━━━━━━━━━━━━━

<b>Question ${session.currentQuestionIndex + 1}/${session.numQuestions}:</b>

${firstQuestion.text}

${firstQuestion.codeSnippet ? `\n\`\`\`\n${firstQuestion.codeSnippet}\n\`\`\`\n` : ''}

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
