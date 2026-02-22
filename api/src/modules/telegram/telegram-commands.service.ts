import { Injectable, Logger, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { UsersRepository } from '../users/users.repository';
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
import { ProfileNormalizationService } from '../engagement/profile-normalization.service';

@Injectable()
export class TelegramCommandsService {
  private readonly logger = new Logger(TelegramCommandsService.name);
  private readonly openai: OpenAI | null;

  constructor(
    private readonly usersService: UsersService,
    private readonly usersRepository: UsersRepository,
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
    @Inject(forwardRef(() => UnregisteredUserService))
    private readonly unregisteredUserService: UnregisteredUserService,
    @Inject(forwardRef(() => ProfileNormalizationService))
    private readonly profileNormalizationService: ProfileNormalizationService,
  ) {
    // Initialize OpenAI client with support for both OpenAI and OpenRouter
    this.openai = createOpenAIClient(this.configService);
  }

  /**
   * Get user language with proper fallback chain and session sync
   * Priority: user.preferences.language > user.language > session.language > 'uz'
   * ALWAYS sync the user's database language to session
   */
  private getUserLanguage(ctx: BotContext, user: any): string {
    // Priority 1: User preferences language (most reliable)
    let lang = user?.preferences?.language;

    // Priority 2: User language field
    if (!lang && user?.language) {
      lang = user.language;
    }

    // Priority 3: Session language (fallback)
    if (!lang && ctx.session?.language) {
      lang = ctx.session.language;
    }

    // Priority 4: Default to Uzbek
    if (!lang) {
      lang = 'uz';
    }

    // CRITICAL: Always sync user's language to session
    // This ensures menu and messages are always in correct language
    if (ctx.session) {
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

      // FIX #110: Clean welcome — short greeting in 3 languages + language selection
      // Full bot description is shown AFTER language is selected (in user's language)
      const welcomeText =
        `👋 <b>Assalomu alaykum!</b>\n` +
        `Здравствуйте!\n` +
        `Hello!\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🌍 <b>Tilni tanlang:</b>\n` +
        `Выберите язык:\n` +
        `Select your language:`;

      const langKeyboard = new InlineKeyboard()
        .text("🇺🇿 O'zbek", 'lang_uz')
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
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
      free_trial: '🆓',
      starter: '💎',
      pro: '🚀',
      elite: '👑',
    };
    const planNames: Record<string, Record<string, string>> = {
      free_trial: { uz: 'Bepul sinov', ru: 'Пробный', en: 'Free Trial' },
      starter: { uz: 'Starter', ru: 'Starter', en: 'Starter' },
      pro: { uz: 'Pro', ru: 'Pro', en: 'Pro' },
      elite: { uz: 'Elite', ru: 'Elite', en: 'Elite' },
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
   * Routes users based on their subscription plan:
   * - Free users: Show upgrade prompt
   * - Premium users (starter/pro/elite): Show monthly stats and today's tasks
   *
   * SENIOR LOGIC:
   * 1. Validate subscription status (active, not expired)
   * 2. Check plan-specific permissions from COMPLETE_PLAN_LIMITS
   * 3. Route based on actual feature access, not hard-coded plan name
   */
  async handleTasks(ctx: BotContext) {
    try {
      const telegramId = ctx.from?.id as number;
      this.logger.debug(`/tasks command received from telegramId: ${telegramId}`);

      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        this.logger.warn(`User not found for telegramId: ${telegramId}`);
        const lang = ctx.session?.language || 'uz';
        const notRegisteredText: Record<string, string> = {
          uz: `Iltimos avval /start buyrug'i bilan ro'yxatdan o'ting`,
          ru: `Пожалуйста, сначала зарегистрируйтесь используя /start`,
          en: `Please register first using /start`,
        };
        await ctx.reply(notRegisteredText[lang] || notRegisteredText['uz']);
        return;
      }

      const lang = this.getUserLanguage(ctx, user);
      const userId = (user as any)._id?.toString() || (user as any).id?.toString();

      // CRITICAL FIX: Check subscription status and expiry
      const subscription = user.subscription;
      const plan = subscription?.plan || 'free_trial';
      const subscriptionStatus = subscription?.status || 'inactive';
      const endDate = subscription?.endDate;
      const now = new Date();

      // Check if subscription is expired
      const isExpired = endDate && new Date(endDate) < now;
      const isActive = subscriptionStatus === 'active' && !isExpired;

      this.logger.log(
        `/tasks command - user: ${userId}, plan: ${plan}, status: ${subscriptionStatus}, active: ${isActive}`,
      );

      // SENIOR LOGIC: Use COMPLETE_PLAN_LIMITS to check feature access
      const planLimits = COMPLETE_PLAN_LIMITS[plan] || COMPLETE_PLAN_LIMITS.free_trial;
      const hasPremiumAccess =
        planLimits.dailyTasks.enabled &&
        (plan === 'starter' || plan === 'pro' || plan === 'elite') &&
        isActive;

      // Show upgrade prompt for free users OR expired premium users
      if (!hasPremiumAccess) {
        this.logger.log(
          `User ${userId} (plan: ${plan}, active: ${isActive}) lacks premium access - showing upgrade prompt`,
        );
        await this.dailyTaskService.showUpgradePrompt(ctx, user);
        return;
      }

      // Premium users with active subscription see monthly stats and tasks
      this.logger.log(
        `Premium user ${userId} (plan: ${plan}) accessing /tasks - showing monthly overview`,
      );
      await this.dailyTaskService.showMonthlyStats(ctx, userId);
    } catch (error: any) {
      this.logger.error(`Failed to handle tasks: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'uz';
      const errorText: Record<string, string> = {
        uz: `❌ Xatolik yuz berdi. Iltimos qayta urinib ko'ring.`,
        ru: `❌ Произошла ошибка. Пожалуйста, попробуйте снова.`,
        en: `❌ Error occurred. Please try again.`,
      };
      await ctx.reply(errorText[lang] || errorText['uz']);
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

      // 🔧 CRITICAL FIX: Check if position needs confirmation
      // If user still has default 'junior' and never confirmed, show position prompt FIRST
      const needsPositionConfirmation =
        user.profile?.position === 'junior' && user.engagement?.positionConfirmed !== true;

      if (needsPositionConfirmation) {
        this.logger.log(
          `User ${user._id} viewing profile - unconfirmed junior position, showing position prompt`,
        );

        // Send position selection prompt
        const positionPromptText = {
          uz:
            '👋 Assalomu alaykum!\n\n' +
            "📊 <b>Lavozimingizni aniqlashdan oldin profil ko'rsatilmaydi.</b>\n\n" +
            "<b>O'zingiz haqingizda qisqacha yozing yoki quyidagi tugmalardan birini tanlang.</b>\n" +
            '<i>Masalan: "Men 3 yillik tajribaga ega React dasturchiman"</i>\n\n' +
            'Bu savollarga mos javoblar olishingiz uchun muhim.',
          ru:
            '👋 Здравствуйте!\n\n' +
            '📊 <b>Профиль не будет показан до подтверждения должности.</b>\n\n' +
            '<b>Напишите кратко о себе или выберите вариант ниже.</b>\n' +
            '<i>Пример: "Я React разработчик с 3 годами опыта"</i>\n\n' +
            'Это важно для подбора подходящих вопросов.',
          en:
            '👋 Hello!\n\n' +
            "📊 <b>Profile won't be shown until position is confirmed.</b>\n\n" +
            '<b>Write briefly about yourself or select an option below.</b>\n' +
            '<i>Example: "I am a Senior React Developer with 3 years experience"</i>\n\n' +
            'This is important to provide you with appropriate questions.',
        };

        const positionButtons = {
          uz: {
            junior: '🌱 Junior (0-2 yil)',
            middle: '💼 Middle (2-5 yil)',
            senior: '🎯 Senior (5+ yil)',
            lead: '👑 Lead/Architect',
          },
          ru: {
            junior: '🌱 Junior (0-2 года)',
            middle: '💼 Middle (2-5 лет)',
            senior: '🎯 Senior (5+ лет)',
            lead: '👑 Lead/Architect',
          },
          en: {
            junior: '🌱 Junior (0-2 years)',
            middle: '💼 Middle (2-5 years)',
            senior: '🎯 Senior (5+ years)',
            lead: '👑 Lead/Architect',
          },
        };

        const keyboard = new InlineKeyboard()
          .text(positionButtons[lang].junior, 'confirm_position_junior')
          .text(positionButtons[lang].middle, 'confirm_position_middle')
          .row()
          .text(positionButtons[lang].senior, 'confirm_position_senior')
          .text(positionButtons[lang].lead, 'confirm_position_lead');

        await ctx.reply(positionPromptText[lang] || positionPromptText.uz, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });

        // Set session state to wait for description
        if (ctx.session) {
          ctx.session.profileUpdateStep = 'waiting_for_description';
        }

        // Mark as prompted (prevent spam)
        await this.usersRepository.updateRaw((user._id as any).toString(), {
          $set: {
            'engagement.scheduledPositionPromptAt': null,
          },
        });

        return; // Don't show profile until position is confirmed
      }

      // Get plan and limits
      const plan = user.subscription?.plan || 'free_trial';
      const planNames: Record<string, Record<string, string>> = {
        free_trial: { uz: '🆓 Bepul sinov', ru: '🆓 Пробный', en: '🆓 Free Trial' },
        starter: { uz: '💎 Starter', ru: '💎 Starter', en: '💎 Starter' },
        pro: { uz: '🚀 Pro', ru: '🚀 Pro', en: '🚀 Pro' },
        elite: { uz: '👑 Elite', ru: '👑 Elite', en: '👑 Elite' },
      };
      const planName = planNames[plan]?.[lang] || plan;

      // Get plan limits
      const limits =
        COMPLETE_PLAN_LIMITS[plan as keyof typeof COMPLETE_PLAN_LIMITS] ||
        COMPLETE_PLAN_LIMITS.free_trial;

      // Interview counts (not minutes!)
      const mockInterviewLimit = limits.mockInterviews.perMonth;
      const cvAnalysisLimit = limits.cvAnalysis.perMonth;

      // Voice quotas (minutes)
      const mockVoiceTotal = limits.voice.mockVoice;
      const realVoiceTotal = limits.voice.realVoice;

      // Daily tasks features
      const dailyTasksEnabled = limits.dailyTasks.enabled;
      const dailyTasksVoiceAllowed = limits.dailyTasks.voiceAnswer;
      const dailyTasksImageAllowed = limits.dailyTasks.imageAnswer;
      const dailyTasksVideoAllowed = limits.dailyTasks.videoAnswer;

      // Get current usage
      const mockInterviewsUsed = user.usage?.mockInterviewsThisMonth || 0;
      const cvAnalysesUsed = user.usage?.cvAnalysesThisMonth || 0;

      // Get voice quota usage
      const mockVoiceUsed = user.voiceQuota?.mockVoice?.used || 0;
      const mockVoiceRemaining = user.voiceQuota?.mockVoice?.remaining || 0;
      const realVoiceUsed = user.voiceQuota?.realVoice?.used || 0;
      const realVoiceRemaining = user.voiceQuota?.realVoice?.remaining || 0;

      // Format limits display
      const mockInterviewLimitText = mockInterviewLimit === -1 ? '∞' : mockInterviewLimit;
      const cvAnalysisLimitText = cvAnalysisLimit === -1 ? '∞' : cvAnalysisLimit;
      const mockVoiceLimitText = mockVoiceTotal === -1 ? '∞' : mockVoiceTotal;
      const realVoiceLimitText = realVoiceTotal === -1 ? '∞' : realVoiceTotal;

      const profileText = {
        uz:
          `👤 <b>Profil</b>\n\n` +
          `Ism: ${user.firstName} ${user.lastName}\n` +
          `Telefon: ${user.phoneNumber}\n` +
          `Lavozim: ${user.profile?.position || 'Aniqlanmagan'}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💳 <b>Tarif: ${planName}</b>\n\n` +
          `📊 <b>Bu oylik limitlar:</b>\n` +
          `• Mock intervyular: ${mockInterviewsUsed}/${mockInterviewLimitText} ta\n` +
          `• CV tahlillari: ${cvAnalysesUsed}/${cvAnalysisLimitText} ta\n\n` +
          `🎤 <b>Ovozli daqiqalar:</b>\n` +
          `• Mock practice: ${mockVoiceUsed}/${mockVoiceLimitText} daq (${mockVoiceRemaining} qoldi)\n` +
          `  └ Mock intervyu + Vazifa javoblari\n` +
          `• Live yordam: ${realVoiceUsed}/${realVoiceLimitText} daq (${realVoiceRemaining} qoldi)\n` +
          `  └ Haqiqiy intervyu yordami\n\n` +
          `📝 <b>Kunlik vazifalar:</b>\n` +
          `• Streak: ${user.dailyTasks?.currentStreak || 0} kun 🔥\n` +
          `• Ovozli javob: ${dailyTasksVoiceAllowed ? '✅ Ruxsat berilgan' : '❌ Faqat yuqori planlarda'}\n` +
          `• Rasm javob: ${dailyTasksImageAllowed ? '✅ Ruxsat berilgan' : '❌ Faqat yuqori planlarda'}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        ru:
          `👤 <b>Профиль</b>\n\n` +
          `Имя: ${user.firstName} ${user.lastName}\n` +
          `Телефон: ${user.phoneNumber}\n` +
          `Должность: ${user.profile?.position || 'Не указана'}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💳 <b>Тариф: ${planName}</b>\n\n` +
          `📊 <b>Лимиты за месяц:</b>\n` +
          `• Mock-интервью: ${mockInterviewsUsed}/${mockInterviewLimitText} шт\n` +
          `• Анализы CV: ${cvAnalysesUsed}/${cvAnalysisLimitText} шт\n\n` +
          `🎤 <b>Голосовые минуты:</b>\n` +
          `• Mock practice: ${mockVoiceUsed}/${mockVoiceLimitText} мин (${mockVoiceRemaining} осталось)\n` +
          `  └ Mock-интервью + Ответы на задачи\n` +
          `• Live помощь: ${realVoiceUsed}/${realVoiceLimitText} мин (${realVoiceRemaining} осталось)\n` +
          `  └ Помощь в реальном интервью\n\n` +
          `📝 <b>Ежедневные задачи:</b>\n` +
          `• Серия: ${user.dailyTasks?.currentStreak || 0} дней 🔥\n` +
          `• Голосовой ответ: ${dailyTasksVoiceAllowed ? '✅ Разрешено' : '❌ Только в высших планах'}\n` +
          `• Ответ картинкой: ${dailyTasksImageAllowed ? '✅ Разрешено' : '❌ Только в высших планах'}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        en:
          `👤 <b>Profile</b>\n\n` +
          `Name: ${user.firstName} ${user.lastName}\n` +
          `Phone: ${user.phoneNumber}\n` +
          `Position: ${user.profile?.position || 'Not set'}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💳 <b>Plan: ${planName}</b>\n\n` +
          `📊 <b>Monthly Limits:</b>\n` +
          `• Mock interviews: ${mockInterviewsUsed}/${mockInterviewLimitText} count\n` +
          `• CV analyses: ${cvAnalysesUsed}/${cvAnalysisLimitText} count\n\n` +
          `🎤 <b>Voice Minutes:</b>\n` +
          `• Mock practice: ${mockVoiceUsed}/${mockVoiceLimitText} min (${mockVoiceRemaining} left)\n` +
          `  └ Mock interviews + Task answers\n` +
          `• Live assistance: ${realVoiceUsed}/${realVoiceLimitText} min (${realVoiceRemaining} left)\n` +
          `  └ Real interview help\n\n` +
          `📝 <b>Daily Tasks:</b>\n` +
          `• Streak: ${user.dailyTasks?.currentStreak || 0} days 🔥\n` +
          `• Voice answer: ${dailyTasksVoiceAllowed ? '✅ Allowed' : '❌ Higher plans only'}\n` +
          `• Image answer: ${dailyTasksImageAllowed ? '✅ Allowed' : '❌ Higher plans only'}\n` +
          `━━━━━━━━━━━━━━━━━━`,
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
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
      uz:
        `💳 <b>Tariflar</b>\n\n` +
        `🆓 <b>Free Trial</b> - 7 kun\n` +
        `• ${freeLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
        `• ${freeLimits.voice.mockVoice} daqiqa mock ovoz\n` +
        `• ${freeLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
        `• Faqat matn javoblari\n\n` +
        `💎 <b>Starter</b> - $10/oy\n` +
        `• ${starterLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
        `• ${starterLimits.voice.mockVoice} daq mock + ${starterLimits.voice.realVoice} daq live ovoz\n` +
        `• ${starterLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
        `• 1 ta kunlik topshiriq\n\n` +
        `🚀 <b>Pro</b> - $20/oy\n` +
        `• ${proLimits.mockInterviews.perMonth} ta mock intervyu/oy\n` +
        `• ${proLimits.voice.mockVoice} daq mock + ${proLimits.voice.realVoice} daq live ovoz\n` +
        `• ${proLimits.cvAnalysis.perMonth} ta CV tahlili\n` +
        `• Haftalik AI tavsiyalar\n\n` +
        `👑 <b>Elite</b> - $30/oy\n` +
        `• Cheksiz mock intervyu\n` +
        `• ${eliteLimits.voice.mockVoice} daq mock + ${eliteLimits.voice.realVoice} daq live ovoz\n` +
        `• Cheksiz CV tahlili\n` +
        `• 2 ta kunlik topshiriq\n` +
        `• Priority support\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📞 Tarif o'zgartirish uchun @interviewai_support_bot ga murojaat qiling`,

      ru:
        `💳 <b>Тарифы</b>\n\n` +
        `🆓 <b>Free Trial</b> - 7 дней\n` +
        `• ${freeLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
        `• ${freeLimits.voice.mockVoice} мин mock-голос\n` +
        `• ${freeLimits.cvAnalysis.perMonth} анализа CV\n` +
        `• Только текстовые ответы\n\n` +
        `💎 <b>Starter</b> - $10/мес\n` +
        `• ${starterLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
        `• ${starterLimits.voice.mockVoice} мин mock + ${starterLimits.voice.realVoice} мин live голос\n` +
        `• ${starterLimits.cvAnalysis.perMonth} анализов CV\n` +
        `• 1 ежедневное задание\n\n` +
        `🚀 <b>Pro</b> - $20/мес\n` +
        `• ${proLimits.mockInterviews.perMonth} mock-интервью/мес\n` +
        `• ${proLimits.voice.mockVoice} мин mock + ${proLimits.voice.realVoice} мин live голос\n` +
        `• ${proLimits.cvAnalysis.perMonth} анализов CV\n` +
        `• Еженедельные AI рекомендации\n\n` +
        `👑 <b>Elite</b> - $30/мес\n` +
        `• Безлимит mock-интервью\n` +
        `• ${eliteLimits.voice.mockVoice} мин mock + ${eliteLimits.voice.realVoice} мин live голос\n` +
        `• Безлимит анализов CV\n` +
        `• 2 ежедневных задания\n` +
        `• Приоритетная поддержка\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📞 Для изменения тарифа обратитесь в @interviewai_support_bot`,

      en:
        `💳 <b>Plans</b>\n\n` +
        `🆓 <b>Free Trial</b> - 7 days\n` +
        `• ${freeLimits.mockInterviews.perMonth} mock interviews/mo\n` +
        `• ${freeLimits.voice.mockVoice} min mock voice\n` +
        `• ${freeLimits.cvAnalysis.perMonth} CV analyses\n` +
        `• Text answers only\n\n` +
        `💎 <b>Starter</b> - $10/month\n` +
        `• ${starterLimits.mockInterviews.perMonth} mock interviews/mo\n` +
        `• ${starterLimits.voice.mockVoice} min mock + ${starterLimits.voice.realVoice} min live voice\n` +
        `• ${starterLimits.cvAnalysis.perMonth} CV analyses\n` +
        `• 1 daily task\n\n` +
        `🚀 <b>Pro</b> - $20/month\n` +
        `• ${proLimits.mockInterviews.perMonth} mock interviews/mo\n` +
        `• ${proLimits.voice.mockVoice} min mock + ${proLimits.voice.realVoice} min live voice\n` +
        `• ${proLimits.cvAnalysis.perMonth} CV analyses\n` +
        `• Weekly AI recommendations\n\n` +
        `👑 <b>Elite</b> - $30/month\n` +
        `• Unlimited mock interviews\n` +
        `• ${eliteLimits.voice.mockVoice} min mock + ${eliteLimits.voice.realVoice} min live voice\n` +
        `• Unlimited CV analyses\n` +
        `• 2 daily tasks\n` +
        `• Priority support\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📞 To change your plan, contact @interviewai_support_bot`,
    };

    // Add inline keyboard with support bot link
    const keyboard = new InlineKeyboard().url(
      '📞 Support Bot',
      'https://t.me/interviewai_support_bot',
    );

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
        uz:
          `🎤 <b>Ovozli xabar limiti</b>\n\n` +
          `Mock: ${voiceQuota?.mockVoice?.remaining || 0}/${voiceQuota?.mockVoice?.total || 0} daqiqa\n` +
          `Live: ${voiceQuota?.realVoice?.remaining || 0}/${voiceQuota?.realVoice?.total || 0} daqiqa\n\n` +
          `Yangilanish: ${voiceQuota?.mockVoice?.resetDate ? new Date(voiceQuota.mockVoice.resetDate).toLocaleDateString('uz-UZ') : 'N/A'}`,
        ru:
          `🎤 <b>Лимит голосовых сообщений</b>\n\n` +
          `Mock: ${voiceQuota?.mockVoice?.remaining || 0}/${voiceQuota?.mockVoice?.total || 0} мин\n` +
          `Live: ${voiceQuota?.realVoice?.remaining || 0}/${voiceQuota?.realVoice?.total || 0} мин\n\n` +
          `Обновление: ${voiceQuota?.mockVoice?.resetDate ? new Date(voiceQuota.mockVoice.resetDate).toLocaleDateString('ru-RU') : 'N/A'}`,
        en:
          `🎤 <b>Voice Quota Status</b>\n\n` +
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
      uz:
        `❓ <b>Yordam</b>\n\n` +
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
      ru:
        `❓ <b>Помощь</b>\n\n` +
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
      en:
        `❓ <b>Help</b>\n\n` +
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
    const keyboard = new InlineKeyboard().url(
      '📞 Support Bot',
      'https://t.me/interviewai_support_bot',
    );

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
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
      uz: "📈 Progress tracking tez orada qo'shiladi!",
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
          uz: "❌ Telefon raqami topilmadi. Iltimos qayta urinib ko'ring.",
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

        this.logger.log(
          `Existing user ${telegramId} logged in with phone ${phoneNumber.substring(0, 5)}***`,
        );
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
• 7 kun bepul
• 1 ta mock intervyu
• 2 daqiqa ovozli javoblar
• 1 ta CV tahlil

Keling, boshlaymiz! 🚀`,

        ru: `🎉 <b>Добро пожаловать, ${user.firstName || user.telegramUsername || 'пользователь'}!</b>

✅ Вы успешно зарегистрированы!

📊 <b>Пробный период:</b>
• 7 дней бесплатно
• 1 пробное интервью
• 2 минуты голосовых ответов
• 1 анализ CV

Давайте начнем! 🚀`,

        en: `🎉 <b>Welcome, ${user.firstName || user.telegramUsername || 'user'}!</b>

✅ You've successfully registered!

📊 <b>Free trial:</b>
• 7 days free
• 1 mock interview
• 2 minutes voice answers
• 1 CV analysis

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

      this.logger.log(
        `New user ${telegramId} registered with phone ${phoneNumber.substring(0, 5)}***`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to handle contact message: ${error.message}`, error.stack);
      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: "❌ Xatolik yuz berdi. Iltimos /start bosib qayta urinib ko'ring.",
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

      if (
        !allowedExtensions.includes(fileExtension || '') &&
        !allowedMimeTypes.includes(mimeType)
      ) {
        const invalidFileText: Record<string, string> = {
          uz: "❌ Noto'g'ri fayl formati. Faqat PDF, DOCX, DOC yoki TXT fayllar qabul qilinadi.",
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

        const buttonLabels = {
          uz: { view: "📊 CV tahlilini ko'rish", back: '🔙 Menyuga qaytish' },
          ru: { view: '📊 Анализ CV', back: '🔙 В меню' },
          en: { view: '📊 View CV Analysis', back: '🔙 Back to Menu' },
        };

        const viewKeyboard = new InlineKeyboard()
          .text(buttonLabels[lang]?.view || buttonLabels['en'].view, 'cv_view')
          .row()
          .text(buttonLabels[lang]?.back || buttonLabels['en'].back, 'back_to_menu');

        // Check if CV was uploaded for interview flow
        if (ctx.session.interviewStep === 'waiting_cv' && ctx.session.interviewMode === 'mock') {
          // Auto-analyze CV synchronously and redirect to interview
          const analyzingText: Record<string, string> = {
            uz: `✅ CV yuklandi! Tahlil qilinmoqda...\n\n<i>Intervyu tahlildan keyin boshlanadi</i>`,
            ru: `✅ CV загружен! Анализируем...\n\n<i>Интервью начнётся после анализа</i>`,
            en: `✅ CV uploaded! Analyzing...\n\n<i>Interview will start after analysis</i>`,
          };
          const analyzeMsg = await ctx.reply(analyzingText[lang] || analyzingText.en, {
            parse_mode: 'HTML',
          });

          try {
            const userId = (user as any)._id?.toString() || (user as any).id?.toString();
            await this.cvService.analyzeCv(userId, (cv as any).id, { language: lang });
            // Delete analyzing message
            try {
              if (ctx.chat?.id) await ctx.api.deleteMessage(ctx.chat.id, analyzeMsg.message_id);
            } catch { /* silent */ }

            // Re-fetch updated user+CV and show interview confirmation
            const updatedUser = await this.usersService.findByTelegramId(telegramId);
            const analyzedCv = await this.cvService.getUserLatestCv(userId);
            if (analyzedCv?.analysis && updatedUser) {
              await this.showCvInterviewConfirmation(ctx, updatedUser, analyzedCv, lang);
            } else {
              await this.showManualDomainSelection(ctx, lang);
            }
          } catch (analyzeError: any) {
            this.logger.error(`CV auto-analyze for interview failed: ${analyzeError.message}`);
            try {
              if (ctx.chat?.id) await ctx.api.deleteMessage(ctx.chat.id, analyzeMsg.message_id);
            } catch { /* silent */ }
            // Fallback to manual wizard
            await this.showManualDomainSelection(ctx, lang);
          }
          this.logger.log(`CV uploaded for interview flow for user ${telegramId}: ${(cv as any).id}`);
          return;
        }

        // Normal CV upload flow (not for interview)
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

        // FIX #103: Handle ForbiddenException (trial expired / limit reached)
        // with user-friendly localized message + upgrade button instead of
        // raw English error text
        if (uploadError instanceof ForbiddenException) {
          this.logger.warn(`CV upload blocked for user ${user?.telegramId}: ${uploadError.message}`);

          const isTrialExpired = uploadError.message?.includes('trial has expired');
          const isLimitReached = uploadError.message?.includes('limit reached');

          const blockedText: Record<string, string> = isTrialExpired
            ? {
                uz: `⏰ <b>Bepul sinov muddatingiz tugagan</b>\n\nCV tahlili xizmatidan foydalanish uchun tarifga o'ting.\n\n💎 STARTER — $10/oy (5 ta CV tahlili)\n🚀 PRO — $20/oy (15 ta CV tahlili)\n👑 ELITE — $30/oy (cheksiz)`,
                ru: `⏰ <b>Ваш пробный период истёк</b>\n\nДля использования анализа CV перейдите на платный тариф.\n\n💎 STARTER — $10/мес (5 анализов CV)\n🚀 PRO — $20/мес (15 анализов CV)\n👑 ELITE — $30/мес (безлимитно)`,
                en: `⏰ <b>Your free trial has expired</b>\n\nUpgrade to continue using CV analysis.\n\n💎 STARTER — $10/mo (5 CV analyses)\n🚀 PRO — $20/mo (15 CV analyses)\n👑 ELITE — $30/mo (unlimited)`,
              }
            : isLimitReached
              ? {
                  uz: `📊 <b>CV tahlili limiti tugadi</b>\n\nBu oylik CV tahlili limitingiz tugagan. Yuqori tarifga o'tib davom eting.\n\n🚀 PRO — $20/oy (15 ta CV tahlili)\n👑 ELITE — $30/oy (cheksiz)`,
                  ru: `📊 <b>Лимит анализа CV исчерпан</b>\n\nВаш месячный лимит анализа CV исчерпан. Перейдите на более высокий тариф.\n\n🚀 PRO — $20/мес (15 анализов CV)\n👑 ELITE — $30/мес (безлимитно)`,
                  en: `📊 <b>CV analysis limit reached</b>\n\nYour monthly CV analysis limit is exhausted. Upgrade to continue.\n\n🚀 PRO — $20/mo (15 CV analyses)\n👑 ELITE — $30/mo (unlimited)`,
                }
              : {
                  uz: `⚠️ <b>CV tahlili mavjud emas</b>\n\n${uploadError.message}\n\nTarifga o'tish uchun tugmani bosing.`,
                  ru: `⚠️ <b>Анализ CV недоступен</b>\n\n${uploadError.message}\n\nНажмите кнопку для перехода на тариф.`,
                  en: `⚠️ <b>CV analysis unavailable</b>\n\n${uploadError.message}\n\nClick the button to upgrade.`,
                };

          const upgradeBtnText: Record<string, string> = {
            uz: "⬆️ Tariflarni ko'rish",
            ru: '⬆️ Посмотреть тарифы',
            en: '⬆️ View Plans',
          };

          const upgradeKeyboard = new InlineKeyboard().text(
            upgradeBtnText[lang] || upgradeBtnText['en'],
            'show_plans',
          );

          await ctx.reply(blockedText[lang] || blockedText['en'], {
            parse_mode: 'HTML',
            reply_markup: upgradeKeyboard,
          });
          return;
        }

        this.logger.error(`Failed to upload CV: ${uploadError.message}`, uploadError.stack);

        const uploadErrorText: Record<string, string> = {
          uz: `❌ <b>CV yuklashda xatolik yuz berdi</b>\n\nIltimos, qayta urinib ko'ring yoki boshqa fayl yuboring.`,
          ru: `❌ <b>Ошибка при загрузке CV</b>\n\nПожалуйста, попробуйте снова или отправьте другой файл.`,
          en: `❌ <b>Error uploading CV</b>\n\nPlease try again or send a different file.`,
        };

        await ctx.reply(uploadErrorText[lang] || uploadErrorText['en'], {
          parse_mode: 'HTML',
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to handle document message: ${error.message}`, error.stack);

      const errorText: Record<string, string> = {
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
        await ctx.reply(
          notRegisteredText[ctx.session?.language || 'en'] || notRegisteredText['en'],
        );
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

        const noCvButtonLabels = {
          uz: { upload: '📤 CV yuklash', back: '🔙 Menyuga qaytish' },
          ru: { upload: '📤 Загрузить CV', back: '🔙 В меню' },
          en: { upload: '📤 Upload CV', back: '🔙 Back to Menu' },
        };

        const uploadKeyboard = new InlineKeyboard()
          .text(noCvButtonLabels[lang]?.upload || noCvButtonLabels['en'].upload, 'cv_upload')
          .row()
          .text(noCvButtonLabels[lang]?.back || noCvButtonLabels['en'].back, 'back_to_menu');

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

        const pendingButtonLabels = {
          uz: { checkStatus: '🔄 Statusni tekshirish', back: '🔙 Menyuga qaytish' },
          ru: { checkStatus: '🔄 Проверить статус', back: '🔙 В меню' },
          en: { checkStatus: '🔄 Check Status', back: '🔙 Back to Menu' },
        };

        const pendingKeyboard = new InlineKeyboard()
          .text(
            pendingButtonLabels[lang]?.checkStatus || pendingButtonLabels['en'].checkStatus,
            'cv_view',
          )
          .row()
          .text(pendingButtonLabels[lang]?.back || pendingButtonLabels['en'].back, 'back_to_menu');

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
        const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(
          ctx,
          user,
          lang,
          false,
        );

        const failedButtonLabels = {
          uz: {
            reanalyze: '🔄 Qayta tahlil qilish',
            upload: '📤 Yangi CV yuklash',
            back: '🔙 Menyuga qaytish',
          },
          ru: {
            reanalyze: '🔄 Повторный анализ',
            upload: '📤 Загрузить новое CV',
            back: '🔙 В меню',
          },
          en: {
            reanalyze: '🔄 Re-analyze',
            upload: '📤 Upload New CV',
            back: '🔙 Back to Menu',
          },
        };

        const failedKeyboard = new InlineKeyboard();
        if (canReanalyze) {
          failedKeyboard.text(
            failedButtonLabels[lang]?.reanalyze || failedButtonLabels['en'].reanalyze,
            'cv_reanalyze',
          );
        }
        failedKeyboard.text(
          failedButtonLabels[lang]?.upload || failedButtonLabels['en'].upload,
          'cv_upload',
        );
        failedKeyboard
          .row()
          .text(failedButtonLabels[lang]?.back || failedButtonLabels['en'].back, 'back_to_menu');

        await ctx.reply(failedText[lang] || failedText['en'], {
          parse_mode: 'HTML',
          reply_markup: failedKeyboard,
        });
        return;
      }

      // Analysis completed - show results (SUMMARY VIEW)
      const analysis = cv.analysis;

      // ✅ FIX: Use correct field names from schema
      const atsScore = analysis?.atsScore || 0;
      const overallRating = analysis?.overallRating || 0; // ✅ NOT overallScore
      const strengths = analysis?.strengths || [];
      const weaknesses = analysis?.weaknesses || analysis?.criticalWeaknesses || []; // ✅ NOT improvements
      const quickWins = analysis?.quickWins || [];

      // Convert overallRating (1-5) to percentage for display
      const displayScore = Math.round((overallRating / 5) * 100);

      // Format score with emoji
      const scoreEmoji = displayScore >= 80 ? '🟢' : displayScore >= 60 ? '🟡' : '🔴';

      // Format strengths (top 3 for summary)
      const strengthsText =
        strengths.length > 0
          ? strengths
              .slice(0, 3)
              .map((s: string, i: number) => `${i + 1}. ${s}`)
              .join('\n')
          : {
              uz: 'Kuchli tomonlar aniqlanmadi',
              ru: 'Сильные стороны не определены',
              en: 'No specific strengths identified',
            }[lang] || 'No specific strengths identified';

      // Format weaknesses (top 3 for summary)
      const weaknessesText =
        weaknesses.length > 0
          ? weaknesses
              .slice(0, 3)
              .map((w: string, i: number) => `${i + 1}. ${w}`)
              .join('\n')
          : {
              uz: 'Kamchiliklar topilmadi',
              ru: 'Слабости не найдены',
              en: 'No weaknesses identified',
            }[lang] || 'No weaknesses identified';

      const resultsText: Record<string, string> = {
        uz: `📊 <b>CV Tahlili Natijalari</b>

📄 Fayl: <code>${cv.fileName}</code>
📅 Sana: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Umumiy baho:</b> ${displayScore}/100
📊 <b>ATS Ball:</b> ${atsScore}/100

💪 <b>Kuchli tomonlar:</b>
${strengthsText}

⚠️ <b>Yaxshilash kerak:</b>
${weaknessesText}

<i>To'liq tahlilni ko'rish uchun "📋 To'liq tahlil" tugmasini bosing</i>`,
        ru: `📊 <b>Результаты Анализа CV</b>

📄 Файл: <code>${cv.fileName}</code>
📅 Дата: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Общая оценка:</b> ${displayScore}/100
📊 <b>ATS Балл:</b> ${atsScore}/100

💪 <b>Сильные стороны:</b>
${strengthsText}

⚠️ <b>Требует улучшения:</b>
${weaknessesText}

<i>Нажмите "📋 Полный анализ" для просмотра полного анализа</i>`,
        en: `📊 <b>CV Analysis Results</b>

📄 File: <code>${cv.fileName}</code>
📅 Date: ${new Date(cv.analyzedAt || cv.updatedAt).toLocaleDateString(lang)}

${scoreEmoji} <b>Overall Score:</b> ${displayScore}/100
📊 <b>ATS Score:</b> ${atsScore}/100

💪 <b>Strengths:</b>
${strengthsText}

⚠️ <b>Areas for Improvement:</b>
${weaknessesText}

<i>Click "📋 Full Analysis" to view the complete analysis</i>`,
      };

      // Check if re-analysis is allowed
      const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(
        ctx,
        user,
        lang,
        false,
      );

      const summaryButtonLabels = {
        uz: {
          fullAnalysis: "📋 To'liq tahlil",
          reanalyze: '🔄 Qayta tahlil',
          uploadNew: '📤 Yangi CV yuklash',
          back: '🔙 Menyuga qaytish',
        },
        ru: {
          fullAnalysis: '📋 Полный анализ',
          reanalyze: '🔄 Повторный анализ',
          uploadNew: '📤 Загрузить новое CV',
          back: '🔙 В меню',
        },
        en: {
          fullAnalysis: '📋 Full Analysis',
          reanalyze: '🔄 Re-analyze',
          uploadNew: '📤 Upload New CV',
          back: '🔙 Back to Menu',
        },
      };

      const resultsKeyboard = new InlineKeyboard();
      resultsKeyboard.text(
        summaryButtonLabels[lang]?.fullAnalysis || summaryButtonLabels['en'].fullAnalysis,
        `cv_full_${cv.id}`,
      );
      resultsKeyboard.row();
      if (canReanalyze) {
        resultsKeyboard.text(
          summaryButtonLabels[lang]?.reanalyze || summaryButtonLabels['en'].reanalyze,
          'cv_reanalyze',
        );
      }
      resultsKeyboard.text(
        summaryButtonLabels[lang]?.uploadNew || summaryButtonLabels['en'].uploadNew,
        'cv_upload',
      );
      resultsKeyboard
        .row()
        .text(summaryButtonLabels[lang]?.back || summaryButtonLabels['en'].back, 'back_to_menu');

      await ctx.reply(resultsText[lang] || resultsText['en'], {
        parse_mode: 'HTML',
        reply_markup: resultsKeyboard,
      });
    } catch (error: any) {
      this.logger.error(`Failed to handle view CV: ${error.message}`, error.stack);

      const lang = ctx.session?.language || 'en';
      const errorText: Record<string, string> = {
        uz: "❌ Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.",
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
    if (
      callbackData.startsWith('live_domain_') ||
      callbackData.startsWith('live_tech_') ||
      callbackData.startsWith('live_position_')
    ) {
      await this.liveService.handleLiveMetadataCallback(ctx, callbackData);
      return;
    }

    // ============================================================
    // SUBSCRIPTION CALLBACKS - route to subscription service
    // ============================================================
    // FIX #102: Added 'menu_upgrade' — this callback is set in main menu keyboard
    // and daily task service but was never handled, causing silent no-op when pressed
    if (
      callbackData.startsWith('upgrade_') ||
      callbackData === 'show_plans' ||
      callbackData === 'menu_upgrade' ||
      callbackData === 'contact_support' ||
      callbackData === 'back_to_menu'
    ) {
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

      const handled = await this.subscriptionService.handleSubscriptionCallback(
        ctx,
        callbackData,
        lang,
      );
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

      if (callbackData === 'cv_upload' || callbackData === 'cv_upload_for_interview') {
        // Prompt user to upload new CV
        // If triggered from interview flow, mark session so after upload
        // the bot returns to interview instead of CV menu
        if (callbackData === 'cv_upload_for_interview') {
          ctx.session.interviewStep = 'waiting_cv';
          ctx.session.interviewMode = 'mock';
        }

        const isForInterview = callbackData === 'cv_upload_for_interview';
        const uploadText: Record<string, string> = {
          uz: `📤 <b>${isForInterview ? 'Intervyu uchun CV yuklash' : 'Yangi CV yuklash'}</b>\n\nHujjatni yuboring (PDF, DOCX, DOC, TXT)\n\n💡 Faylni shu chatga yuboring${isForInterview ? '\n\n<i>CV tahlilidan so\'ng intervyu avtomatik boshlanadi</i>' : ''}`,
          ru: `📤 <b>${isForInterview ? 'Загрузить CV для интервью' : 'Загрузить новый CV'}</b>\n\nОтправьте документ (PDF, DOCX, DOC, TXT)\n\n💡 Отправьте файл в этот чат${isForInterview ? '\n\n<i>После анализа CV интервью начнётся автоматически</i>' : ''}`,
          en: `📤 <b>${isForInterview ? 'Upload CV for Interview' : 'Upload New CV'}</b>\n\nSend a document (PDF, DOCX, DOC, TXT)\n\n💡 Send the file to this chat${isForInterview ? '\n\n<i>Interview will start automatically after CV analysis</i>' : ''}`,
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
          const canReanalyze = await this.subscriptionService.checkCvAnalysisLimit(
            ctx,
            user,
            userLang,
          );
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

            const reanalyzeButtonLabels = {
              uz: { view: "📊 Tahlilni ko'rish", back: '🔙 Menyuga qaytish' },
              ru: { view: '📊 Смотреть анализ', back: '🔙 В меню' },
              en: { view: '📊 View Analysis', back: '🔙 Back to Menu' },
            };

            const keyboard = new InlineKeyboard()
              .text(
                reanalyzeButtonLabels[userLang]?.view || reanalyzeButtonLabels['en'].view,
                'cv_view',
              )
              .row()
              .text(
                reanalyzeButtonLabels[userLang]?.back || reanalyzeButtonLabels['en'].back,
                'back_to_menu',
              );

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

            this.logger.error(
              `Failed to re-analyze CV: ${analyzeError.message}`,
              analyzeError.stack,
            );

            const errorText: Record<string, string> = {
              uz: `❌ <b>Tahlilda xatolik yuz berdi</b>\n\n${analyzeError.message || "Noma'lum xatolik"}`,
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

          // CRITICAL FIX: Use correct field names from schema
          const atsScore = analysis.atsScore || 0;
          const overallRating = analysis.overallRating || 0;
          const strengths = analysis.strengths || [];
          const weaknesses = analysis.weaknesses || analysis.criticalWeaknesses || [];
          const transformationRoadmap = analysis.transformationRoadmap || [];
          const quickWins = analysis.quickWins || [];
          const aiRejectionRisk = analysis.aiRejectionRisk || 'unknown';
          const sixSecondVerdict = analysis.sixSecondVerdict || 'unknown';

          // Calculate display score (use atsScore as primary)
          const displayScore = atsScore || overallRating * 20; // Convert 1-5 to 0-100 if needed

          this.logger.debug(
            `Displaying CV analysis - atsScore: ${atsScore}, overallRating: ${overallRating}, strengths: ${strengths.length}, weaknesses: ${weaknesses.length}`,
          );

          const fullAnalysisText: Record<string, string> = {
            uz: `━━━━━━━━━━━━━━━━━━
📋 <b>TO'LIQ CV TAHLILI</b>

📊 <b>ATS Ball:</b> ${displayScore}/100
⭐ <b>Umumiy baho:</b> ${overallRating}/5
⚠️ <b>AI Rad etish riski:</b> ${aiRejectionRisk}
👁 <b>6-soniya test:</b> ${sixSecondVerdict}

💪 <b>Kuchli tomonlar:</b>
${strengths.length > 0 ? strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') : 'Tahlil davom etmoqda...'}

⚠️ <b>Muhim kamchiliklar:</b>
${
  weaknesses.length > 0
    ? weaknesses
        .slice(0, 5)
        .map((w: string, i: number) => `${i + 1}. ${w}`)
        .join('\n')
    : 'Kamchilik topilmadi'
}

🚀 <b>Tezkor yaxshilashlar (Quick Wins):</b>
${quickWins.length > 0 ? quickWins.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n') : 'Tavsiyalar tayyorlanmoqda...'}

💡 <b>Transformation Roadmap:</b>
${
  transformationRoadmap.length > 0
    ? transformationRoadmap
        .slice(0, 3)
        .map((t: any, i: number) => `${i + 1}. [Priority ${t.priority}] ${t.problem}`)
        .join('\n')
    : 'Roadmap tayyorlanmoqda...'
}

━━━━━━━━━━━━━━━━━━`,
            ru: `━━━━━━━━━━━━━━━━━━
📋 <b>ПОЛНЫЙ АНАЛИЗ CV</b>

📊 <b>ATS Балл:</b> ${displayScore}/100
⭐ <b>Общая оценка:</b> ${overallRating}/5
⚠️ <b>Риск отказа AI:</b> ${aiRejectionRisk}
👁 <b>6-секундный тест:</b> ${sixSecondVerdict}

💪 <b>Сильные стороны:</b>
${strengths.length > 0 ? strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') : 'Анализ продолжается...'}

⚠️ <b>Критические слабости:</b>
${
  weaknesses.length > 0
    ? weaknesses
        .slice(0, 5)
        .map((w: string, i: number) => `${i + 1}. ${w}`)
        .join('\n')
    : 'Слабостей не найдено'
}

🚀 <b>Быстрые улучшения (Quick Wins):</b>
${quickWins.length > 0 ? quickWins.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n') : 'Рекомендации готовятся...'}

💡 <b>Transformation Roadmap:</b>
${
  transformationRoadmap.length > 0
    ? transformationRoadmap
        .slice(0, 3)
        .map((t: any, i: number) => `${i + 1}. [Приоритет ${t.priority}] ${t.problem}`)
        .join('\n')
    : 'Roadmap готовится...'
}

━━━━━━━━━━━━━━━━━━`,
            en: `━━━━━━━━━━━━━━━━━━
📋 <b>FULL CV ANALYSIS</b>

📊 <b>ATS Score:</b> ${displayScore}/100
⭐ <b>Overall Rating:</b> ${overallRating}/5
⚠️ <b>AI Rejection Risk:</b> ${aiRejectionRisk}
👁 <b>6-Second Test:</b> ${sixSecondVerdict}

💪 <b>Strengths:</b>
${strengths.length > 0 ? strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') : 'Analysis in progress...'}

⚠️ <b>Critical Weaknesses:</b>
${
  weaknesses.length > 0
    ? weaknesses
        .slice(0, 5)
        .map((w: string, i: number) => `${i + 1}. ${w}`)
        .join('\n')
    : 'No weaknesses found'
}

🚀 <b>Quick Wins:</b>
${quickWins.length > 0 ? quickWins.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n') : 'Recommendations preparing...'}

💡 <b>Transformation Roadmap:</b>
${
  transformationRoadmap.length > 0
    ? transformationRoadmap
        .slice(0, 3)
        .map((t: any, i: number) => `${i + 1}. [Priority ${t.priority}] ${t.problem}`)
        .join('\n')
    : 'Roadmap preparing...'
}

━━━━━━━━━━━━━━━━━━`,
          };

          const fullAnalysisButtonLabels = {
            uz: { backToSummary: '🔙 Qisqa tahlilga', mainMenu: '🏠 Asosiy menyu' },
            ru: { backToSummary: '🔙 Краткий анализ', mainMenu: '🏠 Главное меню' },
            en: { backToSummary: '🔙 Back to Summary', mainMenu: '🏠 Main Menu' },
          };

          const keyboard = new InlineKeyboard()
            .text(
              fullAnalysisButtonLabels[userLang]?.backToSummary ||
                fullAnalysisButtonLabels['en'].backToSummary,
              'cv_view',
            )
            .row()
            .text(
              fullAnalysisButtonLabels[userLang]?.mainMenu ||
                fullAnalysisButtonLabels['en'].mainMenu,
              'back_to_menu',
            );

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
    // DAILY TASK CALLBACKS
    // ============================================================
    if (callbackData.startsWith('daily_task_')) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      const userLang = this.getUserLanguage(ctx, user);
      const userId = (user as any)._id?.toString() || (user as any).id?.toString();

      // Handle "Show Today's Tasks" button
      if (callbackData === 'daily_task_today') {
        this.logger.log(`Showing today's tasks for user ${userId}`);
        await this.dailyTaskService.startDailyTaskSession(ctx, userId);
        return;
      }

      // Handle "Upgrade to Premium" button
      if (callbackData === 'daily_task_upgrade') {
        this.logger.log(`Free user ${userId} clicked upgrade from daily tasks`);
        await this.handleUpgrade(ctx);
        return;
      }

      // Handle "Answer Task N" buttons (daily_task_answer_0, daily_task_answer_1, etc.)
      if (callbackData.startsWith('daily_task_answer_')) {
        const taskIndexStr = callbackData.replace('daily_task_answer_', '');
        const taskIndex = parseInt(taskIndexStr, 10);

        // SENIOR VALIDATION: Strict input validation with security checks
        if (isNaN(taskIndex)) {
          this.logger.warn(`Invalid task index (NaN): ${taskIndexStr} from user ${userId}`);
          return;
        }

        // SECURITY: Prevent negative indices and unreasonably large indices (max 100 tasks per day)
        if (taskIndex < 0 || taskIndex > 100) {
          this.logger.warn(
            `Suspicious task index out of bounds: ${taskIndex} from user ${userId} - possible attack`,
          );
          return;
        }

        this.logger.log(`User ${userId} starting to answer task ${taskIndex}`);

        // Get today's tasks
        const dailyTask = await this.dailyTasksService.getTodayTasks(userId);

        if (!dailyTask) {
          this.logger.warn(`No daily tasks found for user ${userId}`);
          const noTasksText = {
            uz: '❌ Bugungi vazifalar topilmadi.',
            ru: '❌ Задания на сегодня не найдены.',
            en: '❌ No tasks found for today.',
          };
          await ctx.reply(noTasksText[userLang] || noTasksText.uz);
          return;
        }

        // SENIOR VALIDATION: Bounds check against actual array length
        if (taskIndex < 0 || taskIndex >= dailyTask.tasks.length) {
          this.logger.warn(
            `Task index ${taskIndex} out of bounds for user ${userId} (total: ${dailyTask.tasks.length})`,
          );
          const invalidTaskText = {
            uz: "❌ Noto'g'ri vazifa raqami.",
            ru: '❌ Неверный номер задания.',
            en: '❌ Invalid task number.',
          };
          await ctx.reply(invalidTaskText[userLang] || invalidTaskText.uz);
          return;
        }

        const task = dailyTask.tasks[taskIndex];

        if (task.completed) {
          const alreadyCompletedText = {
            uz: '✅ Bu vazifa allaqachon bajarilgan!',
            ru: '✅ Это задание уже выполнено!',
            en: '✅ This task is already completed!',
          };
          await ctx.reply(alreadyCompletedText[userLang] || alreadyCompletedText.uz);
          return;
        }

        // SENIOR FIX: Use public method instead of private property access
        const chatId = ctx.chat?.id;
        if (!chatId) {
          this.logger.error(`No chat ID available for user ${userId}`);
          return;
        }

        try {
          await this.dailyTaskService.setDailyTaskSession(
            chatId,
            userId,
            (dailyTask as any)._id.toString(),
            taskIndex,
            dailyTask.tasks.length,
            dailyTask.date,
          );
        } catch (sessionError: any) {
          this.logger.error(`Failed to set daily task session: ${sessionError.message}`);
          const errorText = {
            uz: "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
            ru: '❌ Произошла ошибка. Попробуйте снова.',
            en: '❌ Error occurred. Please try again.',
          };
          await ctx.reply(errorText[userLang] || errorText.uz);
          return;
        }

        // Show the specific task with answer instructions
        const plan = user.subscription?.plan || 'free_trial';
        const planLimits = COMPLETE_PLAN_LIMITS[plan] || COMPLETE_PLAN_LIMITS.free_trial;

        let answerInstructions = '';
        if (planLimits.dailyTasks.textAnswer) {
          answerInstructions +=
            userLang === 'uz'
              ? '✍️ Matn yozing'
              : userLang === 'ru'
                ? '✍️ Напишите текст'
                : '✍️ Type your answer';
        }
        if (planLimits.dailyTasks.voiceAnswer) {
          answerInstructions += answerInstructions ? '\n' : '';
          answerInstructions +=
            userLang === 'uz'
              ? '🎙️ Ovozli xabar yuboring'
              : userLang === 'ru'
                ? '🎙️ Отправьте голосовое'
                : '🎙️ Send voice message';
        }
        if (planLimits.dailyTasks.imageAnswer) {
          answerInstructions += answerInstructions ? '\n' : '';
          answerInstructions +=
            userLang === 'uz'
              ? '📸 Rasm yuboring'
              : userLang === 'ru'
                ? '📸 Отправьте фото'
                : '📸 Send image';
        }

        // FIX #91: HTML-escape task question to prevent parse errors
        // Questions may contain code samples with <, >, & characters
        const escapedQuestion = task.question
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        const taskPromptText = {
          uz: `📝 <b>Vazifa ${taskIndex + 1}:</b>

${escapedQuestion}

━━━━━━━━━━━━━━━━━━
<b>Javob berish usullari:</b>
${answerInstructions}

💡 Javobingizni yuboring!`,
          ru: `📝 <b>Задание ${taskIndex + 1}:</b>

${escapedQuestion}

━━━━━━━━━━━━━━━━━━
<b>Способы ответа:</b>
${answerInstructions}

💡 Отправьте ваш ответ!`,
          en: `📝 <b>Task ${taskIndex + 1}:</b>

${escapedQuestion}

━━━━━━━━━━━━━━━━━━
<b>Answer methods:</b>
${answerInstructions}

💡 Send your answer!`,
        };

        await ctx.reply(taskPromptText[userLang] || taskPromptText.uz, {
          parse_mode: 'HTML',
        });

        this.logger.log(`Task ${taskIndex} prompt shown to user ${userId}`);
        return;
      }

      return;
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

      // FIX #110: Show professional bot description in selected language + registration
      // Written in a human, conversational tone — not robotic bullet points
      const registrationText: Record<string, string> = {
        uz: `Ajoyib tanlov! 🎯

Men — <b>InterviewAI Pro</b>, sizning shaxsiy intervyu tayyorgarlik yordamchingizman.

Mening vazifam oddiy: sizni keyingi ishga kirish intervyusiga <b>to'liq tayyor qilish</b>. Qanday?

🎤 <b>Mock intervyular</b> — AI bilan haqiqiy intervyudek mashq qilasiz. Kuchli va zaif tomonlaringizni ko'rsataman.

📄 <b>CV tahlili</b> — rezyumeyingizni 100 ballik tizimda baholayman. Nimani tuzatish kerakligini aniq aytaman.

📝 <b>Kunlik vazifalar</b> — har kuni sizning sohangizdagi savollar yuboraman. 10-15 daqiqada bilimingizni mustahkamlaymiz.

🔴 <b>Live yordam</b> — haqiqiy intervyu paytida real vaqtda javoblar taklif qilaman.

Barchasi AI kuchi bilan — 24/7, sizning qulayligingiz uchun.

━━━━━━━━━━━━━━━━━━
🆓 <b>7 kunlik bepul sinov</b> — hoziroq boshlang!

Ro'yxatdan o'tish uchun telefon raqamingizni tasdiqlang 👇`,

        ru: `Отличный выбор! 🎯

Я — <b>InterviewAI Pro</b>, ваш персональный помощник по подготовке к собеседованиям.

Моя задача проста: <b>полностью подготовить вас</b> к следующему собеседованию. Как?

🎤 <b>Mock-интервью</b> — практикуетесь с AI как на настоящем собеседовании. Покажу сильные и слабые стороны.

📄 <b>Анализ CV</b> — оценю ваше резюме по 100-балльной системе. Точно скажу, что исправить.

📝 <b>Ежедневные задания</b> — каждый день присылаю вопросы по вашей специализации. 10-15 минут для закрепления знаний.

🔴 <b>Live-помощь</b> — подсказки в реальном времени прямо во время собеседования.

Всё на основе AI — 24/7, в удобное для вас время.

━━━━━━━━━━━━━━━━━━
🆓 <b>7 дней бесплатно</b> — начните прямо сейчас!

Для регистрации подтвердите номер телефона 👇`,

        en: `Great choice! 🎯

I'm <b>InterviewAI Pro</b>, your personal interview preparation assistant.

My job is simple: <b>fully prepare you</b> for your next job interview. How?

🎤 <b>Mock Interviews</b> — practice with AI just like a real interview. I'll show your strengths and areas to improve.

📄 <b>CV Analysis</b> — I'll score your resume on a 100-point system and tell you exactly what to fix.

📝 <b>Daily Tasks</b> — every day I send questions in your field. 10-15 minutes to sharpen your skills.

🔴 <b>Live Help</b> — real-time answer suggestions during actual interviews.

All powered by AI — 24/7, whenever it's convenient for you.

━━━━━━━━━━━━━━━━━━
🆓 <b>7-day free trial</b> — start right now!

To register, verify your phone number 👇`,
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
        // ================================================================
        // CV-FIRST MOCK INTERVIEW FLOW
        // ================================================================
        // Instead of asking domain → technology → duration manually,
        // we first check if user has an analyzed CV.  If yes, we use the
        // CV profile (domain, techStack, position) and skip the manual
        // wizard steps entirely.  If no CV exists, we ask user to upload.
        // ================================================================
        ctx.session.interviewMode = 'mock';

        const telegramId = ctx.from?.id as number;
        const user = await this.usersService.findByTelegramId(telegramId);
        if (!user) {
          await ctx.reply('Please register first using /start');
          return;
        }
        const userId = (user as any).id || (user as any)._id?.toString();

        try {
          const latestCv = await this.cvService.getUserLatestCv(userId);

          if (!latestCv) {
            // ── NO CV: Ask user to upload CV first ──
            const noCvText: Record<string, string> = {
              uz: `🎯 <b>Mock Intervyu</b>\n\nIntervyu savollarini sizning ko'nikmalaringizga moslash uchun avval CV yuklashingiz kerak.\n\nCV tahlili orqali biz:\n- Texnologiyalaringizni aniqlaymiz\n- Darajangizni (Junior/Middle/Senior) belgilaymiz\n- Ish yo'nalishingizni (Frontend/Backend/...) aniqlaymiz\n\n📎 <i>CV faylini (PDF/DOCX) shu yerga yuboring</i>`,
              ru: `🎯 <b>Mock Интервью</b>\n\nДля персонализации вопросов интервью необходимо сначала загрузить CV.\n\nЧерез анализ CV мы:\n- Определим ваши технологии\n- Определим уровень (Junior/Middle/Senior)\n- Определим направление (Frontend/Backend/...)\n\n📎 <i>Отправьте файл CV (PDF/DOCX) сюда</i>`,
              en: `🎯 <b>Mock Interview</b>\n\nTo personalize interview questions, please upload your CV first.\n\nThrough CV analysis we will:\n- Identify your technologies\n- Determine your level (Junior/Middle/Senior)\n- Identify your domain (Frontend/Backend/...)\n\n📎 <i>Send your CV file (PDF/DOCX) here</i>`,
            };

            const noCvKeyboard = new InlineKeyboard()
              .text(
                lang === 'uz' ? '📎 CV yuklash' : lang === 'ru' ? '📎 Загрузить CV' : '📎 Upload CV',
                'cv_upload_for_interview',
              )
              .row()
              .text('❌ Bekor qilish', 'interview_cancel');

            await ctx.reply(noCvText[lang] || noCvText.en, {
              parse_mode: 'HTML',
              reply_markup: noCvKeyboard,
            });
            // Mark that after CV upload, user wants to start interview
            ctx.session.interviewStep = 'waiting_cv';
            return;
          }

          if (latestCv.analysisStatus !== 'completed' || !latestCv.analysis) {
            // ── CV EXISTS but NOT ANALYZED: Auto-analyze ──
            const analyzingText: Record<string, string> = {
              uz: `🎯 <b>Mock Intervyu</b>\n\nCV topildi, lekin hali tahlil qilinmagan.\n\n🔄 <b>CV tahlil qilinmoqda...</b> Iltimos, kuting.`,
              ru: `🎯 <b>Mock Интервью</b>\n\nCV найден, но ещё не проанализирован.\n\n🔄 <b>Анализируем CV...</b> Пожалуйста, подождите.`,
              en: `🎯 <b>Mock Interview</b>\n\nCV found but not yet analyzed.\n\n🔄 <b>Analyzing CV...</b> Please wait.`,
            };
            const analyzeMsg = await ctx.reply(analyzingText[lang] || analyzingText.en, {
              parse_mode: 'HTML',
            });

            try {
              await this.cvService.analyzeCv(userId, (latestCv as any).id, {
                language: lang,
              });
              // Delete analyzing message
              try {
                if (ctx.chat?.id) await ctx.api.deleteMessage(ctx.chat.id, analyzeMsg.message_id);
              } catch { /* silent */ }

              // Re-fetch to get updated analysis + profile
              const analyzedCv = await this.cvService.getUserLatestCv(userId);
              const updatedUser = await this.usersService.findByTelegramId(telegramId);
              if (analyzedCv?.analysis && updatedUser) {
                await this.showCvInterviewConfirmation(ctx, updatedUser, analyzedCv, lang);
              } else {
                // Analysis succeeded but something went wrong
                await this.showManualDomainSelection(ctx, lang);
              }
            } catch (analyzeError: any) {
              this.logger.error(`CV auto-analyze failed: ${analyzeError.message}`);
              try {
                if (ctx.chat?.id) await ctx.api.deleteMessage(ctx.chat.id, analyzeMsg.message_id);
              } catch { /* silent */ }
              // Fallback to manual wizard
              await this.showManualDomainSelection(ctx, lang);
            }
            return;
          }

          // ── CV EXISTS and ANALYZED: Show confirmation ──
          await this.showCvInterviewConfirmation(ctx, user, latestCv, lang);

        } catch (cvError: any) {
          this.logger.error(`CV check failed for mock interview: ${cvError.message}`);
          // Fallback to manual wizard
          await this.showManualDomainSelection(ctx, lang);
        }
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
    // POSITION SELECTION (from /set_position command)
    // ============================================================
    if (callbackData.startsWith('position_')) {
      const position = callbackData.replace('position_', '') as
        | 'junior'
        | 'middle'
        | 'senior'
        | 'lead';
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      // Validate position value before saving
      const validPositions = ['junior', 'middle', 'senior', 'lead'];
      if (!validPositions.includes(position)) {
        this.logger.warn(`Invalid position value from callback: ${position}`);
        await ctx.reply('❌ Invalid position');
        return;
      }

      try {
        // FIX: Write to profile.position (not legacy jobRole field)
        // Also mark position as confirmed to prevent re-prompting
        const userId = (user as any).id || (user as any)._id?.toString();
        await this.usersRepository.updateRaw(userId, {
          $set: {
            'profile.position': position,
            'engagement.positionConfirmed': true,
            'engagement.scheduledPositionPromptAt': null,
          },
        });

        const confirmText: Record<string, string> = {
          uz: `✅ Lavozim o'rnatildi: <b>${position}</b>`,
          ru: `✅ Должность установлена: <b>${position}</b>`,
          en: `✅ Position set: <b>${position}</b>`,
        };

        await ctx.reply(confirmText[lang] || confirmText.en, { parse_mode: 'HTML' });

        this.logger.log(`User ${telegramId} updated profile.position to: ${position}`);
      } catch (error: any) {
        this.logger.error(`Failed to update position: ${error.message}`);
        await ctx.reply('❌ Failed to update position');
      }

      return;
    }

    // ============================================================
    // 🔧 FIX: POSITION CONFIRMATION (from automated position prompt)
    // ============================================================
    if (callbackData.startsWith('confirm_position_')) {
      const position = callbackData.replace('confirm_position_', '') as
        | 'junior'
        | 'middle'
        | 'senior'
        | 'lead';
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.reply('Please register first using /start');
        return;
      }

      try {
        // Update user profile with confirmed position
        // 🔧 FIX: Also clear scheduled times to prevent re-sending position prompts
        await this.usersRepository.updateRaw((user as any).id || (user as any)._id?.toString(), {
          $set: {
            'profile.position': position,
            'engagement.positionConfirmed': true,
            'engagement.scheduledPositionPromptAt': null, // Clear scheduled time
            'engagement.positionPromptSentAt': new Date(), // Mark as sent
          },
        });

        // 🔧 FIX: Use user's language from database, not session (session might be empty)
        const userLang = (user as any).language || lang || 'uz';

        const confirmText: Record<string, string> = {
          uz: `✅ Rahmat! Lavozimingiz saqlandi: <b>${position}</b>\n\nEndi sizga mos savollar jo'natiladi.`,
          ru: `✅ Спасибо! Ваша должность сохранена: <b>${position}</b>\n\nТеперь вы получите соответствующие вопросы.`,
          en: `✅ Thank you! Your position has been saved: <b>${position}</b>\n\nYou will now receive appropriate questions.`,
        };

        await ctx.editMessageText(confirmText[userLang] || confirmText.uz, { parse_mode: 'HTML' });

        this.logger.log(`User ${telegramId} confirmed position: ${position}`);
      } catch (error: any) {
        this.logger.error(`Failed to confirm position: ${error.message}`);
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
      const duration = callbackData.replace('mock_duration_', '') as
        | 'quick'
        | 'standard'
        | 'deep_dive';
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

      // FIX #45/#46: Enrich interview with CV context if user has analyzed CV.
      // If user selected specific domain/technology in wizard, use those.
      // Otherwise fall back to profile data (which is populated from CV analysis).
      const selectedDomain = ctx.session.interviewDomain || (user.profile as any)?.domain || 'general';
      const selectedTech = ctx.session.interviewTechnology
        ? [ctx.session.interviewTechnology]
        : (user.profile?.techStack?.length > 0 ? user.profile.techStack.slice(0, 5) : ['general']);

      // Build CV context for personalized AI question generation
      // Build rich CV context for AI personalization
      let cvContext: { skills?: string[]; experience?: string; strengths?: string[]; summary?: string } | undefined;
      const userId = (user as any).id || (user as any)._id?.toString();
      try {
        const latestCv = await this.cvService.getUserLatestCv(userId);
        if (latestCv?.analysis && latestCv.analysisStatus === 'completed') {
          // Combine techStack from profile (CV-enriched) with parsed skills
          const allSkills = new Set<string>([
            ...(user.profile?.techStack || []),
            ...(latestCv.parsedData?.skills || []),
          ]);

          // Build a concise experience summary instead of raw CV text
          // This gives AI more structured context without noise
          const experienceParts: string[] = [];
          if (latestCv.parsedData?.experience && Array.isArray(latestCv.parsedData.experience)) {
            for (const exp of (latestCv.parsedData.experience as any[]).slice(0, 3)) {
              const title = exp.title || (exp as any).position || '';
              const company = exp.company || '';
              if (title || company) {
                experienceParts.push(`${title}${company ? ` at ${company}` : ''}`);
              }
            }
          }

          cvContext = {
            skills: Array.from(allSkills).slice(0, 15),
            experience: experienceParts.length > 0
              ? experienceParts.join('; ')
              : (latestCv.parsedText ? latestCv.parsedText.substring(0, 500) : undefined),
            strengths: latestCv.analysis?.strengths?.slice(0, 5),
            // Add weaknesses as summary so AI can target them
            // Handle both string[] and {issue}[] formats from old/new CV prompt
            summary: (() => {
              const cw = (latestCv.analysis as any)?.criticalWeaknesses;
              const w = (latestCv.analysis as any)?.weaknesses;
              const items = cw?.length > 0 ? cw : (w?.length > 0 ? w : null);
              if (!items) return undefined;
              const texts = items.slice(0, 3).map((item: any) =>
                typeof item === 'string' ? item : item?.issue || String(item),
              );
              return `Weak areas: ${texts.join('; ')}`;
            })(),
          };
          this.logger.debug(
            `Enriched interview with CV context for user ${user.telegramId}: ` +
            `skills=${cvContext.skills?.length || 0}, hasExperience=${!!cvContext.experience}`,
          );
        }
      } catch (cvError: any) {
        // Non-critical — interview still works without CV context
        this.logger.debug(`CV context enrichment skipped: ${cvError.message}`);
      }

      // Prepare StartInterviewDto
      const startDto = {
        type: 'technical',
        difficulty: this.mapPositionToInterviewDifficulty(position), // Map position to interview difficulty
        domain: selectedDomain,
        technology: selectedTech,
        interviewDuration: duration,
        mode: 'text', // Default to text mode
        language: lang,
        cvContext, // FIX #45: Pass CV data for personalized questions
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
        // Start the interview (userId already computed above for CV context)
        const session = await this.interviewsService.startInterview(userId, startDto as any);

        // FIX #67 (CRITICAL): Increment mock interview usage counter AFTER successful start.
        // This was missing! checkMockInterviewLimit checks the counter, but nothing incremented it,
        // allowing users to bypass limits entirely.
        await this.usersService.incrementUsage(userId, 'mockInterview');

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

${error.message || "Noma'lum xatolik"}`,
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
        const currentQuestion = (currentSession.questions as any)[
          currentSession.currentQuestionIndex
        ];

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
        const nextQuestion = (sessionAfterSkip.questions as any)[
          sessionAfterSkip.currentQuestionIndex
        ];
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
    // SURVEY CALLBACK HANDLER
    // ============================================================
    if (this.surveyHandlerService.isSurveyCallback(callbackData)) {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);

      if (!user) {
        await ctx.answerCallbackQuery({ text: 'Please register first using /start' });
        return;
      }

      const userId = (user as any).id || (user as any)._id?.toString();
      const status = this.surveyHandlerService.parseCallbackData(callbackData);

      if (status) {
        try {
          const thanksMessage = await this.surveyHandlerService.handleSurveyResponse(
            userId,
            status,
            lang,
          );

          // Edit original message to remove buttons and show thank you
          await ctx.editMessageText(thanksMessage, {
            parse_mode: 'HTML',
          });

          await ctx.answerCallbackQuery();

          // Optional: show main menu after a small delay
          setTimeout(async () => {
            try {
              await this.showMainMenu(ctx, user);
            } catch (e) {
              // ignore
            }
          }, 3000);
        } catch (error: any) {
          this.logger.error(`Failed to handle survey response: ${error.message}`);
          await ctx.answerCallbackQuery({ text: '❌ Error processing response' });
        }
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
      '📊 Profil': 'profile', // Legacy
      '📊 Profile': 'profile', // Legacy
      '📊 Профиль': 'profile', // Legacy

      // Upgrade/Tariff buttons
      '💳 Tarif': 'upgrade',
      '💳 Plans': 'upgrade',
      '💳 Тарифы': 'upgrade',
      '💳 Tariflar': 'upgrade', // Legacy

      // Help buttons (legacy - not in current inline menu)
      '❓ Yordam': 'help',
      '❓ Help': 'help',
      '❓ Помощь': 'help',
      'ℹ️ Yordam': 'help', // Legacy
      'ℹ️ Help': 'help', // Legacy
      'ℹ️ Помощь': 'help', // Legacy

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
        const currentQuestion = (currentSession.questions as any)[
          currentSession.currentQuestionIndex
        ];

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

  /**
   * Handle text input for profile description (AI Normalization)
   */
  async handleProfileDescription(ctx: BotContext, text: string) {
    try {
      const telegramId = ctx.from?.id as number;
      const user = await this.usersService.findByTelegramId(telegramId);
      const lang = this.getUserLanguage(ctx, user);

      if (!user) return;

      // Send "Typing..." / "Thinking..." feedback
      await ctx.reply(lang === 'uz' ? '🧠 AI tahlil qilmoqda...' : '🧠 AI is analyzing...', {
        reply_to_message_id: ctx.message?.message_id,
      });

      // Call AI Service
      const normalized = await this.profileNormalizationService.normalizeProfile(text);
      this.logger.log(`AI Normalized Profile for ${telegramId}: ${JSON.stringify(normalized)}`);

      // Update User Profile
      await this.usersRepository.updateRaw((user._id as any).toString(), {
        $set: {
          'profile.position': normalized.position,
          'profile.goal': normalized.goal,
          'profile.techStack': normalized.techStack,
          'engagement.positionConfirmed': true, // Auto-confirm since they typed it
          'engagement.jobSeekingStatus':
            normalized.goal === 'job_search' ? 'actively_looking' : 'employed',
        },
      });

      // Clear session state
      if (ctx.session) {
        ctx.session.profileUpdateStep = undefined;
      }

      // Confirmation Message
      const successText = {
        uz:
          `✅ <b>Profil yangilandi!</b>\n\n` +
          `🔹 Lavozim: <b>${normalized.position.toUpperCase()}</b>\n` +
          `🔹 Yo'nalish: <b>${normalized.goal}</b>\n` +
          `🔹 Texnologiyalar: ${normalized.techStack.join(', ') || 'Aniqlanmadi'}\n\n` +
          `Endi intervyu savollari sizga moslashtiriladi.`,
        ru:
          `✅ <b>Профиль обновлен!</b>\n\n` +
          `🔹 Должность: <b>${normalized.position.toUpperCase()}</b>\n` +
          `🔹 Цель: <b>${normalized.goal}</b>\n` +
          `🔹 Технологии: ${normalized.techStack.join(', ') || 'Не определено'}\n\n` +
          `Теперь вопросы будут подобраны под вас.`,
        en:
          `✅ <b>Profile updated!</b>\n\n` +
          `🔹 Position: <b>${normalized.position.toUpperCase()}</b>\n` +
          `🔹 Goal: <b>${normalized.goal}</b>\n` +
          `🔹 Stack: ${normalized.techStack.join(', ') || 'Not detected'}\n\n` +
          `Questions will now be tailored to your profile.`,
      };

      await ctx.reply(successText[lang] || successText.en, { parse_mode: 'HTML' });

      // Show main menu
      await this.showMainMenu(ctx, user);
    } catch (error: any) {
      this.logger.error(`Failed to handle profile description: ${error.message}`);
      await ctx.reply('❌ Error updating profile. Please try selecting from buttons.');
    }
  }

  /**
   * Map user profile position to interview difficulty level.
   *
   * User profiles use: 'junior' | 'middle' | 'senior' | 'lead'
   * Interview schemas use: 'junior' | 'mid' | 'senior'
   *
   * This mapping prevents Mongoose validation errors and ensures
   * correct question count calculation.
   */
  private mapPositionToInterviewDifficulty(position: string): string {
    const positionToDifficulty: Record<string, string> = {
      junior: 'junior',
      middle: 'mid',
      senior: 'senior',
      lead: 'senior',
    };
    return positionToDifficulty[position] || 'junior';
  }

  // ================================================================
  // CV-FIRST INTERVIEW FLOW HELPERS
  // ================================================================

  /**
   * Show CV-based interview confirmation screen.
   * User sees their CV profile (domain, techStack, position) and can:
   * 1. Start interview with CV data (skip manual wizard)
   * 2. Upload new CV and re-analyze
   * 3. Cancel
   */
  private async showCvInterviewConfirmation(
    ctx: any,
    user: any,
    cv: any,
    lang: string,
  ): Promise<void> {
    const profile = user.profile || {};
    const domain = (profile as any).domain || 'general';
    const techStack: string[] = profile.techStack || [];
    const position = profile.position || 'junior';

    // Human-readable labels
    const domainLabels: Record<string, Record<string, string>> = {
      uz: {
        frontend: 'Frontend',
        backend: 'Backend',
        mobile: 'Mobile',
        fullstack: 'Full Stack',
        devops: 'DevOps',
        ai_ml: 'AI/ML',
        data: 'Data Science',
        qa: 'QA',
        general: 'Umumiy',
      },
      ru: {
        frontend: 'Frontend',
        backend: 'Backend',
        mobile: 'Mobile',
        fullstack: 'Full Stack',
        devops: 'DevOps',
        ai_ml: 'AI/ML',
        data: 'Data Science',
        qa: 'QA',
        general: 'Общее',
      },
      en: {
        frontend: 'Frontend',
        backend: 'Backend',
        mobile: 'Mobile',
        fullstack: 'Full Stack',
        devops: 'DevOps',
        ai_ml: 'AI/ML',
        data: 'Data Science',
        qa: 'QA',
        general: 'General',
      },
    };

    const positionLabels: Record<string, Record<string, string>> = {
      uz: { junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead' },
      ru: { junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead' },
      en: { junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead' },
    };

    const domainLabel = domainLabels[lang]?.[domain] || domainLabels.en[domain] || domain;
    const positionLabel = positionLabels[lang]?.[position] || positionLabels.en[position] || position;
    const techList = techStack.length > 0 ? techStack.slice(0, 8).join(', ') : '-';

    const confirmText: Record<string, string> = {
      uz: `🎯 <b>Mock Intervyu</b>\n\nCV tahlili asosida sizning profilingiz:\n\n📋 <b>Yo'nalish:</b> ${domainLabel}\n💼 <b>Daraja:</b> ${positionLabel}\n💻 <b>Texnologiyalar:</b> ${techList}\n\nSavollar shu ma'lumotlarga asoslanadi.\n\n<i>Davom etish uchun intervyu davomiyligini tanlang yoki yangi CV yuklang:</i>`,
      ru: `🎯 <b>Mock Интервью</b>\n\nНа основе анализа CV ваш профиль:\n\n📋 <b>Направление:</b> ${domainLabel}\n💼 <b>Уровень:</b> ${positionLabel}\n💻 <b>Технологии:</b> ${techList}\n\nВопросы будут основаны на этих данных.\n\n<i>Выберите продолжительность интервью или загрузите новое CV:</i>`,
      en: `🎯 <b>Mock Interview</b>\n\nBased on your CV analysis:\n\n📋 <b>Domain:</b> ${domainLabel}\n💼 <b>Level:</b> ${positionLabel}\n💻 <b>Technologies:</b> ${techList}\n\nQuestions will be based on these details.\n\n<i>Choose interview duration or upload a new CV:</i>`,
    };

    const btnLabels = {
      uz: { quick: '⚡ Tez (5-7)', standard: '📊 Standart (10-12)', deep: '🎯 Chuqur (15-20)', newCv: '📎 Yangi CV yuklash', cancel: '❌ Bekor qilish' },
      ru: { quick: '⚡ Быстрый (5-7)', standard: '📊 Стандарт (10-12)', deep: '🎯 Глубокий (15-20)', newCv: '📎 Загрузить новое CV', cancel: '❌ Отмена' },
      en: { quick: '⚡ Quick (5-7)', standard: '📊 Standard (10-12)', deep: '🎯 Deep (15-20)', newCv: '📎 Upload new CV', cancel: '❌ Cancel' },
    };
    const btn = btnLabels[lang] || btnLabels.en;

    // Set session data from CV profile so duration handler can use them
    ctx.session.interviewDomain = domain;
    ctx.session.interviewTechnology = techStack[0] || 'general';
    ctx.session.interviewStep = 'cv_confirmed';

    const keyboard = new InlineKeyboard()
      .text(btn.quick, 'mock_duration_quick')
      .row()
      .text(btn.standard, 'mock_duration_standard')
      .row()
      .text(btn.deep, 'mock_duration_deep_dive')
      .row()
      .text(btn.newCv, 'cv_upload_for_interview')
      .row()
      .text(btn.cancel, 'interview_cancel');

    await ctx.reply(confirmText[lang] || confirmText.en, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Fallback: Show manual domain selection wizard (used when CV is unavailable).
   */
  private async showManualDomainSelection(ctx: any, lang: string): Promise<void> {
    ctx.session.interviewStep = 'domain';

    const domainText: Record<string, string> = {
      uz: `🎯 <b>Mock Intervyu Boshlash</b>\n\nCV tahlili mavjud emas. Qaysi sohada intervyu olishni xohlaysiz?\n\n📝 <i>Quyidagi tugmalardan birini tanlang:</i>`,
      ru: `🎯 <b>Начать Mock Интервью</b>\n\nАнализ CV недоступен. В какой области хотите пройти интервью?\n\n📝 <i>Выберите одну из кнопок ниже:</i>`,
      en: `🎯 <b>Start Mock Interview</b>\n\nCV analysis unavailable. Which domain would you like to practice?\n\n📝 <i>Select one of the buttons below:</i>`,
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
  }
}
