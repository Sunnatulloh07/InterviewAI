import { Process, Processor } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { CvService } from './cv.service';
import { UsersService } from '../users/users.service';
import { TelegramService } from '../telegram/telegram.service';
import { QUEUE_CV_ANALYSIS } from '@common/constants';
import { InlineKeyboard } from 'grammy';

@Processor(QUEUE_CV_ANALYSIS)
export class CvProcessor {
  private readonly logger = new Logger(CvProcessor.name);

  constructor(
    private readonly cvService: CvService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  @Process('analyze-cv')
  async handleCvAnalysis(job: Job) {
    this.logger.log(`Processing CV analysis job ${job.id}`);
    const { cvId, userId, jobDescription } = job.data;

    try {
      // Get user for language preference
      const user = await this.usersService.findById(userId);
      const userLanguage = user.preferences?.language || user.language || 'en';
      const telegramId = user.telegramId;

      const cv = await this.cvService.analyzeCv(userId, cvId, {
        jobDescription,
        language: userLanguage,
      });

      this.logger.log(`CV analysis completed: ${cvId}`);

      // Send notification to user via Telegram if they have telegramId
      if (telegramId && cv.analysis && cv.analysisStatus === 'completed') {
        await this.sendAnalysisResults(telegramId, cv, userLanguage);
      }
    } catch (error) {
      this.logger.error(`CV analysis failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send CV analysis results to user via Telegram
   */
  private async sendAnalysisResults(telegramId: number, cv: any, lang: string): Promise<void> {
    try {
      const analysis = cv.analysis;

      // Determine score emoji
      let scoreEmoji = '🔴';
      if (analysis.atsScore >= 80) scoreEmoji = '🟢';
      else if (analysis.atsScore >= 60) scoreEmoji = '🟡';

      // Format strengths (first 3)
      // FIX #65: Handle both string and object formats for backward compat
      const formatStrength = (s: any): string => {
        if (typeof s === 'string') return `✅ ${s}`;
        if (s && typeof s === 'object' && s.text) return `✅ ${s.text}`;
        return `✅ ${String(s)}`;
      };
      const strengths =
        analysis.strengths
          ?.slice(0, 3)
          .map(formatStrength)
          .join('\n') || '';

      // Format weaknesses (first 3)
      // FIX #60: Handle both old format (string[]) and new format ({ issue, whyItMatters, severity }[])
      const formatWeakness = (w: any): string => {
        if (typeof w === 'string') return `⚠️ ${w}`;
        if (w && typeof w === 'object' && w.issue) return `⚠️ ${w.issue}`;
        return `⚠️ ${String(w)}`;
      };
      const weaknesses =
        analysis.criticalWeaknesses
          ?.slice(0, 3)
          .map(formatWeakness)
          .join('\n') ||
        analysis.weaknesses
          ?.slice(0, 3)
          .map(formatWeakness)
          .join('\n') ||
        '';

      const messages: Record<string, string> = {
        uz: `📄 <b>CV Tahlili Tayyor!</b>

${scoreEmoji} <b>ATS Ball:</b> ${analysis.atsScore}/100
⭐ <b>Umumiy baho:</b> ${analysis.overallRating}/5

✅ <b>Kuchli tomonlar:</b>
${strengths || 'No specific strengths mentioned'}

⚠️ <b>Kamchiliklar:</b>
${weaknesses || 'No major weaknesses found'}

📊 To'liq tahlilni ko'rish uchun quyidagi tugmani bosing:`,

        ru: `📄 <b>Анализ CV Готов!</b>

${scoreEmoji} <b>ATS Оценка:</b> ${analysis.atsScore}/100
⭐ <b>Общий рейтинг:</b> ${analysis.overallRating}/5

✅ <b>Сильные стороны:</b>
${strengths || 'No specific strengths mentioned'}

⚠️ <b>Слабые стороны:</b>
${weaknesses || 'No major weaknesses found'}

📊 Нажмите кнопку ниже для просмотра полного анализа:`,

        en: `📄 <b>CV Analysis Ready!</b>

${scoreEmoji} <b>ATS Score:</b> ${analysis.atsScore}/100
⭐ <b>Overall Rating:</b> ${analysis.overallRating}/5

✅ <b>Strengths:</b>
${strengths || 'No specific strengths mentioned'}

⚠️ <b>Weaknesses:</b>
${weaknesses || 'No major weaknesses found'}

📊 Click the button below to view the full analysis:`,
      };

      // FIX #112: Add "Start Mock Interview" button — this is the most common next action
      // after CV analysis, especially in the interview flow
      const interviewBtnText: Record<string, string> = {
        uz: '🎯 Mock intervyu boshlash',
        ru: '🎯 Начать Mock-интервью',
        en: '🎯 Start Mock Interview',
      };
      const fullAnalysisBtnText: Record<string, string> = {
        uz: "📊 To'liq tahlil",
        ru: '📊 Полный анализ',
        en: '📊 Full Analysis',
      };
      const menuBtnText: Record<string, string> = {
        uz: '🏠 Asosiy menyu',
        ru: '🏠 Главное меню',
        en: '🏠 Main Menu',
      };

      const keyboard = new InlineKeyboard()
        .text(interviewBtnText[lang] || interviewBtnText.en, 'interview_mock')
        .row()
        .text(fullAnalysisBtnText[lang] || fullAnalysisBtnText.en, `cv_full_${cv.id}`)
        .text(menuBtnText[lang] || menuBtnText.en, 'back_to_menu');

      // FIX #50: Pass keyboard as reply_markup (was created but never sent)
      await this.telegramService.sendNotification(
        telegramId,
        messages[lang] || messages.en,
        { reply_markup: keyboard },
      );

      this.logger.log(`Analysis results sent to Telegram user ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to send analysis results to Telegram: ${error.message}`);
      // Don't throw - notification failure shouldn't break the flow
    }
  }
}
