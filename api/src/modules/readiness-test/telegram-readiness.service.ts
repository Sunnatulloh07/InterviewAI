import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InlineKeyboard } from 'grammy';

import { ReadinessTestService } from './readiness-test.service';
import {
  IRS_TOTAL_QUESTIONS,
  IRS_POSITIONS,
  IRS_TECH_STACKS,
  IRS_ANSWER_TIME_LIMIT,
  getScoreGrade,
} from './constants/irs.constants';

// BotContext type — telegram.service.ts dan import qilish kerak bo'ladi
// Hozircha any ishlatamiz, module integration da to'g'rilanadi
type BotContext = any;

/**
 * IRS Telegram Bot Handler
 *
 * Barcha IRS-related bot interaksiyalarni boshqaradi:
 * - /irs command
 * - Position va tech stack tanlash
 * - Savollarga javob qabul qilish
 * - Natija ko'rsatish va sharing
 * - Deep link handling (do'st natijasini ko'rish)
 */
@Injectable()
export class TelegramReadinessService {
  private readonly logger = new Logger(TelegramReadinessService.name);

  constructor(
    private readinessTestService: ReadinessTestService,
    private configService: ConfigService,
  ) {}

  // ─── /irs Command Handler ───────────────────────────────────

  /**
   * /irs — IRS testni boshlash
   * Pozitsiya tanlash tugmalarini ko'rsatadi
   */
  async handleIRSStart(ctx: BotContext): Promise<void> {
    const isEnabled = this.configService.get<boolean>('features.irsEnabled');
    if (!isEnabled) {
      await ctx.reply('Bu funksiya hozirda mavjud emas.');
      return;
    }

    const lang = ctx.session?.language || 'uz';
    const text = this.getText(lang, 'start');

    const keyboard = new InlineKeyboard();
    keyboard
      .text('Junior', 'irs_pos_junior')
      .text('Middle', 'irs_pos_middle')
      .row()
      .text('Senior', 'irs_pos_senior')
      .text('Lead', 'irs_pos_lead');

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ─── Position Selection ─────────────────────────────────────

  async handlePositionSelect(
    ctx: BotContext,
    position: string,
  ): Promise<void> {
    if (!IRS_POSITIONS.includes(position as any)) return;

    // Save to session
    ctx.session.irsPosition = position;
    ctx.session.irsStep = 'awaiting_techstack';

    const lang = ctx.session?.language || 'uz';
    const text = this.getText(lang, 'techStack');

    // Tech stack tugmalari (2 qatorli)
    const keyboard = new InlineKeyboard();
    const stacks = [
      { label: 'JavaScript', value: 'javascript' },
      { label: 'TypeScript', value: 'typescript' },
      { label: 'Python', value: 'python' },
      { label: 'Java', value: 'java' },
      { label: 'C#', value: 'csharp' },
      { label: 'Go', value: 'golang' },
      { label: 'React', value: 'react' },
      { label: 'Node.js', value: 'node' },
      { label: 'Vue', value: 'vue' },
      { label: 'Angular', value: 'angular' },
      { label: 'PHP', value: 'php' },
      { label: 'Flutter', value: 'flutter' },
    ];

    for (let i = 0; i < stacks.length; i += 3) {
      const row = stacks.slice(i, i + 3);
      for (const s of row) {
        keyboard.text(s.label, `irs_tech_${s.value}`);
      }
      keyboard.row();
    }

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ─── Tech Stack Selection → Start Test ──────────────────────

  async handleTechStackSelect(
    ctx: BotContext,
    techStack: string,
  ): Promise<void> {
    const position = ctx.session?.irsPosition;
    if (!position) {
      await ctx.reply('Please start again with /irs');
      return;
    }

    const lang = ctx.session?.language || 'uz';
    const telegramId = ctx.from?.id;
    const userId = ctx.session?.userId;

    try {
      // Loading message
      await ctx.editMessageText(
        this.getText(lang, 'loading'),
        { parse_mode: 'HTML' },
      );

      const result = await this.readinessTestService.startTest({
        telegramId,
        userId,
        position,
        techStack,
        language: lang,
      });

      // Save test ID to session
      ctx.session.irsTestId = result.testId;
      ctx.session.irsStep = 'answering_irs';
      ctx.session.irsQuestionStartedAt = Date.now();

      // Show first question
      await this.showQuestion(ctx, result.firstQuestion, lang);
    } catch (error) {
      this.logger.error(`IRS start failed: ${error.message}`);

      // FIX IRS-7: Clear session state on startTest error so user isn't stuck
      ctx.session.irsPosition = undefined;
      ctx.session.irsStep = undefined;
      ctx.session.irsTestId = undefined;
      ctx.session.irsQuestionStartedAt = undefined;

      const errorText =
        error.message?.includes('limit')
          ? this.getText(lang, 'rateLimit')
          : this.getText(lang, 'error');
      await ctx.editMessageText(errorText, { parse_mode: 'HTML' });
    }
  }

  // ─── Answer Handler ─────────────────────────────────────────

  /**
   * Text xabarni IRS javob sifatida qabul qilish
   * (telegram.service.ts dan route qilinadi)
   */
  async handleIRSAnswer(ctx: BotContext, text: string): Promise<void> {
    const testId = ctx.session?.irsTestId;
    const lang = ctx.session?.language || 'uz';

    if (!testId) {
      ctx.session.irsStep = undefined;
      return;
    }

    // Calculate time taken
    const startedAt = ctx.session.irsQuestionStartedAt || Date.now();
    const timeTaken = Math.round((Date.now() - startedAt) / 1000);

    try {
      // Show scoring message
      await ctx.reply(this.getText(lang, 'scoring'), {
        parse_mode: 'HTML',
      });

      const result = await this.readinessTestService.submitAnswer(
        testId,
        text,
        timeTaken,
      );

      // Show score for this question
      await this.showQuestionResult(ctx, result.scored, lang);

      if (result.isCompleted && result.finalResult) {
        // FIX IRS-12: Save testId BEFORE clearing session, for share button
        const completedTestId = testId;

        // Test completed — show final result
        ctx.session.irsStep = undefined;
        ctx.session.irsTestId = undefined;
        ctx.session.irsQuestionStartedAt = undefined;

        await this.showFinalResult(ctx, result.finalResult, lang, completedTestId);
      } else if (result.nextQuestion) {
        // Show next question
        ctx.session.irsQuestionStartedAt = Date.now();
        await this.showQuestion(ctx, result.nextQuestion, lang);
      }
    } catch (error) {
      this.logger.error(`IRS answer submission failed: ${error.message}`);
      await ctx.reply(this.getText(lang, 'error'), { parse_mode: 'HTML' });
    }
  }

  // ─── Share Handler ──────────────────────────────────────────

  async handleIRSShare(ctx: BotContext, testId: string): Promise<void> {
    const test = await this.readinessTestService.getTestById(testId);
    if (!test) return;

    const lang = ctx.session?.language || 'uz';
    const botUsername =
      this.configService.get<string>('TELEGRAM_BOT_USERNAME') || 'jobi_it_bot';
    const shareLink = `https://t.me/${botUsername}?start=irs_${test.shareToken}`;
    const grade = getScoreGrade(test.totalScore || 0);

    const shareText: Record<string, string> = {
      uz: `${grade.emoji} Men Jobi IRS testida ${test.totalScore}/100 ball oldim! Siz nechta olasiz?`,
      ru: `${grade.emoji} Я набрал ${test.totalScore}/100 в IRS тесте Jobi! А сколько наберёте вы?`,
      en: `${grade.emoji} I scored ${test.totalScore}/100 on Jobi IRS test! How about you?`,
    };

    const keyboard = new InlineKeyboard()
      .switchInline(
        this.getText(lang, 'shareButton'),
        shareText[lang] || shareText.uz,
      )
      .row()
      .url(
        this.getText(lang, 'linkButton'),
        shareLink,
      );

    await ctx.reply(this.getText(lang, 'sharePrompt'), {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ─── Deep Link Handler ──────────────────────────────────────

  /**
   * /start irs_{shareToken} — do'st natijasini ko'rish
   */
  async handleIRSDeepLink(
    ctx: BotContext,
    shareToken: string,
  ): Promise<void> {
    const lang = ctx.session?.language || 'uz';
    const test = await this.readinessTestService.getTestByShareToken(
      shareToken,
    );

    if (!test) {
      await ctx.reply(this.getText(lang, 'notFound'), {
        parse_mode: 'HTML',
      });
      return;
    }

    const grade = getScoreGrade(test.totalScore || 0);

    const resultText: Record<string, string> = {
      uz:
        `${grade.emoji} <b>Do'stingizning IRS natijasi</b>\n\n` +
        `Pozitsiya: <b>${test.position}</b>\n` +
        `Texnologiya: <b>${test.techStack}</b>\n` +
        `Ball: <b>${test.totalScore}/100</b> (${grade.label})\n\n` +
        `Siz ham sinab ko'ring!`,
      ru:
        `${grade.emoji} <b>Результат IRS друга</b>\n\n` +
        `Позиция: <b>${test.position}</b>\n` +
        `Технология: <b>${test.techStack}</b>\n` +
        `Баллы: <b>${test.totalScore}/100</b> (${grade.label})\n\n` +
        `Попробуйте сами!`,
      en:
        `${grade.emoji} <b>Your friend's IRS result</b>\n\n` +
        `Position: <b>${test.position}</b>\n` +
        `Technology: <b>${test.techStack}</b>\n` +
        `Score: <b>${test.totalScore}/100</b> (${grade.label})\n\n` +
        `Try it yourself!`,
    };

    const keyboard = new InlineKeyboard().text(
      this.getText(lang, 'tryTest'),
      'irs_start_from_deeplink',
    );

    await ctx.reply(resultText[lang] || resultText.uz, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ─── Display Helpers ────────────────────────────────────────

  private async showQuestion(
    ctx: BotContext,
    question: {
      index: number;
      text: string;
      category: string;
      difficulty: string;
      timeLimit: number;
    },
    lang: string,
  ): Promise<void> {
    const categoryEmoji: Record<string, string> = {
      technical: '💻',
      behavioral: '🗣',
      problemSolving: '🧩',
      systemDesign: '🏗',
    };

    const difficultyText: Record<string, Record<string, string>> = {
      easy: { uz: 'Oson', ru: 'Легко', en: 'Easy' },
      medium: { uz: "O'rta", ru: 'Средне', en: 'Medium' },
      hard: { uz: 'Qiyin', ru: 'Сложно', en: 'Hard' },
    };

    const emoji = categoryEmoji[question.category] || '📝';
    const diff = difficultyText[question.difficulty]?.[lang] || question.difficulty;

    const header: Record<string, string> = {
      uz: `${emoji} <b>Savol ${question.index + 1}/${IRS_TOTAL_QUESTIONS}</b>  |  ${diff}\n\n`,
      ru: `${emoji} <b>Вопрос ${question.index + 1}/${IRS_TOTAL_QUESTIONS}</b>  |  ${diff}\n\n`,
      en: `${emoji} <b>Question ${question.index + 1}/${IRS_TOTAL_QUESTIONS}</b>  |  ${diff}\n\n`,
    };

    const footer: Record<string, string> = {
      uz: `\n\n⏱ Vaqt: ${question.timeLimit} soniya. Javobingizni yozing:`,
      ru: `\n\n⏱ Время: ${question.timeLimit} секунд. Напишите ваш ответ:`,
      en: `\n\n⏱ Time: ${question.timeLimit} seconds. Write your answer:`,
    };

    const text =
      (header[lang] || header.uz) +
      question.text +
      (footer[lang] || footer.uz);

    await ctx.reply(text, { parse_mode: 'HTML' });
  }

  private async showQuestionResult(
    ctx: BotContext,
    scored: { scores: Record<string, number>; weightedScore: number; feedback: string; quickTip: string },
    lang: string,
  ): Promise<void> {
    const scoreEmoji = scored.weightedScore >= 7 ? '✅' : scored.weightedScore >= 5 ? '📊' : '⚠️';

    const text: Record<string, string> = {
      uz:
        `${scoreEmoji} <b>Baholash:</b> ${scored.weightedScore}/10\n\n` +
        `${scored.feedback}` +
        (scored.quickTip ? `\n\n💡 <i>${scored.quickTip}</i>` : ''),
      ru:
        `${scoreEmoji} <b>Оценка:</b> ${scored.weightedScore}/10\n\n` +
        `${scored.feedback}` +
        (scored.quickTip ? `\n\n💡 <i>${scored.quickTip}</i>` : ''),
      en:
        `${scoreEmoji} <b>Score:</b> ${scored.weightedScore}/10\n\n` +
        `${scored.feedback}` +
        (scored.quickTip ? `\n\n💡 <i>${scored.quickTip}</i>` : ''),
    };

    await ctx.reply(text[lang] || text.uz, { parse_mode: 'HTML' });
  }

  private async showFinalResult(
    ctx: BotContext,
    result: {
      totalScore: number;
      categoryScores: Record<string, number>;
      percentile: number;
      grade: { label: string; emoji: string; level: string };
      shareToken: string;
    },
    lang: string,
    testId?: string,  // FIX IRS-12: Accept testId directly instead of relying on cleared session
  ): Promise<void> {
    const cs = result.categoryScores;

    const text: Record<string, string> = {
      uz:
        `${result.grade.emoji} <b>IRS NATIJA</b>\n\n` +
        `Ball: <b>${result.totalScore}/100</b> (${result.grade.label})\n` +
        `Siz top <b>${result.percentile}%</b> ichida!\n\n` +
        `━━━ Kategoriyalar ━━━\n` +
        `💻 Texnik: ${cs.technical || 0}/100\n` +
        `🧩 Muammoni hal qilish: ${cs.problemSolving || 0}/100\n` +
        `🗣 Muloqot: ${cs.communication || 0}/100\n` +
        `📋 Xulq-atvor: ${cs.behavioral || 0}/100\n` +
        `🏗 Tizim dizayni: ${cs.systemDesign || 0}/100\n\n` +
        `Natijangizni do'stlaringiz bilan ulashing!`,
      ru:
        `${result.grade.emoji} <b>РЕЗУЛЬТАТ IRS</b>\n\n` +
        `Баллы: <b>${result.totalScore}/100</b> (${result.grade.label})\n` +
        `Вы в топ <b>${result.percentile}%</b>!\n\n` +
        `━━━ Категории ━━━\n` +
        `💻 Техника: ${cs.technical || 0}/100\n` +
        `🧩 Решение задач: ${cs.problemSolving || 0}/100\n` +
        `🗣 Коммуникация: ${cs.communication || 0}/100\n` +
        `📋 Поведение: ${cs.behavioral || 0}/100\n` +
        `🏗 Системный дизайн: ${cs.systemDesign || 0}/100\n\n` +
        `Поделитесь результатом с друзьями!`,
      en:
        `${result.grade.emoji} <b>IRS RESULT</b>\n\n` +
        `Score: <b>${result.totalScore}/100</b> (${result.grade.label})\n` +
        `You're in the top <b>${result.percentile}%</b>!\n\n` +
        `━━━ Categories ━━━\n` +
        `💻 Technical: ${cs.technical || 0}/100\n` +
        `🧩 Problem Solving: ${cs.problemSolving || 0}/100\n` +
        `🗣 Communication: ${cs.communication || 0}/100\n` +
        `📋 Behavioral: ${cs.behavioral || 0}/100\n` +
        `🏗 System Design: ${cs.systemDesign || 0}/100\n\n` +
        `Share your result with friends!`,
    };

    // FIX IRS-12: Use passed testId instead of ctx.session.irsTestId (already cleared)
    const keyboard = new InlineKeyboard()
      .text(
        this.getText(lang, 'shareButton'),
        `irs_share_${testId || ctx.session?.irsTestId || ''}`,
      )
      .row()
      .text(
        this.getText(lang, 'retryButton'),
        'irs_start_from_deeplink',
      );

    await ctx.reply(text[lang] || text.uz, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  // ─── Multilingual Texts ─────────────────────────────────────

  private getText(lang: string, key: string): string {
    const texts: Record<string, Record<string, string>> = {
      start: {
        uz: "🎯 <b>Interview Readiness Test</b>\n\nIntervyuga tayyorlik darajangizni bilmoqchimisiz?\n5 ta savolga javob bering — 3 daqiqada natija!\n\n📋 Pozitsiyangizni tanlang:",
        ru: '🎯 <b>Interview Readiness Test</b>\n\nХотите узнать свой уровень готовности к собеседованию?\n5 вопросов — результат за 3 минуты!\n\n📋 Выберите вашу позицию:',
        en: '🎯 <b>Interview Readiness Test</b>\n\nWant to know your interview readiness level?\n5 questions — results in 3 minutes!\n\n📋 Select your position:',
      },
      techStack: {
        uz: '🛠 <b>Texnologiyangizni tanlang:</b>',
        ru: '🛠 <b>Выберите вашу технологию:</b>',
        en: '🛠 <b>Select your technology:</b>',
      },
      loading: {
        uz: '⏳ Savollar tayyorlanmoqda...',
        ru: '⏳ Подготавливаем вопросы...',
        en: '⏳ Preparing questions...',
      },
      scoring: {
        uz: '⏳ Javobingiz baholanmoqda...',
        ru: '⏳ Оцениваем ваш ответ...',
        en: '⏳ Scoring your answer...',
      },
      rateLimit: {
        uz: '⚠️ Kunlik test limiti tugadi. Ertaga qayta urinib ko\'ring.',
        ru: '⚠️ Дневной лимит тестов исчерпан. Попробуйте завтра.',
        en: '⚠️ Daily test limit reached. Try again tomorrow.',
      },
      error: {
        uz: '⚠️ Xatolik yuz berdi. /irs orqali qayta urinib ko\'ring.',
        ru: '⚠️ Произошла ошибка. Попробуйте снова через /irs.',
        en: '⚠️ An error occurred. Try again with /irs.',
      },
      notFound: {
        uz: '❌ Bu test natijasi topilmadi.',
        ru: '❌ Результат теста не найден.',
        en: '❌ Test result not found.',
      },
      shareButton: {
        uz: '📤 Ulashish',
        ru: '📤 Поделиться',
        en: '📤 Share',
      },
      linkButton: {
        uz: '🔗 Havolani nusxalash',
        ru: '🔗 Скопировать ссылку',
        en: '🔗 Copy link',
      },
      sharePrompt: {
        uz: '📤 Natijangizni ulashing:',
        ru: '📤 Поделитесь результатом:',
        en: '📤 Share your result:',
      },
      tryTest: {
        uz: '🎯 Men ham sinab ko\'raman!',
        ru: '🎯 Тоже хочу попробовать!',
        en: '🎯 I want to try too!',
      },
      retryButton: {
        uz: '🔄 Qayta topshirish',
        ru: '🔄 Пройти ещё раз',
        en: '🔄 Take again',
      },
    };

    return texts[key]?.[lang] || texts[key]?.uz || key;
  }
}
