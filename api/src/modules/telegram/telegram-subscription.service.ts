import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  USAGE_LIMITS,
  PLAN_FEATURES,
  SubscriptionPlan,
  getPlanLimits,
} from '@common/constants';
import { BotContext } from './telegram.service';
import { InlineKeyboard } from 'grammy';

/**
 * Service for managing subscription-related Telegram messages
 * Handles trial warnings, upgrade prompts, and usage notifications
 */
@Injectable()
export class TelegramSubscriptionService {
  private readonly logger = new Logger(TelegramSubscriptionService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  /**
   * Check user subscription and send appropriate warnings
   * Returns false if user is blocked (trial expired)
   * @param ctx - Bot context
   * @param user - User document (already fetched to avoid duplicate query)
   */
  async checkAndNotify(ctx: BotContext, user: any): Promise<boolean> {
    if (!user) return false;

    const lang = user.language || user.preferences?.language || 'uz';
    const subscription = user.subscription;

    // Check trial expiry
    if (subscription?.plan === 'free_trial') {
      const now = new Date();
      const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;

      if (trialEnd) {
        const daysRemaining = Math.ceil(
          (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Trial expired
        if (daysRemaining <= 0) {
          await this.sendTrialExpiredMessage(ctx, lang);
          return false;
        }

        // Warning: 3 days, 1 day, last day
        if (daysRemaining <= 3) {
          await this.sendTrialWarning(ctx, lang, daysRemaining);
        }
      }
    }

    // Check subscription expiry for paid plans
    if (subscription?.status === 'expired') {
      await this.sendSubscriptionExpiredMessage(ctx, lang);
      return false;
    }

    return true;
  }

  /**
   * Send trial expired message with upgrade CTA
   */
  async sendTrialExpiredMessage(ctx: BotContext, lang: string): Promise<void> {
    const messages: Record<string, string> = {
      uz: `⚠️ <b>Sinov muddati tugadi!</b>

Sizning 7 kunlik bepul sinov muddatingiz tugadi. 
Davom etish uchun tarifni tanlang:

💼 <b>STARTER</b> - $10/oy
• 10 ta mock intervyu/oy
• 10 daq mock + 15 daq live ovoz
• 5 ta CV tahlili/oy
• 1 ta kunlik topshiriq

🚀 <b>PRO</b> - $20/oy
• 30 ta mock intervyu/oy
• 30 daq mock + 45 daq live ovoz
• 15 ta CV tahlili/oy
• Haftalik AI tavsiyalar

👑 <b>ELITE</b> - $30/oy
• Cheksiz mock intervyu
• 60 daq mock + 120 daq live ovoz
• Cheksiz CV tahlili
• 2 ta kunlik topshiriq
• Priority support

📞 Tarifni yangilash uchun @interviewai_support_bot ga murojaat qiling.`,
      ru: `⚠️ <b>Пробный период истек!</b>

Ваш 7-дневный бесплатный период закончился.
Выберите тариф для продолжения:

💼 <b>STARTER</b> - $10/мес
• 10 mock-интервью/мес
• 10 мин mock + 15 мин live голос
• 5 анализов CV/мес
• 1 ежедневное задание

🚀 <b>PRO</b> - $20/мес
• 30 mock-интервью/мес
• 30 мин mock + 45 мин live голос
• 15 анализов CV/мес
• Еженедельные AI рекомендации

👑 <b>ELITE</b> - $30/мес
• Безлимитные mock-интервью
• 60 мин mock + 120 мин live голос
• Безлимитные анализы CV
• 2 ежедневных задания
• Priority support

📞 Для обновления тарифа обратитесь в @interviewai_support_bot.`,
      en: `⚠️ <b>Trial Period Expired!</b>

Your 7-day free trial has ended.
Choose a plan to continue:

💼 <b>STARTER</b> - $10/mo
• 10 mock interviews/mo
• 10 min mock + 15 min live voice
• 5 CV analyses/mo
• 1 daily task

🚀 <b>PRO</b> - $20/mo
• 30 mock interviews/mo
• 30 min mock + 45 min live voice
• 15 CV analyses/mo
• Weekly AI recommendations

👑 <b>ELITE</b> - $30/mo
• Unlimited mock interviews
• 60 min mock + 120 min live voice
• Unlimited CV analyses
• 2 daily tasks
• Priority support

📞 Contact @interviewai_support_bot to upgrade.`,
    };

    const keyboard = new InlineKeyboard()
      .text('💼 Starter', 'upgrade_starter')
      .text('🚀 Pro', 'upgrade_pro')
      .row()
      .text('👑 Elite', 'upgrade_elite')
      .text('📞 Support', 'contact_support');

    await ctx.reply(messages[lang] || messages['uz'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Send trial warning (3 days, 1 day remaining)
   */
  async sendTrialWarning(ctx: BotContext, lang: string, daysRemaining: number): Promise<void> {
    const dayText: Record<string, Record<number, string>> = {
      uz: {
        1: '⏰ <b>Sinov muddati tugashiga 1 kun qoldi!</b>',
        2: '⏰ <b>Sinov muddati tugashiga 2 kun qoldi!</b>',
        3: '⏰ <b>Sinov muddati tugashiga 3 kun qoldi!</b>',
      },
      ru: {
        1: '⏰ <b>До конца пробного периода остался 1 день!</b>',
        2: '⏰ <b>До конца пробного периода осталось 2 дня!</b>',
        3: '⏰ <b>До конца пробного периода осталось 3 дня!</b>',
      },
      en: {
        1: '⏰ <b>1 day left in your trial!</b>',
        2: '⏰ <b>2 days left in your trial!</b>',
        3: '⏰ <b>3 days left in your trial!</b>',
      },
    };

    const upgradeText: Record<string, string> = {
      uz: '\n\n💡 Yangilash uchun /upgrade yozing yoki quyidagi tugmani bosing:',
      ru: '\n\n💡 Для обновления введите /upgrade или нажмите кнопку ниже:',
      en: '\n\n💡 Type /upgrade or click the button below to upgrade:',
    };

    const langTexts = dayText[lang] || dayText['uz'];
    const message =
      (langTexts[daysRemaining] || langTexts[3]) + (upgradeText[lang] || upgradeText['uz']);

    const keyboard = new InlineKeyboard().text('⬆️ Upgrade', 'show_plans');

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Send subscription expired message
   */
  async sendSubscriptionExpiredMessage(ctx: BotContext, lang: string): Promise<void> {
    const messages: Record<string, string> = {
      uz: `⚠️ <b>Obuna muddati tugadi!</b>

Tarifingiz muddati tugadi. Davom etish uchun yangilang.
📞 @interviewai_support_bot ga murojaat qiling.`,
      ru: `⚠️ <b>Подписка истекла!</b>

Срок вашей подписки истек. Обновите для продолжения.
📞 Обратитесь в @interviewai_support_bot.`,
      en: `⚠️ <b>Subscription Expired!</b>

Your subscription has expired. Please renew to continue.
📞 Contact @interviewai_support_bot.`,
    };

    await ctx.reply(messages[lang] || messages['uz'], { parse_mode: 'HTML' });
  }

  /**
   * Send usage limit warning
   */
  async sendUsageLimitWarning(
    ctx: BotContext,
    lang: string,
    usageType: string,
    current: number,
    limit: number,
  ): Promise<void> {
    const typeNames: Record<string, Record<string, string>> = {
      uz: {
        mockInterviews: 'Mock intervyular',
        liveInterviewMinutes: 'Live intervyu daqiqalari',
        cvAnalyses: 'CV tahlillari',
      },
      ru: {
        mockInterviews: 'Mock-интервью',
        liveInterviewMinutes: 'Live-интервью минуты',
        cvAnalyses: 'Анализ CV',
      },
      en: {
        mockInterviews: 'Mock interviews',
        liveInterviewMinutes: 'Live interview minutes',
        cvAnalyses: 'CV analyses',
      },
    };

    const typeName = typeNames[lang]?.[usageType] || usageType;

    // Handle edge cases
    let percentage = 0;
    if (limit > 0) {
      percentage = Math.round((current / limit) * 100);
    } else if (limit === 0) {
      percentage = 100;
    }

    const displayLimit = limit === -1 ? '∞' : limit;
    const isLimitReached = percentage >= 100;

    const messages: Record<string, string> = {
      uz: `📊 <b>Limit holati:</b> ${typeName}

${current}/${displayLimit} ishlatildi (${percentage}%)

${isLimitReached ? '⛔️ Limit tugadi!' : percentage >= 90 ? '⚠️ Limitga yaqinlashyapsiz!' : ''}
💡 Yangilash uchun /upgrade yozing.`,
      ru: `📊 <b>Статус лимита:</b> ${typeName}

${current}/${displayLimit} использовано (${percentage}%)

${isLimitReached ? '⛔️ Лимит исчерпан!' : percentage >= 90 ? '⚠️ Приближаетесь к лимиту!' : ''}
💡 Введите /upgrade для обновления.`,
      en: `📊 <b>Limit Status:</b> ${typeName}

${current}/${displayLimit} used (${percentage}%)

${isLimitReached ? '⛔️ Limit reached!' : percentage >= 90 ? '⚠️ Approaching your limit!' : ''}
💡 Type /upgrade to upgrade.`,
    };

    await ctx.reply(messages[lang] || messages['uz'], { parse_mode: 'HTML' });
  }

  /**
   * Check CV analysis usage limit and send warning if approaching limit
   * Returns false if limit is reached (blocks action)
   * @param notify If true, sends warning messages to user. If false, just checks limit.
   */
  async checkCvAnalysisLimit(
    ctx: BotContext,
    user: any,
    lang: string,
    notify: boolean = true,
  ): Promise<boolean> {
    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    // FIX #57: Use COMPLETE_PLAN_LIMITS (single source of truth) instead of legacy USAGE_LIMITS
    const planLimits = getPlanLimits(plan);
    const usage = user.usage || {};

    const current = usage.cvAnalysesThisMonth || 0;
    const limit = planLimits.cvAnalysis.perMonth; // -1 = unlimited

    // Unlimited check
    if (limit === -1) return true;

    // Limit reached
    if (current >= limit) {
      if (!notify) return false;

      const messages: Record<string, string> = {
        uz: `⚠️ <b>CV tahlili limiti tugadi!</b>

Bu oyda ${limit} ta CV tahlil qildingiz.
Davom etish uchun tarifni yangilang.

💡 /upgrade - Tariflarni ko'rish`,
        ru: `⚠️ <b>Лимит анализа CV исчерпан!</b>

Вы проанализировали ${limit} CV в этом месяце.
Обновите тариф для продолжения.

💡 /upgrade - Посмотреть тарифы`,
        en: `⚠️ <b>CV analysis limit reached!</b>

You've analyzed ${limit} CVs this month.
Upgrade your plan to continue.

💡 /upgrade - View plans`,
      };

      const keyboard = new InlineKeyboard().text('⬆️ Upgrade', 'show_plans');

      await ctx.reply(messages[lang] || messages['en'], {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return false;
    }

    // Warning: 80% or more used
    const percentage = Math.round((current / limit) * 100);
    if (percentage >= 80) {
      const remaining = limit - current;
      const messages: Record<string, string> = {
        uz: `📊 <b>CV tahlili limiti ogohlantirishi</b>

${current}/${limit} ishlatildi (${percentage}%)
Qoldi: ${remaining} ta

💡 Ko'proq limit uchun /upgrade`,
        ru: `📊 <b>Предупреждение о лимите CV</b>

${current}/${limit} использовано (${percentage}%)
Осталось: ${remaining}

💡 /upgrade для увеличения лимита`,
        en: `📊 <b>CV Analysis Limit Warning</b>

${current}/${limit} used (${percentage}%)
Remaining: ${remaining}

💡 /upgrade for more`,
      };

      await ctx.reply(messages[lang] || messages['en'], { parse_mode: 'HTML' });
    }

    return true;
  }

  /**
   * Check mock interview usage limit and send warning if approaching limit
   * Returns false if limit is reached (blocks action)
   */
  async checkMockInterviewLimit(ctx: BotContext, user: any, lang: string): Promise<boolean> {
    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    // FIX #57: Use COMPLETE_PLAN_LIMITS (single source of truth) instead of legacy USAGE_LIMITS
    const planLimits = getPlanLimits(plan);
    const usage = user.usage || {};

    const current = usage.mockInterviewsThisMonth || 0;
    const limit = planLimits.mockInterviews.perMonth; // -1 = unlimited

    // Unlimited check
    if (limit === -1) return true;

    // Limit reached
    if (current >= limit) {
      const messages: Record<string, string> = {
        uz: `⚠️ <b>Mock intervyu limiti tugadi!</b>

Bu oyda ${limit} ta mock intervyu o'tkazdingiz.
Davom etish uchun tarifni yangilang.

💡 /upgrade - Tariflarni ko'rish`,
        ru: `⚠️ <b>Лимит mock-интервью исчерпан!</b>

Вы провели ${limit} mock-интервью в этом месяце.
Обновите тариф для продолжения.

💡 /upgrade - Посмотреть тарифы`,
        en: `⚠️ <b>Mock interview limit reached!</b>

You've completed ${limit} mock interviews this month.
Upgrade your plan to continue.

💡 /upgrade - View plans`,
      };

      const keyboard = new InlineKeyboard().text('⬆️ Upgrade', 'show_plans');

      await ctx.reply(messages[lang] || messages['en'], {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return false;
    }

    // Warning: 80% or more used
    const percentage = Math.round((current / limit) * 100);
    if (percentage >= 80) {
      const remaining = limit - current;
      const messages: Record<string, string> = {
        uz: `📊 <b>Mock intervyu limiti ogohlantirishi</b>

${current}/${limit} ishlatildi (${percentage}%)
Qoldi: ${remaining} ta

💡 Ko'proq limit uchun /upgrade`,
        ru: `📊 <b>Предупреждение о лимите mock-интервью</b>

${current}/${limit} использовано (${percentage}%)
Осталось: ${remaining}

💡 /upgrade для увеличения лимита`,
        en: `📊 <b>Mock Interview Limit Warning</b>

${current}/${limit} used (${percentage}%)
Remaining: ${remaining}

💡 /upgrade for more`,
      };

      await ctx.reply(messages[lang] || messages['en'], { parse_mode: 'HTML' });
    }

    return true;
  }

  /**
   * Send plan comparison message
   */
  async sendPlanComparison(ctx: BotContext, lang: string): Promise<void> {
    // ALIGNED with COMPLETE_PLAN_LIMITS (single source of truth)
    const messages: Record<string, string> = {
      uz: `📋 <b>Tariflar</b>

💼 <b>STARTER</b> - $10/oy
───────────────────────
✅ 10 ta mock intervyu/oy
✅ 10 daqiqa ovozli mashq
✅ 15 daqiqa live intervyu
✅ 5 ta CV tahlili
✅ 1 ta kunlik topshiriq
✅ Oylik AI hisobot

🚀 <b>PRO</b> - $20/oy
───────────────────────
✅ 30 ta mock intervyu/oy
✅ 30 daqiqa ovozli mashq
✅ 45 daqiqa live intervyu
✅ 15 ta CV tahlili
✅ 1 ta kunlik topshiriq
✅ Haftalik AI tavsiyalar

👑 <b>ELITE</b> - $30/oy
───────────────────────
✅ Cheksiz mock intervyu
✅ 60 daqiqa ovozli mashq
✅ 120 daqiqa live intervyu
✅ Cheksiz CV tahlili
✅ 2 ta kunlik topshiriq
✅ Shaxsiy karyera rejasi
✅ Priority support

📞 @interviewai_support_bot`,
      ru: `📋 <b>Тарифы</b>

💼 <b>STARTER</b> - $10/мес
───────────────────────
✅ 10 mock интервью/мес
✅ 10 минут голосовой практики
✅ 15 минут live интервью
✅ 5 анализов CV
✅ 1 ежедневное задание
✅ Месячный AI отчёт

🚀 <b>PRO</b> - $20/мес
───────────────────────
✅ 30 mock интервью/мес
✅ 30 минут голосовой практики
✅ 45 минут live интервью
✅ 15 анализов CV
✅ 1 ежедневное задание
✅ Еженедельные AI рекомендации

👑 <b>ELITE</b> - $30/мес
───────────────────────
✅ Безлимит mock интервью
✅ 60 минут голосовой практики
✅ 120 минут live интервью
✅ Безлимит анализ CV
✅ 2 ежедневных задания
✅ Персональный план карьеры
✅ Priority support

📞 @interviewai_support_bot`,
      en: `📋 <b>Plans</b>

💼 <b>STARTER</b> - $10/mo
───────────────────────
✅ 10 mock interviews/mo
✅ 10 min voice practice
✅ 15 min live interview
✅ 5 CV analyses
✅ 1 daily task
✅ Monthly AI report

🚀 <b>PRO</b> - $20/mo
───────────────────────
✅ 30 mock interviews/mo
✅ 30 min voice practice
✅ 45 min live interview
✅ 15 CV analyses
✅ 1 daily task
✅ Weekly AI recommendations

👑 <b>ELITE</b> - $30/mo
───────────────────────
✅ Unlimited mock interviews
✅ 60 min voice practice
✅ 120 min live interview
✅ Unlimited CV analyses
✅ 2 daily tasks
✅ Personal career roadmap
✅ Priority support

📞 @interviewai_support_bot`,
    };

    const supportText: Record<string, string> = {
      uz: '📞 Yordam',
      ru: '📞 Поддержка',
      en: '📞 Support',
    };

    const keyboard = new InlineKeyboard()
      .text('💼 Starter', 'upgrade_starter')
      .text('🚀 Pro', 'upgrade_pro')
      .text('👑 Elite', 'upgrade_elite')
      .row()
      .url(supportText[lang] || supportText['en'], 'https://t.me/interviewai_support_bot'); // Direct link

    const backText: Record<string, string> = {
      uz: '⬅️ Asosiy menyu',
      ru: '⬅️ Главное меню',
      en: '⬅️ Main Menu',
    };
    keyboard.row().text(backText[lang] || backText['en'], 'back_to_menu');

    await ctx.reply(messages[lang] || messages['uz'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Get subscription status text for profile
   */
  getSubscriptionStatusText(user: any, lang: string): string {
    const subscription = user.subscription;
    const plan = subscription?.plan || 'free_trial';
    const status = subscription?.status || 'trialing';

    const planNames: Record<string, Record<string, string>> = {
      uz: {
        free_trial: '🆓 Bepul sinov',
        starter: '💼 Starter',
        pro: '🚀 Pro',
        elite: '👑 Elite',
      },
      ru: {
        free_trial: '🆓 Пробный',
        starter: '💼 Starter',
        pro: '🚀 Pro',
        elite: '👑 Elite',
      },
      en: {
        free_trial: '🆓 Free Trial',
        starter: '💼 Starter',
        pro: '🚀 Pro',
        elite: '👑 Elite',
      },
    };

    const statusText: Record<string, Record<string, string>> = {
      uz: {
        trialing: '(sinov)',
        active: '(faol)',
        expired: '(tugagan)',
        cancelled: '(bekor qilingan)',
      },
      ru: {
        trialing: '(пробный)',
        active: '(активна)',
        expired: '(истекла)',
        cancelled: '(отменена)',
      },
      en: {
        trialing: '(trialing)',
        active: '(active)',
        expired: '(expired)',
        cancelled: '(cancelled)',
      },
    };

    const planName = planNames[lang]?.[plan] || planNames['uz'][plan];
    const statusLabel = statusText[lang]?.[status] || '';

    let result = `<b>Tarif:</b> ${planName} ${statusLabel}`;

    // Add trial days remaining
    if (plan === 'free_trial' && subscription?.trialEndsAt) {
      const trialEnd = new Date(subscription.trialEndsAt);
      const now = new Date();
      const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining > 0) {
        const daysText =
          lang === 'uz'
            ? `(${daysRemaining} kun qoldi)`
            : lang === 'ru'
              ? `(осталось ${daysRemaining} дней)`
              : `(${daysRemaining} days left)`;
        result += `\n⏰ ${daysText}`;
      }
    }

    return result;
  }

  /**
   * Get usage statistics text
   */
  getUsageStatsText(user: any, lang: string): string {
    const plan = (user.subscription?.plan || 'free_trial') as SubscriptionPlan;
    // FIX #58: Use COMPLETE_PLAN_LIMITS (single source of truth) instead of legacy USAGE_LIMITS
    const planLimits = getPlanLimits(plan);
    const usage = user.usage || {};

    const labels: Record<string, Record<string, string>> = {
      uz: {
        mock: 'Mock intervyular',
        live: 'Live daqiqalari',
        cv: 'CV tahlillari',
      },
      ru: {
        mock: 'Mock-интервью',
        live: 'Live минуты',
        cv: 'Анализ CV',
      },
      en: {
        mock: 'Mock interviews',
        live: 'Live minutes',
        cv: 'CV analyses',
      },
    };

    const l = labels[lang] || labels['uz'];
    const formatLimit = (current: number, limit: number) =>
      limit === -1 ? `${current}/∞` : `${current}/${limit}`;

    return `📊 <b>Ishlatilgan:</b>
• ${l.mock}: ${formatLimit(usage.mockInterviewsThisMonth || 0, planLimits.mockInterviews.perMonth)}
• ${l.live}: ${formatLimit(usage.liveInterviewMinutesThisMonth || 0, planLimits.voice.realVoice)}
• ${l.cv}: ${formatLimit(usage.cvAnalysesThisMonth || 0, planLimits.cvAnalysis.perMonth)}`;
  }

  // ============================================================
  // CALLBACK HANDLERS FOR SUBSCRIPTION BUTTONS
  // ============================================================

  /**
   * Handle upgrade request for a specific plan
   * Shows plan details and contact info for payment
   */
  /**
   * ✅ UPDATED: Now uses COMPLETE_PLAN_LIMITS for accurate plan details
   */
  async handleUpgradeCallback(
    ctx: BotContext,
    plan: 'starter' | 'pro' | 'elite',
    lang: string,
  ): Promise<void> {
    // Import COMPLETE_PLAN_LIMITS at runtime
    const { COMPLETE_PLAN_LIMITS } = require('@common/constants/plan-limits.constant');
    const planLimits = COMPLETE_PLAN_LIMITS[plan];

    const planDetails: Record<
      string,
      Record<string, { emoji: string; name: string; price: string; features: string[] }>
    > = {
      uz: {
        starter: {
          emoji: '💼',
          name: 'STARTER',
          price: '$10/oy',
          features: [
            `✓ ${planLimits.mockInterviews.perMonth} ta mock intervyu/oy`,
            `✓ ${planLimits.voice.mockVoice} daq mock + ${planLimits.voice.realVoice} daq live ovoz`,
            `✓ ${planLimits.cvAnalysis.perMonth} ta CV tahlili`,
            '✓ Ovoz va rasm javoblari',
            '✓ Batafsil AI tahlil',
          ],
        },
        pro: {
          emoji: '🚀',
          name: 'PRO',
          price: '$20/oy',
          features: [
            `✓ ${COMPLETE_PLAN_LIMITS.pro.mockInterviews.perMonth} ta mock intervyu/oy`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.voice.mockVoice} daq mock + ${COMPLETE_PLAN_LIMITS.pro.voice.realVoice} daq live ovoz`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.cvAnalysis.perMonth} ta CV tahlili`,
            '✓ Haftalik AI tavsiyalar',
            '✓ Chrome Extension',
            "✓ Ilg'or AI tahlil",
          ],
        },
        elite: {
          emoji: '👑',
          name: 'ELITE',
          price: '$30/oy',
          features: [
            '✓ Cheksiz mock intervyu',
            `✓ ${COMPLETE_PLAN_LIMITS.elite.voice.mockVoice} daq mock + ${COMPLETE_PLAN_LIMITS.elite.voice.realVoice} daq live ovoz`,
            '✓ Cheksiz CV tahlili',
            '✓ Premium AI modellari',
            '✓ Priority Support',
            '✓ Barcha xususiyatlar',
          ],
        },
      },
      ru: {
        starter: {
          emoji: '💼',
          name: 'STARTER',
          price: '$10/мес',
          features: [
            `✓ ${planLimits.mockInterviews.perMonth} mock-интервью/мес`,
            `✓ ${planLimits.voice.mockVoice} мин mock + ${planLimits.voice.realVoice} мин live голос`,
            `✓ ${planLimits.cvAnalysis.perMonth} анализов CV`,
            '✓ Голос и изображения',
            '✓ Подробный AI анализ',
          ],
        },
        pro: {
          emoji: '🚀',
          name: 'PRO',
          price: '$20/мес',
          features: [
            `✓ ${COMPLETE_PLAN_LIMITS.pro.mockInterviews.perMonth} mock-интервью/мес`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.voice.mockVoice} мин mock + ${COMPLETE_PLAN_LIMITS.pro.voice.realVoice} мин live голос`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.cvAnalysis.perMonth} анализов CV`,
            '✓ Еженедельные AI рекомендации',
            '✓ Chrome Extension',
            '✓ Продвинутый AI',
          ],
        },
        elite: {
          emoji: '👑',
          name: 'ELITE',
          price: '$30/мес',
          features: [
            '✓ Безлимит mock-интервью',
            `✓ ${COMPLETE_PLAN_LIMITS.elite.voice.mockVoice} мин mock + ${COMPLETE_PLAN_LIMITS.elite.voice.realVoice} мин live голос`,
            '✓ Безлимит анализов CV',
            '✓ Premium AI модели',
            '✓ Приоритетная поддержка',
            '✓ Все функции',
          ],
        },
      },
      en: {
        starter: {
          emoji: '💼',
          name: 'STARTER',
          price: '$10/mo',
          features: [
            `✓ ${planLimits.mockInterviews.perMonth} mock interviews/mo`,
            `✓ ${planLimits.voice.mockVoice} min mock + ${planLimits.voice.realVoice} min live voice`,
            `✓ ${planLimits.cvAnalysis.perMonth} CV analyses`,
            '✓ Voice & image answers',
            '✓ Detailed AI analysis',
          ],
        },
        pro: {
          emoji: '🚀',
          name: 'PRO',
          price: '$20/mo',
          features: [
            `✓ ${COMPLETE_PLAN_LIMITS.pro.mockInterviews.perMonth} mock interviews/mo`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.voice.mockVoice} min mock + ${COMPLETE_PLAN_LIMITS.pro.voice.realVoice} min live voice`,
            `✓ ${COMPLETE_PLAN_LIMITS.pro.cvAnalysis.perMonth} CV analyses`,
            '✓ Weekly AI recommendations',
            '✓ Chrome Extension',
            '✓ Advanced AI analysis',
          ],
        },
        elite: {
          emoji: '👑',
          name: 'ELITE',
          price: '$30/mo',
          features: [
            '✓ Unlimited mock interviews',
            `✓ ${COMPLETE_PLAN_LIMITS.elite.voice.mockVoice} min mock + ${COMPLETE_PLAN_LIMITS.elite.voice.realVoice} min live voice`,
            '✓ Unlimited CV analyses',
            '✓ Premium AI models',
            '✓ Priority Support',
            '✓ All features',
          ],
        },
      },
    };

    const details = planDetails[lang]?.[plan] || planDetails['en'][plan];

    const contactText: Record<string, string> = {
      uz: `\n\n📞 <b>To'lov uchun:</b>\nSupport botga murojaat qiling: @interviewai_support_bot\n\n💳 To'lov usullari: Payme, Click, Visa/Mastercard`,
      ru: `\n\n📞 <b>Для оплаты:</b>\nОбратитесь в Support бот: @interviewai_support_bot\n\n💳 Способы оплаты: Payme, Click, Visa/Mastercard`,
      en: `\n\n📞 <b>To pay:</b>\nContact Support bot: @interviewai_support_bot\n\n💳 Payment methods: Payme, Click, Visa/Mastercard`,
    };

    const message = `${details.emoji} <b>${details.name}</b> - ${details.price}\n\n${details.features.join('\n')}${contactText[lang] || contactText['en']}`;

    const supportBtn: Record<string, string> = {
      uz: '📞 Yordam',
      ru: '📞 Поддержка',
      en: '📞 Contact Support',
    };

    const backBtn: Record<string, string> = {
      uz: '⬅️ Tariflarga qaytish',
      ru: '⬅️ Назад к тарифам',
      en: '⬅️ Back to Plans',
    };

    const keyboard = new InlineKeyboard()
      .url(supportBtn[lang] || supportBtn['en'], 'https://t.me/interviewai_support_bot')
      .row()
      .text(backBtn[lang] || backBtn['en'], 'show_plans');

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Handle contact support callback
   * Shows comprehensive support information
   */
  async handleContactSupport(ctx: BotContext, lang: string): Promise<void> {
    const messages: Record<string, string> = {
      uz: `📞 <b>Support bilan bog'lanish</b>

Tarifni yangilash yoki savollar uchun:

👤 <b>Telegram:</b> @interviewai_support_bot

⏰ <b>Ish vaqti:</b> 09:00 - 22:00 (Toshkent)

💬 Quyidagi ma'lumotlarni yuboring:
• Telegram ID: <code>${ctx.from?.id}</code>
• Tanlangan tarif
• To'lov usuli

Biz tez orada javob beramiz! 🚀`,
      ru: `📞 <b>Связь с поддержкой</b>

Для обновления тарифа или вопросов:

👤 <b>Telegram:</b> @interviewai_support_bot

⏰ <b>Часы работы:</b> 09:00 - 22:00 (Ташкент)

💬 Отправьте следующую информацию:
• Telegram ID: <code>${ctx.from?.id}</code>
• Выбранный тариф
• Способ оплаты

Мы ответим в ближайшее время! 🚀`,
      en: `📞 <b>Contact Support</b>

For plan upgrade or questions:

👤 <b>Telegram:</b> @interviewai_support_bot

⏰ <b>Working hours:</b> 09:00 - 22:00 (Tashkent)

💬 Please send the following info:
• Telegram ID: <code>${ctx.from?.id}</code>
• Selected plan
• Payment method

We'll respond shortly! 🚀`,
    };

    const keyboard = new InlineKeyboard()
      .url('📞 Open Support Chat', 'https://t.me/interviewai_support_bot')
      .row()
      .text('⬅️ Back to Plans', 'show_plans');

    await ctx.reply(messages[lang] || messages['en'], {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  /**
   * Handle subscription-related callbacks
   * Returns true if callback was handled, false otherwise
   */
  async handleSubscriptionCallback(ctx: BotContext, data: string, lang: string): Promise<boolean> {
    // Show all plans comparison (upgrade is alias for show_plans)
    if (data === 'show_plans' || data === 'upgrade') {
      await this.sendPlanComparison(ctx, lang);
      return true;
    }

    // Upgrade to specific plan
    if (data.startsWith('upgrade_')) {
      const plan = data.replace('upgrade_', '') as 'starter' | 'pro' | 'elite';
      if (['starter', 'pro', 'elite'].includes(plan)) {
        await this.handleUpgradeCallback(ctx, plan, lang);
        return true;
      }
    }

    // Contact support
    if (data === 'contact_support') {
      await this.handleContactSupport(ctx, lang);
      return true;
    }

    return false;
  }
}
