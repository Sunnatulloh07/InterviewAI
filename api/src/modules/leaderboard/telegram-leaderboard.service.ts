import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LeaderboardService } from './leaderboard.service';
import { LeaderboardPeriod } from './schemas/leaderboard-entry.schema';

/**
 * TelegramLeaderboardService — Telegram bot UI for leaderboard
 *
 * Handles:
 *   - /leaderboard command → show top-10 with inline period toggle
 *   - lb_weekly / lb_monthly / lb_alltime callbacks → switch period view
 *   - Position-filtered leaderboard display
 */
@Injectable()
export class TelegramLeaderboardService {
  private readonly logger = new Logger(TelegramLeaderboardService.name);

  constructor(
    private leaderboardService: LeaderboardService,
    private configService: ConfigService,
  ) {}

  /**
   * Handle /leaderboard command — show weekly leaderboard by default.
   */
  async handleLeaderboardCommand(ctx: any): Promise<void> {
    const isEnabled = this.configService.get<boolean>(
      'features.leaderboardEnabled',
    );
    if (!isEnabled) {
      await ctx.reply('Leaderboard tez orada ishga tushadi! 🏆');
      return;
    }

    await this.showLeaderboard(ctx, 'weekly');
  }

  /**
   * Handle callback query for period switching.
   */
  async handleLeaderboardCallback(
    ctx: any,
    action: string,
  ): Promise<void> {
    const periodMap: Record<string, LeaderboardPeriod> = {
      lb_weekly: 'weekly',
      lb_monthly: 'monthly',
      lb_alltime: 'alltime',
    };

    const period = periodMap[action];
    if (!period) return;

    await this.showLeaderboard(ctx, period, true);
  }

  /**
   * Build and show leaderboard for a specific period.
   */
  private async showLeaderboard(
    ctx: any,
    period: LeaderboardPeriod,
    isEdit = false,
  ): Promise<void> {
    try {
      const periods = this.leaderboardService.getActivePeriods();
      const periodInfo = periods.find((p) => p.period === period);
      if (!periodInfo) return;

      const topN = this.configService.get<number>(
        'features.leaderboard.topDisplayCount',
        20,
      );

      const entries = await this.leaderboardService.getTopN(
        period,
        periodInfo.periodKey,
        undefined,
        topN,
      );

      // Get user's own rank
      const telegramId = ctx.from?.id;
      let userEntry: any = null;
      if (telegramId) {
        // Find user ID from context (session or DB lookup)
        const userId = ctx.session?.userId;
        if (userId) {
          userEntry = await this.leaderboardService.getUserRank(
            userId,
            period,
            periodInfo.periodKey,
          );
        }
      }

      const message = this.formatLeaderboard(
        entries,
        period,
        periodInfo.periodKey,
        userEntry,
      );
      const keyboard = this.buildPeriodKeyboard(period);

      if (isEdit && ctx.callbackQuery?.message) {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
      } else {
        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to show leaderboard: ${error.message}`);
      const errorMsg = 'Leaderboard yuklashda xatolik yuz berdi. Qayta urinib ko\'ring.';
      if (isEdit) {
        await ctx.reply(errorMsg).catch(() => {});
      } else {
        await ctx.reply(errorMsg);
      }
    }
  }

  /**
   * Format leaderboard entries into a Telegram message.
   */
  private formatLeaderboard(
    entries: any[],
    period: LeaderboardPeriod,
    periodKey: string,
    userEntry: any,
  ): string {
    const periodLabels: Record<string, string> = {
      weekly: '📊 Haftalik reyting',
      monthly: '📅 Oylik reyting',
      alltime: '🏆 Umumiy reyting',
    };

    const header = `<b>${periodLabels[period]}</b>\n`;
    const subHeader = period !== 'alltime' ? `<i>${periodKey}</i>\n\n` : '\n';

    if (entries.length === 0) {
      return (
        header +
        subHeader +
        'Hali hech kim ball to\'plamagan.\n\n' +
        'Birinchi bo\'ling! /tasks'
      );
    }

    const rankEmojis = ['🥇', '🥈', '🥉'];
    let body = '';

    for (const entry of entries) {
      const rank = entry.rank || 0;
      const rankDisplay = rank <= 3 ? rankEmojis[rank - 1] : `${rank}.`;
      const name = entry.displayName || `User ${entry.userId?.toString().slice(-4)}`;
      const streakBadge = entry.currentStreak > 0 ? `🔥${entry.currentStreak}` : '';

      body += `${rankDisplay} <b>${this.escapeHtml(name)}</b> — ${entry.points} ball ${streakBadge}\n`;
    }

    // Show user's own position if not in top
    if (userEntry && (!entries.some((e) => e.userId?.toString() === userEntry.userId?.toString()) || !userEntry.rank)) {
      body += '\n───────────\n';
      body += `📍 Siz: <b>#${userEntry.rank || '?'}</b> — ${userEntry.points || 0} ball\n`;
    } else if (userEntry && userEntry.rank) {
      // User is in the list, highlight
      body += `\n📍 Sizning o'rningiz: <b>#${userEntry.rank}</b>\n`;
    }

    return header + subHeader + body;
  }

  /**
   * Build inline keyboard for period switching.
   */
  private buildPeriodKeyboard(
    currentPeriod: LeaderboardPeriod,
  ): Array<Array<{ text: string; callback_data: string }>> {
    const periods: Array<{
      period: LeaderboardPeriod;
      label: string;
      callback: string;
    }> = [
      { period: 'weekly', label: 'Haftalik', callback: 'lb_weekly' },
      { period: 'monthly', label: 'Oylik', callback: 'lb_monthly' },
      { period: 'alltime', label: 'Umumiy', callback: 'lb_alltime' },
    ];

    return [
      periods.map((p) => ({
        text: p.period === currentPeriod ? `✅ ${p.label}` : p.label,
        callback_data: p.callback,
      })),
    ];
  }

  /**
   * Escape HTML special characters for Telegram.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
