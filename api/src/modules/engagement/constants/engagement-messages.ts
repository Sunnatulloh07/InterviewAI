/**
 * Engagement Messages for Different User Segments
 *
 * ALIGNED with COMPLETE_PLAN_LIMITS (single source of truth)
 * Free Trial: 7 days, 1 mock interview, 0 min voice (text only), 1 CV analysis, NO daily tasks
 * Starter: $5/mo | Pro: $15/mo | Elite: $30/mo
 *
 * VALID BOT COMMANDS:
 * /start, /interview, /tasks, /analyze_cv, /profile, /stats, /voice,
 * /upgrade, /settings, /help, /start_live, /end_live, /set_position, /progress
 *
 * NOTE: /register does NOT exist. Use /start for onboarding.
 * NOTE: /cv does NOT exist. Use /analyze_cv for CV analysis.
 * NOTE: /tasks is ONLY for paid users (starter/pro/elite). Do NOT suggest to free_trial users.
 *
 * 3 segments:
 * 1. Non-registered users (started bot but didn't register)
 * 2. Free trial users (registered but not fully using features)
 * 3. Paid users with daily tasks (AI-generated learning tips)
 */

/**
 * SEGMENT 1: Non-registered users
 * These users pressed /start but haven't completed registration
 * Goal: Convert them to registered users via /start
 */
export const NON_REGISTERED_USER_MESSAGES = [
  {
    uz: `Salom! Siz hali ro'yxatdan o'tmagansiz.\n\nJobi orqali intervyuga tayyorlanish juda oson:\n\n• AI bilan mock intervyu o'ting\n• CV ingizni professional tahlil qiling\n• Natijalaringizni kuzatib boring\n\nBoshlash uchun /start ni bosing.`,
    ru: `Здравствуйте! Вы ещё не зарегистрированы.\n\nС Jobi подготовка к собеседованию станет проще:\n\n• Пройдите mock-интервью с AI\n• Получите профессиональный анализ CV\n• Отслеживайте свой прогресс\n\nНажмите /start чтобы начать.`,
    en: `Hi! You haven't registered yet.\n\nWith Jobi, interview preparation is easy:\n\n• Take mock interviews with AI\n• Get professional CV analysis\n• Track your progress\n\nPress /start to begin.`,
  },
  {
    uz: `Intervyuga tayyormisiz?\n\nRo'yxatdan o'tsangiz 7 kunlik bepul sinov olasiz:\n\n• 1 ta mock intervyu\n• 1 ta CV tahlili\n• AI yordamchi\n\nBoshlash: /start`,
    ru: `Готовы к собеседованию?\n\nПри регистрации вы получите 7 дней бесплатно:\n\n• 1 mock-интервью\n• 1 анализ CV\n• AI помощник\n\nНачать: /start`,
    en: `Ready for your interview?\n\nRegister and get a 7-day free trial:\n\n• 1 mock interview\n• 1 CV analysis\n• AI assistant\n\nStart: /start`,
  },
  {
    uz: `Intervyuda eng ko'p uchraydigan xatolar:\n\n• Tayyorgarliksiz borish\n• Tajribani aniq tushuntirib berolmaslik\n• STAR metodini bilmaslik\n\nJobi bu xatolarni oldini olishga yordam beradi.\n\nSinab ko'ring: /start`,
    ru: `Самые частые ошибки на собеседовании:\n\n• Идти без подготовки\n• Не уметь чётко описать опыт\n• Не знать STAR-метод\n\nJobi поможет избежать этих ошибок.\n\nПопробуйте: /start`,
    en: `Most common interview mistakes:\n\n• Going unprepared\n• Unable to clearly describe experience\n• Not knowing the STAR method\n\nJobi helps you avoid these mistakes.\n\nTry it: /start`,
  },
  {
    uz: `AI bilan intervyuga tayyorlanish nima beradi?\n\n• Real savollarga javob berish mashqi\n• Har bir javobga batafsil tahlil\n• Kuchli va zaif tomonlaringizni bilish\n\nHech narsa yo'qotmaysiz — 7 kun bepul.\n\nBoshlash: /start`,
    ru: `Что даёт подготовка с AI?\n\n• Практика ответов на реальные вопросы\n• Подробный анализ каждого ответа\n• Понимание сильных и слабых сторон\n\nВы ничего не теряете — 7 дней бесплатно.\n\nНачать: /start`,
    en: `What does AI interview prep give you?\n\n• Practice answering real questions\n• Detailed feedback on each answer\n• Know your strengths and weaknesses\n\nYou lose nothing — 7 days free.\n\nStart: /start`,
  },
  {
    uz: `Qanchalik erta boshlasangiz, shunchalik tayyor bo'lasiz.\n\nRo'yxatdan o'tish 1 daqiqa vaqtingizni oladi, lekin intervyuda o'zingizni ishonchli his qilasiz.\n\nBoshlash: /start`,
    ru: `Чем раньше начнёте, тем лучше подготовитесь.\n\nРегистрация займёт 1 минуту, но на собеседовании вы будете чувствовать себя уверенно.\n\nНачать: /start`,
    en: `The earlier you start, the better prepared you'll be.\n\nRegistration takes 1 minute, but you'll feel confident in your interview.\n\nStart: /start`,
  },
];

