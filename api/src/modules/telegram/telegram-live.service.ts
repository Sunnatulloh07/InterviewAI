import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramSession, TelegramSessionDocument } from './schemas/telegram-session.schema';
import { BotContext } from './telegram.service';
import { AiAnswerService } from '../ai/ai-answer.service';
import { AiSttService } from '../ai/ai-stt.service';
import { UsersService } from '../users/users.service';
import { AiContextService } from '../ai/ai-context.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SubscriptionService } from '../payments/subscription.service';
import { TelegramSubscriptionService } from './telegram-subscription.service';
import { InlineKeyboard } from 'grammy';

@Injectable()
export class TelegramLiveService {
  private readonly logger = new Logger(TelegramLiveService.name);

  constructor(
    @InjectModel(TelegramSession.name)
    private readonly sessionModel: Model<TelegramSessionDocument>,
    private readonly answerService: AiAnswerService,
    private readonly sttService: AiSttService,
    private readonly usersService: UsersService,
    private readonly contextService: AiContextService,
    private readonly subscriptionService: SubscriptionService,
    private readonly telegramSubscriptionService: TelegramSubscriptionService,
  ) {}

  async handleStartLive(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const user = await this.usersService.findByTelegramId(telegramId);

    if (!user) {
      // For non-registered users, use session language or default to 'en'
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

    // Get language early for error messages
    const lang = ctx.session?.language || user.preferences?.language || user.language || 'uz';

    // Verify Plan Limits (Robust Logic)
    // 1. Check status using business logic service
    const status = await this.subscriptionService.getLiveInterviewStatus(userId);

    // 2. If not allowed, send warning via Telegram service (Fixes crash)
    if (!status.allowed) {
      await this.telegramSubscriptionService.sendUsageLimitWarning(
        ctx,
        lang,
        'liveInterviewMinutes',
        status.usage,
        status.limit,
      );
      return;
    }

    // 3. Optional: Notify user of remaining minutes (Transparency)
    // Only show if plan has limits (limit != -1)
    if (status.limit !== -1 && status.remainingMinutes < 10) {
      const warningText: Record<string, string> = {
        uz: `⚠️ <b>Eslatma:</b> Sizda ${status.remainingMinutes} daqiqa qoldi.`,
        ru: `⚠️ <b>Внимание:</b> У вас осталось ${status.remainingMinutes} минут.`,
        en: `⚠️ <b>Note:</b> You have ${status.remainingMinutes} minutes remaining.`,
      };
      await ctx.reply(warningText[lang] || warningText['en'], { parse_mode: 'HTML' });
    }

    // Save language to session for future use (if not already set)
    if (ctx.session && !ctx.session.language) {
      ctx.session.language = lang;
    }

    // Auto-fill metadata from user profile (CV-enriched) if not yet collected.
    // This skips the manual domain/technology/position wizard when user has
    // a complete profile from CV analysis.
    if (!ctx.session.liveSessionMetadata?.domain && user.profile) {
      const profile = user.profile;
      const hasCvProfile = (profile as any).domain && profile.techStack?.length > 0;
      if (hasCvProfile) {
        ctx.session.liveSessionMetadata = {
          ...ctx.session.liveSessionMetadata,
          domain: (profile as any).domain || 'general',
          technologies: profile.techStack?.slice(0, 10) || [],
          position: profile.position || 'junior',
          // Company still needs to be asked — CV doesn't have target company
        };
        this.logger.debug(
          `Auto-filled live session metadata from CV profile for user ${telegramId}`,
        );
      }
    }

    // Check if metadata is already collected
    const hasMetadata =
      ctx.session.liveSessionMetadata?.domain &&
      (ctx.session.liveSessionMetadata?.technologies?.length ?? 0) > 0 &&
      ctx.session.liveSessionMetadata?.position &&
      ctx.session.liveSessionMetadata?.company;

    if (!hasMetadata) {
      // Clear conflicting session states (e.g. mock interview)
      ctx.session.interviewStep = undefined;

      // Start metadata collection flow
      ctx.session.liveSessionMetadata = ctx.session.liveSessionMetadata || {};

      // If CV profile filled domain/tech/position, only ask for company
      const hasCvPartial =
        ctx.session.liveSessionMetadata.domain &&
        (ctx.session.liveSessionMetadata.technologies?.length ?? 0) > 0 &&
        ctx.session.liveSessionMetadata.position;

      if (hasCvPartial && !ctx.session.liveSessionMetadata.company) {
        // Only company is missing — skip straight to company question
        ctx.session.liveSessionStep = 'company';
        const companyText: Record<string, string> = {
          uz: `🎯 <b>Live Intervyu</b>\n\nCV asosida profilingiz aniqlandi:\n📋 Yo'nalish: <b>${ctx.session.liveSessionMetadata.domain}</b>\n💻 Texnologiyalar: <b>${ctx.session.liveSessionMetadata.technologies?.join(', ')}</b>\n💼 Daraja: <b>${ctx.session.liveSessionMetadata.position}</b>\n\nQaysi kompaniyada intervyu berasiz?`,
          ru: `🎯 <b>Live Интервью</b>\n\nНа основе CV ваш профиль определён:\n📋 Направление: <b>${ctx.session.liveSessionMetadata.domain}</b>\n💻 Технологии: <b>${ctx.session.liveSessionMetadata.technologies?.join(', ')}</b>\n💼 Уровень: <b>${ctx.session.liveSessionMetadata.position}</b>\n\nВ какой компании будет интервью?`,
          en: `🎯 <b>Live Interview</b>\n\nBased on your CV:\n📋 Domain: <b>${ctx.session.liveSessionMetadata.domain}</b>\n💻 Technologies: <b>${ctx.session.liveSessionMetadata.technologies?.join(', ')}</b>\n💼 Level: <b>${ctx.session.liveSessionMetadata.position}</b>\n\nWhich company is the interview with?`,
        };
        await ctx.reply(companyText[lang] || companyText.en, { parse_mode: 'HTML' });
        return;
      }

      ctx.session.liveSessionStep = 'domain';

      const welcomeText: Record<string, string> = {
        uz:
          `🎯 <b>Live Intervyu Rejimi</b>\n\n` +
          `Real intervyuda sizga yordam berish uchun bir nechta ma'lumotlar kerak.\n\n` +
          `Keling, boshlaymiz!`,
        ru:
          `🎯 <b>Режим Live Интервью</b>\n\n` +
          `Для помощи в реальном интервью нужна некоторая информация.\n\n` +
          `Давайте начнем!`,
        en:
          `🎯 <b>Live Interview Mode</b>\n\n` +
          `To help you in a real interview, I need some information.\n\n` +
          `Let's get started!`,
      };

      await ctx.reply(welcomeText[lang] || welcomeText['en'], {
        parse_mode: 'HTML',
      });

      // Ask for domain
      await this.askLiveDomain(ctx, lang);
      return;
    }

    // Metadata already collected - start live session
    // Clear conflicting session states
    ctx.session.interviewStep = undefined;

    const sessionMetadata = ctx.session.liveSessionMetadata!;
    const startText: Record<string, string> = {
      uz:
        `🎯 <b>Live Intervyu Rejimi Faollashtirildi</b>\n\n` +
        `Men endi real vaqtda sizga yordam bera olaman!\n\n` +
        `📋 <b>Intervyu ma'lumotlari:</b>\n` +
        `• Soha: ${sessionMetadata.domain}\n` +
        `• Texnologiyalar: ${sessionMetadata.technologies?.join(', ') || 'N/A'}\n` +
        `• Pozitsiya: ${sessionMetadata.position}\n` +
        `• Kompaniya: ${sessionMetadata.company}\n\n` +
        `Savollaringizni yuboring yoki ovozli xabarlardan foydalaning, men darhol javob beraman.\n\n` +
        `To'xtatish uchun /end_live buyrug'ini yuboring.`,
      ru:
        `🎯 <b>Режим Live Интервью Активирован</b>\n\n` +
        `Я теперь готов помочь вам в реальном времени!\n\n` +
        `📋 <b>Информация об интервью:</b>\n` +
        `• Область: ${sessionMetadata.domain}\n` +
        `• Технологии: ${sessionMetadata.technologies?.join(', ') || 'N/A'}\n` +
        `• Позиция: ${sessionMetadata.position}\n` +
        `• Компания: ${sessionMetadata.company}\n\n` +
        `Отправляйте вопросы или используйте голосовые сообщения, я предоставлю мгновенные ответы.\n\n` +
        `Используйте /end_live для остановки.`,
      en:
        `🎯 <b>Live Interview Mode Activated</b>\n\n` +
        `I'm now ready to assist you in real-time!\n\n` +
        `📋 <b>Interview Information:</b>\n` +
        `• Domain: ${sessionMetadata.domain}\n` +
        `• Technologies: ${sessionMetadata.technologies?.join(', ') || 'N/A'}\n` +
        `• Position: ${sessionMetadata.position}\n` +
        `• Company: ${sessionMetadata.company}\n\n` +
        `Send me questions or use voice messages, and I'll provide instant answers.\n\n` +
        `Use /end_live to stop.`,
    };

    await ctx.reply(startText[lang] || startText['en'], {
      parse_mode: 'HTML',
    });

    // CRITICAL: Set session step to 'active' for voice message detection
    ctx.session.liveSessionStep = 'active';

    // userId is already obtained and validated above

    // Create or update session with full metadata
    const liveMetadata = ctx.session.liveSessionMetadata || {};
    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      {
        userId: userId as any,
        telegramChatId: telegramId,
        status: 'live_session',
        sessionStartedAt: new Date(),
        lastActivityAt: new Date(),
        messages: [],
        context: '',
        metadata: {
          // New metadata fields
          domain: liveMetadata.domain,
          technologies: liveMetadata.technologies || [],
          position: liveMetadata.position,
          company: liveMetadata.company,
          // Legacy fields (for backward compatibility)
          jobRole: liveMetadata.jobRole || liveMetadata.position,
          interviewType: liveMetadata.interviewType || 'technical',
          language: lang,
        },
      },
      { upsert: true },
    );

    // Create AI context session
    const aiSession = await this.contextService.createSession(userId, 'live_interview');
    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      { context: aiSession.id },
    );
  }

  async handleEndLive(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;

    // Get user for language preference
    const user = await this.usersService.findByTelegramId(telegramId);

    // Get language from session, user preferences, or database
    // Priority: session > user.preferences.language > user.language > 'en'
    let lang = ctx.session?.language;
    if (!lang && user) {
      lang = user.preferences?.language || user.language || 'en';
      // Save to session for future use
      if (ctx.session) {
        ctx.session.language = lang;
      }
    } else if (!lang) {
      lang = 'en';
    }

    const session = await this.sessionModel.findOne({
      telegramChatId: telegramId,
      status: 'live_session',
    });

    if (session && session.context) {
      // Archive AI session
      await this.contextService.archiveSession(session.context);
    }

    await this.sessionModel.findOneAndUpdate(
      { telegramChatId: telegramId },
      { status: 'idle', lastActivityAt: new Date() },
    );

    // Clear metadata from session
    if (ctx.session) {
      ctx.session.liveSessionMetadata = undefined;
      ctx.session.liveSessionStep = undefined;
    }

    const endText: Record<string, string> = {
      uz: `✅ <b>Live sessiya yakunlandi</b>\n\nIntervyu uchun omad tilaymiz!`,
      ru: `✅ <b>Live сессия завершена</b>\n\nУдачи на интервью!`,
      en: `✅ <b>Live session ended</b>\n\nGood luck with your interview!`,
    };

    await ctx.reply(endText[lang] || endText['en'], {
      parse_mode: 'HTML',
    });
  }

  async isInLiveSession(telegramId: number): Promise<boolean> {
    const session = await this.sessionModel.findOne({
      telegramChatId: telegramId,
      status: 'live_session',
    });
    return !!session;
  }

  /**
   * Get session model (for internal use by other services)
   */
  getSessionModel() {
    return this.sessionModel;
  }

  /**
   * Ask for domain in live session setup
   */
  private async askLiveDomain(ctx: BotContext, lang: string) {
    const domainKeyboard = new InlineKeyboard()
      .text('Frontend', 'live_domain_frontend')
      .text('Backend', 'live_domain_backend')
      .row()
      .text('Full Stack', 'live_domain_fullstack')
      .text('Mobile', 'live_domain_mobile')
      .row()
      .text('DevOps', 'live_domain_devops')
      .text('Data Science', 'live_domain_datascience');

    const domainText: Record<string, string> = {
      uz: `📋 <b>Live Intervyu - Soha Tanlang</b>

Qaysi soha bo'yicha intervyu?

📝 <i>Quyidagi tugmalardan birini tanlang:</i>`,
      ru: `📋 <b>Live Интервью - Выбор Области</b>

По какой области интервью?

📝 <i>Выберите одну из кнопок ниже:</i>`,
      en: `📋 <b>Live Interview - Select Domain</b>

What domain is the interview for?

📝 <i>Select one of the buttons below:</i>`,
    };

    await this.replyOrTransition(ctx, domainText[lang] || domainText['en'], {
      reply_markup: domainKeyboard,
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for technologies in live session setup
   */
  private async askLiveTechnologies(ctx: BotContext, lang: string, shouldEdit: boolean = false) {
    const selectedTechs = ctx.session.liveSessionMetadata?.technologies || [];
    const techKeyboard = new InlineKeyboard();

    // Add technologies with checkmark if selected
    const techs = [
      { key: 'react', label: 'React' },
      { key: 'vue', label: 'Vue.js' },
      { key: 'angular', label: 'Angular' },
      { key: 'nodejs', label: 'Node.js' },
      { key: 'python', label: 'Python' },
      { key: 'java', label: 'Java' },
      { key: 'csharp', label: 'C#' },
      { key: 'go', label: 'Go' },
      { key: 'rust', label: 'Rust' },
    ];

    techs.forEach((tech, index) => {
      const isSelected = selectedTechs.includes(tech.key);
      const label = isSelected ? `✅ ${tech.label}` : tech.label;
      techKeyboard.text(label, `live_tech_${tech.key}`);
      if ((index + 1) % 3 === 0) {
        techKeyboard.row();
      }
    });

    techKeyboard.row().text("➕ Qo'lda kiritish", 'live_tech_custom');
    techKeyboard.row().text('✅ Tugadi', 'live_tech_done');

    const techText: Record<string, string> = {
      uz:
        `💻 <b>Live Intervyu - Texnologiyalar</b>\n\n` +
        `Qaysi texnologiyalar ishlatiladi?\n\n` +
        `📌 <b>Ko'p tanlash mumkin:</b>\n` +
        `• Tugmalardan tanlash\n` +
        `• Yoki "➕ Qo'lda kiritish" tugmasini bosib vergul bilan ajratib yozing\n` +
        `  Masalan: <code>React, Node.js, PostgreSQL</code>\n\n` +
        `✅ Tanlaganingizdan keyin "✅ Tugadi" bosing.`,
      ru:
        `💻 <b>Live Интервью - Технологии</b>\n\n` +
        `Какие технологии используются?\n\n` +
        `📌 <b>Можно выбрать несколько:</b>\n` +
        `• Выбрать из кнопок\n` +
        `• Или нажать "➕ Ввести вручную" и написать через запятую\n` +
        `  Например: <code>React, Node.js, PostgreSQL</code>\n\n` +
        `✅ После выбора нажмите "✅ Готово".`,
      en:
        `💻 <b>Live Interview - Technologies</b>\n\n` +
        `What technologies are used?\n\n` +
        `📌 <b>Multiple selection allowed:</b>\n` +
        `• Select from buttons\n` +
        `• Or press "➕ Enter manually" and type comma-separated\n` +
        `  Example: <code>React, Node.js, PostgreSQL</code>\n\n` +
        `✅ After selecting, press "✅ Done".`,
    };

    await this.replyOrTransition(
      ctx,
      techText[lang] || techText['en'],
      {
        reply_markup: techKeyboard,
        parse_mode: 'HTML',
      },
      shouldEdit,
    );
  }

  /**
   * Ask for position in live session setup
   */
  private async askLivePosition(ctx: BotContext, lang: string) {
    const positionKeyboard = new InlineKeyboard()
      .text('Junior', 'live_position_junior')
      .text('Middle', 'live_position_middle')
      .row()
      .text('Senior', 'live_position_senior')
      .text('Lead', 'live_position_lead');

    const positionText: Record<string, string> = {
      uz: `👔 <b>Live Intervyu - Pozitsiya</b>

Qaysi pozitsiya uchun intervyu?

📝 <i>Quyidagi tugmalardan birini tanlang:</i>`,
      ru: `👔 <b>Live Интервью - Позиция</b>

На какую позицию интервью?

📝 <i>Выберите одну из кнопок ниже:</i>`,
      en: `👔 <b>Live Interview - Position</b>

What position is the interview for?

📝 <i>Select one of the buttons below:</i>`,
    };

    await this.replyOrTransition(ctx, positionText[lang] || positionText['en'], {
      reply_markup: positionKeyboard,
      parse_mode: 'HTML',
    });
  }

  /**
   * Ask for company in live session setup
   */
  private async askLiveCompany(ctx: BotContext, lang: string) {
    const companyText: Record<string, string> = {
      uz: `🏢 <b>Live Intervyu - Kompaniya</b>

Qaysi kompaniya uchun intervyu?

✍️ <i>Kompaniya nomini yozing va yuboring:</i>
Masalan: <code>Google</code>, <code>Microsoft</code>, <code>Uzum</code>`,
      ru: `🏢 <b>Live Интервью - Компания</b>

Для какой компании интервью?

✍️ <i>Напишите название компании и отправьте:</i>
Например: <code>Google</code>, <code>Microsoft</code>, <code>Яндекс</code>`,
      en: `🏢 <b>Live Interview - Company</b>

What company is the interview for?

✍️ <i>Type the company name and send:</i>
Example: <code>Google</code>, <code>Microsoft</code>, <code>Amazon</code>`,
    };

    await this.replyOrTransition(ctx, companyText[lang] || companyText['en'], {
      parse_mode: 'HTML',
    });
  }

  /**
   * Handle live session metadata callbacks
   */
  async handleLiveMetadataCallback(ctx: BotContext, data: string) {
    const lang = ctx.session?.language || 'en';

    // Initialize metadata if not exists
    if (!ctx.session.liveSessionMetadata) {
      ctx.session.liveSessionMetadata = {};
    }

    // Domain selection
    if (data.startsWith('live_domain_')) {
      const domain = data.replace('live_domain_', '');
      ctx.session.liveSessionMetadata.domain = domain;
      ctx.session.liveSessionStep = 'technologies';
      ctx.session.liveSessionMetadata.technologies = []; // Initialize technologies array

      // Save to DB immediately for persistence
      const telegramId = ctx.from?.id as number;
      if (telegramId) {
        try {
          await this.sessionModel.findOneAndUpdate(
            { telegramChatId: telegramId },
            {
              $set: {
                'metadata.domain': domain,
                'metadata.technologies': [],
              },
            },
            { upsert: false },
          );
        } catch (error) {
          this.logger.warn(`Failed to save metadata to DB: ${error.message}`);
          // Continue anyway - session state is still valid
        }
      }

      await this.askLiveTechnologies(ctx, lang);
      await ctx.answerCallbackQuery();
      return;
    }

    // Technology selection (multiple)
    if (data.startsWith('live_tech_')) {
      const tech = data.replace('live_tech_', '');
      if (tech === 'custom') {
        // User wants to enter technologies manually
        ctx.session.liveSessionStep = 'technologies_custom';
        const customText: Record<string, string> = {
          uz:
            `✍️ <b>Texnologiyalarni qo'lda kiriting</b>\n\n` +
            `Texnologiyalarni vergul bilan ajratib yozing:\n` +
            `Masalan: <code>React, Node.js, PostgreSQL, MongoDB</code>\n\n` +
            `Yoki bir nechta xabar sifatida yuborishingiz mumkin.`,
          ru:
            `✍️ <b>Введите технологии вручную</b>\n\n` +
            `Напишите технологии через запятую:\n` +
            `Например: <code>React, Node.js, PostgreSQL, MongoDB</code>\n\n` +
            `Или вы можете отправить их несколькими сообщениями.`,
          en:
            `✍️ <b>Enter technologies manually</b>\n\n` +
            `Type technologies separated by commas:\n` +
            `Example: <code>React, Node.js, PostgreSQL, MongoDB</code>\n\n` +
            `Or you can send them as multiple messages.`,
        };
        await ctx.reply(customText[lang] || customText['en'], {
          parse_mode: 'HTML',
        });
        await ctx.answerCallbackQuery();
        return;
      }
      if (tech === 'done') {
        // Check if at least one technology selected
        if (!ctx.session.liveSessionMetadata.technologies?.length) {
          const errorText: Record<string, string> = {
            uz: `⚠️ Iltimos, kamida bitta texnologiyani tanlang!`,
            ru: `⚠️ Пожалуйста, выберите хотя бы одну технологию!`,
            en: `⚠️ Please select at least one technology!`,
          };
          await ctx.answerCallbackQuery({
            text: errorText[lang] || errorText['en'],
            show_alert: true,
          });
          return;
        }
        ctx.session.liveSessionStep = 'position';
        await this.askLivePosition(ctx, lang);
        await ctx.answerCallbackQuery();
        return;
      }
      // Toggle technology
      if (!ctx.session.liveSessionMetadata.technologies) {
        ctx.session.liveSessionMetadata.technologies = [];
      }
      const techIndex = ctx.session.liveSessionMetadata.technologies.indexOf(tech);
      if (techIndex === -1) {
        ctx.session.liveSessionMetadata.technologies.push(tech);
      } else {
        ctx.session.liveSessionMetadata.technologies.splice(techIndex, 1);
      }

      // Save to DB immediately for persistence
      const telegramId = ctx.from?.id as number;
      if (telegramId) {
        try {
          await this.sessionModel.findOneAndUpdate(
            { telegramChatId: telegramId },
            {
              $set: {
                'metadata.technologies': ctx.session.liveSessionMetadata.technologies,
              },
            },
            { upsert: false },
          );
        } catch (error) {
          this.logger.warn(`Failed to save technologies to DB: ${error.message}`);
          // Continue anyway - session state is still valid
        }
      }

      // Update keyboard with selected state
      await this.askLiveTechnologies(ctx, lang, true);
      await ctx.answerCallbackQuery();
      return;
    }

    // Position selection
    if (data.startsWith('live_position_')) {
      const position = data.replace('live_position_', '');
      ctx.session.liveSessionMetadata.position = position;
      ctx.session.liveSessionStep = 'company';

      // Save to DB immediately for persistence
      const telegramId = ctx.from?.id as number;
      if (telegramId) {
        try {
          await this.sessionModel.findOneAndUpdate(
            { telegramChatId: telegramId },
            {
              $set: {
                'metadata.position': position,
              },
            },
            { upsert: false },
          );
        } catch (error) {
          this.logger.warn(`Failed to save position to DB: ${error.message}`);
          // Continue anyway - session state is still valid
        }
      }

      await this.askLiveCompany(ctx, lang);
      await ctx.answerCallbackQuery();
      return;
    }
  }

  /**
   * Handle text input for technologies (custom input)
   */
  async handleLiveTechnologiesInput(ctx: BotContext, text: string) {
    if (ctx.session.liveSessionStep === 'technologies_custom') {
      const lang = ctx.session?.language || 'en';

      // Parse technologies from text (comma-separated or newline-separated)
      const technologies = text
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => {
          // Normalize common technology names
          const normalized = t.toLowerCase();
          const techMap: Record<string, string> = {
            react: 'react',
            vue: 'vue',
            'vue.js': 'vue',
            vuejs: 'vue',
            angular: 'angular',
            node: 'nodejs',
            'node.js': 'nodejs',
            nodejs: 'nodejs',
            python: 'python',
            java: 'java',
            'c#': 'csharp',
            csharp: 'csharp',
            go: 'go',
            golang: 'go',
            rust: 'rust',
            typescript: 'typescript',
            ts: 'typescript',
            javascript: 'javascript',
            js: 'javascript',
            postgresql: 'postgresql',
            postgres: 'postgresql',
            mysql: 'mysql',
            mongodb: 'mongodb',
            mongo: 'mongodb',
            redis: 'redis',
            docker: 'docker',
            kubernetes: 'kubernetes',
            k8s: 'kubernetes',
            aws: 'aws',
            azure: 'azure',
            gcp: 'gcp',
            'next.js': 'nextjs',
            nextjs: 'nextjs',
            express: 'express',
            nestjs: 'nestjs',
            nest: 'nestjs',
          };
          return techMap[normalized] || t.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
        });

      if (technologies.length === 0) {
        const errorText: Record<string, string> = {
          uz: `⚠️ Iltimos, kamida bitta texnologiya nomini kiriting.`,
          ru: `⚠️ Пожалуйста, введите хотя бы одно название технологии.`,
          en: `⚠️ Please enter at least one technology name.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      // Initialize technologies array if not exists
      if (!ctx.session.liveSessionMetadata!.technologies) {
        ctx.session.liveSessionMetadata!.technologies = [];
      }

      // Add new technologies (avoid duplicates)
      technologies.forEach((tech) => {
        if (!ctx.session.liveSessionMetadata!.technologies!.includes(tech)) {
          ctx.session.liveSessionMetadata!.technologies!.push(tech);
        }
      });

      // Save to DB immediately
      const telegramId = ctx.from?.id as number;
      if (telegramId) {
        try {
          await this.sessionModel.findOneAndUpdate(
            { telegramChatId: telegramId },
            {
              $set: {
                'metadata.technologies': ctx.session.liveSessionMetadata!.technologies,
              },
            },
            { upsert: false },
          );
        } catch (error) {
          this.logger.warn(`Failed to save technologies to DB: ${error.message}`);
        }
      }

      // Show confirmation with Done button
      const confirmText: Record<string, string> = {
        uz:
          `✅ <b>Texnologiyalar qo'shildi!</b>\n\n` +
          `Tanlangan texnologiyalar: <b>${ctx.session.liveSessionMetadata!.technologies!.join(', ')}</b>\n\n` +
          `Yana qo'shish uchun yozishingiz mumkin. Agar tugatgan bo'lsangiz:`,
        ru:
          `✅ <b>Технологии добавлены!</b>\n\n` +
          `Выбранные технологии: <b>${ctx.session.liveSessionMetadata!.technologies!.join(', ')}</b>\n\n` +
          `Можете написать еще. Если закончили:`,
        en:
          `✅ <b>Technologies added!</b>\n\n` +
          `Selected technologies: <b>${ctx.session.liveSessionMetadata!.technologies!.join(', ')}</b>\n\n` +
          `You can type more. If finished:`,
      };

      const doneButtonText = lang === 'uz' ? '✅ Tugadi' : lang === 'ru' ? '✅ Готово' : '✅ Done';
      const keyboard = new InlineKeyboard().text(doneButtonText, 'live_tech_done');

      await ctx.reply(confirmText[lang] || confirmText['en'], {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      // Do NOT call askLiveTechnologies(ctx, lang) again to avoid spamming the big keyboard
    }
  }

  /**
   * Handle text input for company name
   */
  async handleLiveCompanyInput(ctx: BotContext, text: string) {
    if (ctx.session.liveSessionStep === 'company') {
      let companyName = text.trim();

      // Extract company name if user sends "Kompaniya nomi: AWS" or "Company: AWS" format
      // Check for colon separator first (most common case)
      const colonIndex = companyName.indexOf(':');
      if (colonIndex !== -1) {
        companyName = companyName.substring(colonIndex + 1).trim();
      } else {
        // Try to match patterns like "Kompaniya nomi AWS" or "Company AWS"
        const patternMatch = companyName.match(
          /^(?:kompaniya\s*nomi?|company\s*name?|компания)[\s:]*:?\s*(.+)$/i,
        );
        if (patternMatch && patternMatch[1]) {
          companyName = patternMatch[1].trim();
        }
      }

      // Validate company name
      if (!companyName || companyName.length < 2) {
        const lang = ctx.session?.language || 'en';
        const errorText: Record<string, string> = {
          uz: `⚠️ Kompaniya nomi juda qisqa. Iltimos, to'liq nomini yuboring.`,
          ru: `⚠️ Название компании слишком короткое. Пожалуйста, отправьте полное название.`,
          en: `⚠️ Company name is too short. Please send the full company name.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      if (companyName.length > 100) {
        const lang = ctx.session?.language || 'en';
        const errorText: Record<string, string> = {
          uz: `⚠️ Kompaniya nomi juda uzun. Iltimos, qisqaroq nom yuboring (maksimal 100 belgi).`,
          ru: `⚠️ Название компании слишком длинное. Пожалуйста, отправьте более короткое название (максимум 100 символов).`,
          en: `⚠️ Company name is too long. Please send a shorter name (max 100 characters).`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
        return;
      }

      try {
        ctx.session.liveSessionMetadata!.company = companyName;
        ctx.session.liveSessionStep = 'complete';

        // Now start the live session
        await this.handleStartLive(ctx);
      } catch (error) {
        this.logger.error(
          `Failed to start live session after company input: ${error.message}`,
          error.stack,
        );
        const lang = ctx.session?.language || 'en';
        const errorText: Record<string, string> = {
          uz: `❌ Live sessiyani boshlashda xatolik yuz berdi. Iltimos, /start_live buyrug'ini qayta yuboring.`,
          ru: `❌ Ошибка при запуске live сессии. Пожалуйста, отправьте команду /start_live снова.`,
          en: `❌ Error starting live session. Please send /start_live command again.`,
        };
        await ctx.reply(errorText[lang] || errorText['en']);
      }
    }
  }

  async handleLiveMessage(ctx: BotContext) {
    const telegramId = ctx.from?.id as number;
    const text = ctx.message?.text;

    // Check if we're collecting metadata (not 'active' or 'complete')
    const step = ctx.session.liveSessionStep;
    if (step && step !== 'complete' && step !== 'active') {
      if (text) {
        if (step === 'company') {
          await this.handleLiveCompanyInput(ctx, text);
          return;
        } else if (step === 'technologies_custom') {
          await this.handleLiveTechnologiesInput(ctx, text);
          return;
        } else {
          // User sent text during domain/position selection
          const lang = ctx.session?.language || 'en';
          const errorText: Record<string, string> = {
            uz: `⚠️ Iltimos, tugmalardan birini tanlang. Matn yuborish hozircha mumkin emas.`,
            ru: `⚠️ Пожалуйста, выберите одну из кнопок. Отправка текста сейчас недоступна.`,
            en: `⚠️ Please select one of the buttons. Text input is not available at this step.`,
          };
          await ctx.reply(errorText[lang] || errorText['en']);
          return;
        }
      }
      // If no text and we're in metadata collection, ignore
      return;
    }

    if (!text) {
      return;
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      return;
    }

    // Get language from session, user preferences, or database
    // Priority: session > user.preferences.language > user.language > 'en'
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
        uz: `⏳ Javob tayyorlanmoqda...`,
        ru: `⏳ Генерируется ответ...`,
        en: `⏳ Generating answer...`,
      };
      await ctx.reply(processingText[lang] || processingText['en']);

      // Get or create AI session
      const telegramSession = await this.sessionModel.findOne({
        telegramChatId: telegramId,
        status: 'live_session',
      });

      // Get user ID (handle both _id and id fields)
      const userId = (user as any)._id?.toString() || (user as any).id?.toString() || user.id;
      if (!userId) {
        this.logger.error(`User ID is undefined for Telegram ID: ${telegramId}`);
        const errorText: Record<string, string> = {
          uz: `❌ Xatolik: Foydalanuvchi ID topilmadi.`,
          ru: `❌ Ошибка: ID пользователя не найден.`,
          en: `❌ Error: User ID not found.`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      let sessionId = telegramSession?.context;
      if (!sessionId) {
        const aiSession = await this.contextService.createSession(userId, 'live_interview');
        sessionId = aiSession.id;
        await this.sessionModel.findOneAndUpdate(
          { telegramChatId: telegramId },
          { context: sessionId },
        );
      }

      // Show generating message for better UX (optimized)
      const generatingText: Record<string, string> = {
        uz: `🤖 <b>Javob tayyorlanmoqda...</b>\n⏳ Iltimos kuting...`,
        ru: `🤖 <b>Генерируется ответ...</b>\n⏳ Пожалуйста, подождите...`,
        en: `🤖 <b>Generating answer...</b>\n⏳ Please wait...`,
      };
      let generatingMsg;
      try {
        generatingMsg = await ctx.reply(generatingText[lang] || generatingText['en'], {
          parse_mode: 'HTML',
        });
      } catch {
        // Ignore if message sending fails
      }

      // Get live session metadata for context
      const session = await this.sessionModel.findOne({
        telegramChatId: telegramId,
        status: 'live_session',
      });
      const sessionMetadata = session?.metadata as any;
      const sessionLiveMetadata = ctx.session.liveSessionMetadata;
      const metadata = sessionMetadata || sessionLiveMetadata || {};

      // Generate answer with error handling (optimized for speed)
      let answerResponse;
      let answer;
      try {
        // Use the language we already retrieved (lang is already from DB if session was empty)
        // Optimized: Use medium length for faster generation in live mode
        // Pass metadata for better context-aware answers
        answerResponse = await this.answerService.generateAnswer(userId, {
          question: text,
          sessionId,
          variations: 1,
          style: 'professional',
          length: 'medium', // Optimized: medium length for speed
          language: lang, // Pass user's language preference
          // Pass live session metadata for context
          domain: (metadata as any).domain,
          technologies: (metadata as any).technologies || [],
          position: (metadata as any).position,
          company: (metadata as any).company,
        });
        answer = answerResponse.answers[0];

        // Delete generating message if exists (cleanup)
        if (generatingMsg) {
          try {
            await ctx.api.deleteMessage(generatingMsg.chat.id, generatingMsg.message_id);
          } catch {
            // Ignore delete errors
          }
        }
      } catch (error) {
        this.logger.error(`AI answer generation failed: ${error.message}`, error.stack);
        const errorText: Record<string, string> = {
          uz:
            `❌ <b>Xatolik yuz berdi</b>\n\n` +
            `AI javob yaratishda muammo bo'ldi. Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Qayta urinib ko'ring\n` +
            `• Yoki /end_live bilan sessiyani to'xtating`,
          ru:
            `❌ <b>Произошла ошибка</b>\n\n` +
            `Проблема при генерации AI ответа. Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Попробуйте снова\n` +
            `• Или остановите сессию с /end_live`,
          en:
            `❌ <b>An error occurred</b>\n\n` +
            `Problem generating AI answer. Please:\n` +
            `• Check your internet connection\n` +
            `• Try again\n` +
            `• Or stop the session with /end_live`,
        };
        await ctx.reply(errorText[lang] || errorText['en'], {
          parse_mode: 'HTML',
        });
        return;
      }

      // Format response
      const responseText: Record<string, string> = {
        uz:
          `💡 <b>Javob:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Asosiy nuqtalar:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
        ru:
          `💡 <b>Ответ:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Ключевые моменты:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
        en:
          `💡 <b>Answer:</b>\n\n${answer.content}\n\n` +
          (answer.keyPoints?.length
            ? `📌 <b>Key Points:</b>\n${answer.keyPoints.map((kp) => `• ${kp}`).join('\n')}\n\n`
            : '') +
          `⏱️ ${answerResponse.processingTime}ms`,
      };

      await ctx.reply(responseText[lang] || responseText['en'], {
        parse_mode: 'HTML',
      });

      // Save question and answer to AI context for conversation history
      if (sessionId) {
        try {
          // Add user question to context
          await this.contextService.addMessage(sessionId, {
            role: 'user',
            content: text,
            type: 'question',
            timestamp: new Date(),
          });

          // Add AI answer to context
          await this.contextService.addMessage(sessionId, {
            role: 'assistant',
            content: answer.content,
            type: 'answer',
            timestamp: new Date(),
          });
        } catch (error) {
          this.logger.warn(`Failed to save message to context: ${error.message}`);
          // Continue - not critical for functionality
        }
      }

      // Update session
      await this.sessionModel.findOneAndUpdate(
        { telegramChatId: telegramId },
        {
          $push: {
            messages: {
              timestamp: new Date(),
              type: 'question',
              content: text,
              aiResponse: answer.content,
              processingTime: answerResponse.processingTime,
            },
          },
          lastActivityAt: new Date(),
        },
      );

      // Deduct live interview minutes from user's subscription
      // Each Q&A interaction costs 1 minute
      try {
        const allowed = await this.subscriptionService.addLiveMinutes(userId, 1);
        if (!allowed) {
          // User has exceeded their live interview minutes limit
          const limitText: Record<string, string> = {
            uz: `⚠️ <b>Live intervyu daqiqalari tugadi</b>\n\nSizning oylik live intervyu limitingiz tugadi.\n\nKo'proq daqiqalar uchun rejangizni yangilang: /upgrade`,
            ru: `⚠️ <b>Минуты live-интервью закончились</b>\n\nВаш месячный лимит live-интервью исчерпан.\n\nОбновите тариф для получения большего времени: /upgrade`,
            en: `⚠️ <b>Live interview minutes exhausted</b>\n\nYour monthly live interview limit has been reached.\n\nUpgrade your plan for more minutes: /upgrade`,
          };
          await ctx.reply(limitText[lang] || limitText['en'], {
            parse_mode: 'HTML',
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to deduct live minutes: ${error.message}`);
        // Continue - billing is important but shouldn't break functionality
      }
    } catch (error) {
      this.logger.error(`Error handling live message: ${error.message}`, error.stack);

      // Check if it's a BadRequestException (API key not configured)
      const isApiKeyError =
        error.message?.includes('not configured') || error.message?.includes('OPENAI_API_KEY');

      const errorText: Record<string, string> = {
        uz: isApiKeyError
          ? `❌ <b>AI xizmati sozlanganmagan</b>\n\n` +
            `AI javob yaratish uchun OPENAI_API_KEY sozlanishi kerak.\n\n` +
            `Hozircha faqat matn xabarlarni qabul qilamiz.\n\n` +
            `Live rejimni to'xtatish uchun /end_live buyrug'ini yuboring.`
          : `❌ <b>Xatolik yuz berdi</b>\n\n` +
            `Savolingizni qayta ishlashda muammo bo'ldi.\n\n` +
            `Iltimos:\n` +
            `• Internet aloqasini tekshiring\n` +
            `• Qayta urinib ko'ring\n` +
            `• Yoki /end_live bilan sessiyani to'xtating`,
        ru: isApiKeyError
          ? `❌ <b>AI сервис не настроен</b>\n\n` +
            `Для генерации AI ответов необходимо настроить OPENAI_API_KEY.\n\n` +
            `Пока мы принимаем только текстовые сообщения.\n\n` +
            `Используйте /end_live для остановки live режима.`
          : `❌ <b>Произошла ошибка</b>\n\n` +
            `Проблема при обработке вашего вопроса.\n\n` +
            `Пожалуйста:\n` +
            `• Проверьте интернет-соединение\n` +
            `• Попробуйте снова\n` +
            `• Или остановите сессию с /end_live`,
        en: isApiKeyError
          ? `❌ <b>AI service not configured</b>\n\n` +
            `OPENAI_API_KEY needs to be configured for AI answer generation.\n\n` +
            `For now, we only accept text messages.\n\n` +
            `Use /end_live to stop live mode.`
          : `❌ <b>An error occurred</b>\n\n` +
            `Problem processing your question.\n\n` +
            `Please:\n` +
            `• Check your internet connection\n` +
            `• Try again\n` +
            `• Or stop the session with /end_live`,
      };
      await ctx.reply(errorText[lang] || errorText['en'], {
        parse_mode: 'HTML',
      });
    }
  }

  /**
   * Helper to reply or transition message
   * Transitions (navigation) should use delete+reply for animation.
   * Edits (toggles) should use editMessageText for instant update.
   */
  private async replyOrTransition(
    ctx: BotContext,
    text: string,
    extra: any,
    isToggle: boolean = false,
  ) {
    // If it's a toggle action, try to edit in-place for speed
    if (isToggle && ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, extra);
        return;
      } catch (e) {
        if (e.description?.includes('message is not modified')) {
          return;
        }
      }
    }

    // For navigation/transitions:
    // 1. Answer callback
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});

      // 2. Delete old message (animation)
      await ctx.deleteMessage().catch(() => {});
    }

    // 3. Send new message
    await ctx.reply(text, extra);
  }
}