/**
 * Get a random message for non-registered users
 */
export function getRandomNonRegisteredMessage(language: string = 'uz'): string {
  const randomIndex = Math.floor(Math.random() * NON_REGISTERED_USER_MESSAGES.length);
  const message = NON_REGISTERED_USER_MESSAGES[randomIndex];

  // Fallback to Uzbek if language not supported
  return message[language as keyof typeof message] || message.uz;
}

/**
 * SEGMENT 2: Free trial users
 * These users registered but haven't fully utilized their trial
 * Goal: Activate them and convert to paid users
 *
 * ALIGNED with COMPLETE_PLAN_LIMITS:
 * - 1 mock interview
 * - 0 min voice (text only)
 * - 1 CV analysis
 * - NO daily tasks (do NOT suggest /tasks!)
 */
export function getTrialReminderMessage(
  daysRemaining: number,
  usedInterviews: number,
  totalInterviews: number,
  language: string = 'uz',
): string {
  const remaining = totalInterviews - usedInterviews;

  const messages = {
    uz: `Bepul sinov: ${daysRemaining} kun qoldi\n\nSizning holatizgiz:\n• Mock intervyu: ${usedInterviews}/${totalInterviews} ishlatilgan\n${remaining > 0 ? `• Yana ${remaining} ta intervyu qoldi\n` : '• Barcha intervyularni ishlatdingiz\n'}\nBepul sinov imkoniyatlari:\n• 1 ta mock intervyu\n• 1 ta CV tahlili\n• AI feedback\n\n${remaining > 0 ? 'Intervyu boshlash: /interview\nCV tahlil qilish: /analyze_cv' : 'CV tahlil qilish: /analyze_cv\nRejalarni ko\'rish: /upgrade'}`,

    ru: `Пробный период: осталось ${daysRemaining} дней\n\nВаш статус:\n• Mock-интервью: ${usedInterviews}/${totalInterviews} использовано\n${remaining > 0 ? `• Осталось ${remaining} интервью\n` : '• Все интервью использованы\n'}\nВозможности пробного периода:\n• 1 mock-интервью\n• 1 анализ CV\n• AI обратная связь\n\n${remaining > 0 ? 'Начать интервью: /interview\nАнализ CV: /analyze_cv' : 'Анализ CV: /analyze_cv\nСмотреть планы: /upgrade'}`,

    en: `Free trial: ${daysRemaining} days left\n\nYour status:\n• Mock interviews: ${usedInterviews}/${totalInterviews} used\n${remaining > 0 ? `• ${remaining} interview remaining\n` : '• All interviews used\n'}\nTrial features:\n• 1 mock interview\n• 1 CV analysis\n• AI feedback\n\n${remaining > 0 ? 'Start interview: /interview\nAnalyze CV: /analyze_cv' : 'Analyze CV: /analyze_cv\nView plans: /upgrade'}`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}

/**
 * Trial ending soon message (1 day left)
 * Feature-based marketing (no fake discounts)
 */
export function getTrialEndingSoonMessage(language: string = 'uz'): string {
  const messages = {
    uz: `Bepul sinov ertaga tugaydi\n\nDavom etish uchun rejalardan birini tanlang:\n\n<b>STARTER</b> — $5/oy\n• Kunlik topshiriqlar\n• 2 ta mock intervyu\n• 10 daqiqa ovozli javob\n• 5 ta CV tahlili\n\n<b>PRO</b> — $15/oy\n• 8 ta mock intervyu\n• 30 daqiqa ovozli javob\n• Haftalik AI tavsiyalar\n\nBatafsil: /upgrade`,

    ru: `Пробный период заканчивается завтра\n\nВыберите план для продолжения:\n\n<b>STARTER</b> — $5/мес\n• Ежедневные задания\n• 2 mock-интервью\n• 10 минут голосовых ответов\n• 5 анализов CV\n\n<b>PRO</b> — $15/мес\n• 8 mock-интервью\n• 30 минут голосовых ответов\n• Еженедельные AI рекомендации\n\nПодробнее: /upgrade`,

    en: `Free trial ends tomorrow\n\nChoose a plan to continue:\n\n<b>STARTER</b> — $5/mo\n• Daily tasks\n• 2 mock interviews\n• 10 min voice responses\n• 5 CV analyses\n\n<b>PRO</b> — $15/mo\n• 8 mock interviews\n• 30 min voice responses\n• Weekly AI recommendations\n\nDetails: /upgrade`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}
