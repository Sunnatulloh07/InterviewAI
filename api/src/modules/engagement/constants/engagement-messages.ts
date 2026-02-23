/**
 * Engagement Messages for Different User Segments
 *
 * ALIGNED with COMPLETE_PLAN_LIMITS (single source of truth)
 * Free Trial: 7 days, 1 mock interview, 2 min voice, 1 CV analysis, NO daily tasks
 * Starter: $10/mo | Pro: $20/mo | Elite: $30/mo
 *
 * 3 segments:
 * 1. Non-registered users (started bot but didn't register)
 * 2. Free trial users (registered but not fully using features)
 * 3. Paid users with daily tasks (AI-generated learning tips)
 */

/**
 * SEGMENT 1: Non-registered users
 * These users pressed /start but haven't completed registration
 * Goal: Convert them to registered users
 */
export const NON_REGISTERED_USER_MESSAGES = [
  {
    uz: `👋 Salom! InterviewAI Pro botiga xush kelibsiz!\n\n🎯 Biz sizga quyidagicha yordam beramiz:\n✅ Mock interview o'tkazish\n✅ Real vaqtda intervyu yordami\n✅ CV tahlili va tavsiyalar\n✅ Kunlik amaliy topshiriqlar\n\nRo'yxatdan o'tish uchun /register bosing!`,
    ru: `👋 Привет! Добро пожаловать в InterviewAI Pro!\n\n🎯 Мы поможем вам:\n✅ Проводить mock интервью\n✅ Получить помощь во время реального интервью\n✅ Анализ CV и рекомендации\n✅ Ежедневные практические задания\n\nДля регистрации нажмите /register!`,
    en: `👋 Hello! Welcome to InterviewAI Pro!\n\n🎯 We will help you:\n✅ Conduct mock interviews\n✅ Get real-time interview assistance\n✅ CV analysis and recommendations\n✅ Daily practical tasks\n\nPress /register to sign up!`,
  },
  {
    uz: `🚀 InterviewAI Pro bilan intervyuga tayyor bo'ling!\n\n📊 Biz nima qila olamiz:\n• AI bilan real intervyu mashqi\n• CV ni professional tahlil qilish\n• Kunlik savol va topshiriqlar\n• Ovozli javoblaringizni tahlil qilish\n\n💡 Bugun boshlang: /register`,
    ru: `🚀 Будьте готовы к собеседованию с InterviewAI Pro!\n\n📊 Что мы умеем:\n• Реальная практика интервью с AI\n• Профессиональный анализ CV\n• Ежедневные вопросы и задания\n• Анализ голосовых ответов\n\n💡 Начните сегодня: /register`,
    en: `🚀 Be ready for interviews with InterviewAI Pro!\n\n📊 What we can do:\n• Real interview practice with AI\n• Professional CV analysis\n• Daily questions and tasks\n• Voice answer analysis\n\n💡 Start today: /register`,
  },
  {
    uz: `🎁 7 KUNLIK BEPUL SINOV!\n\n✨ Hozir ro'yxatdan o'tsangiz quyidagilarni TEKIN olasiz:\n• 1 ta mock interview\n• 2 daqiqa ovozli javoblar\n• 1 ta CV tahlili\n• AI yordamchisi\n\n⏰ Sinab ko'ring: /register`,
    ru: `🎁 7 ДНЕЙ БЕСПЛАТНОГО ПРОБНОГО ПЕРИОДА!\n\n✨ Зарегистрируйтесь и получите БЕСПЛАТНО:\n• 1 mock интервью\n• 2 минуты голосовых ответов\n• 1 анализ CV\n• AI помощник\n\n⏰ Попробуйте: /register`,
    en: `🎁 7 DAYS FREE TRIAL!\n\n✨ Register now and get FREE:\n• 1 mock interview\n• 2 minutes voice responses\n• 1 CV analysis\n• AI assistant\n\n⏰ Try it out: /register`,
  },
  {
    uz: `💼 Intervyuda tez-tez qiladigan xatolarni bilasizmi?\n\n❌ Tayyorgarliksiz ketish\n❌ STAR metodini bilmaslik\n❌ O'z tajribangizni aniq bayon qilolmaslik\n\n✅ InterviewAI Pro sizga bularni bartaraf etishda yordam beradi!\n\nBoshlaymizmi? /register`,
    ru: `💼 Знаете ли вы частые ошибки на собеседовании?\n\n❌ Идти неподготовленным\n❌ Не знать STAR метод\n❌ Не уметь четко описывать свой опыт\n\n✅ InterviewAI Pro поможет вам избежать этих ошибок!\n\nНачнем? /register`,
    en: `💼 Do you know common interview mistakes?\n\n❌ Going unprepared\n❌ Not knowing the STAR method\n❌ Unable to clearly describe your experience\n\n✅ InterviewAI Pro will help you avoid these!\n\nShall we start? /register`,
  },
  {
    uz: `🎯 Nega InterviewAI Pro?\n\n1️⃣ Real intervyu savollari\n2️⃣ AI tomonidan darhol feedback\n3️⃣ Ovozli javoblarni tahlil qilish\n4️⃣ Shaxsiy o'sish rejasi\n5️⃣ 24/7 AI yordamchisi\n\n🚀 Karyerangizni bugun boshlang: /register`,
    ru: `🎯 Почему InterviewAI Pro?\n\n1️⃣ Реальные вопросы интервью\n2️⃣ Мгновенная обратная связь от AI\n3️⃣ Анализ голосовых ответов\n4️⃣ Личный план развития\n5️⃣ AI помощник 24/7\n\n🚀 Начните карьеру сегодня: /register`,
    en: `🎯 Why InterviewAI Pro?\n\n1️⃣ Real interview questions\n2️⃣ Instant AI feedback\n3️⃣ Voice answer analysis\n4️⃣ Personal growth plan\n5️⃣ 24/7 AI assistant\n\n🚀 Start your career today: /register`,
  },
  {
    uz: `🔥 TOP 3 sabab nima uchun hozir boshlash kerak:\n\n1️⃣ Intervyu sezoni boshlandi\n2️⃣ 7 kunlik BEPUL sinov - hech narsa yo'qotmaysiz\n3️⃣ Qanchalik erta boshlasangiz, shunchalik tayyor bo'lasiz\n\n⚡ Kech qolmang: /register`,
    ru: `🔥 ТОП 3 причины начать сейчас:\n\n1️⃣ Начался сезон интервью\n2️⃣ 7 дней БЕСПЛАТНО - вы ничего не теряете\n3️⃣ Чем раньше начнете, тем лучше подготовитесь\n\n⚡ Не опаздывайте: /register`,
    en: `🔥 TOP 3 reasons to start now:\n\n1️⃣ Interview season started\n2️⃣ 7 days FREE trial - you lose nothing\n3️⃣ The earlier you start, the better prepared you'll be\n\n⚡ Don't be late: /register`,
  },
  {
    uz: `🎓 Nima o'rganasiz?\n\n📚 Texnik savollarga javob berish\n📚 Behavioral intervyular\n📚 System design asoslari\n📚 STAR metodi\n📚 Ish beruvchini qanday hayratda qoldirish\n\n🎯 Hammasi bir joyda!\n\nQo'shiling: /register`,
    ru: `🎓 Чему вы научитесь?\n\n📚 Отвечать на технические вопросы\n📚 Поведенческие интервью\n📚 Основы System Design\n📚 STAR метод\n📚 Как впечатлить работодателя\n\n🎯 Все в одном месте!\n\nПрисоединяйтесь: /register`,
    en: `🎓 What will you learn?\n\n📚 Answer technical questions\n📚 Behavioral interviews\n📚 System Design basics\n📚 STAR method\n📚 How to impress employers\n\n🎯 All in one place!\n\nJoin: /register`,
  },
  {
    uz: `💡 Intervyuga tayyorlanish - bu investitsiya.\n\n⏰ 1 soat/kun = 30 kun ichida professional daraja\n\n🎯 InterviewAI Pro sizning shaxsiy mentor va coachingiz.\n\n✅ Tayyor bo'lasizmi?\n\nBoshlang: /register`,
    ru: `💡 Подготовка к интервью - это инвестиция.\n\n⏰ 1 час/день = за 30 дней до профессионального уровня\n\n🎯 InterviewAI Pro - ваш личный ментор и коуч.\n\n✅ Готовы?\n\nНачните: /register`,
    en: `💡 Interview preparation is an investment.\n\n⏰ 1 hour/day = professional level in 30 days\n\n🎯 InterviewAI Pro is your personal mentor and coach.\n\n✅ Ready?\n\nStart: /register`,
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
 * - 1 mock interview (not 3)
 * - 2 min voice (not 5)
 * - 1 CV analysis
 * - NO daily tasks
 */
export function getTrialReminderMessage(
  daysRemaining: number,
  usedInterviews: number,
  totalInterviews: number,
  language: string = 'uz',
): string {
  const messages = {
    uz: `⏰ BEPUL SINOV: ${daysRemaining} kun qoldi!\n\n📊 Sizning statistikangiz:\n• Mock interviews: ${usedInterviews}/${totalInterviews} ishlatildi\n• Qolgan: ${totalInterviews - usedInterviews} ta\n\n🎁 Bepul sinov davridagi imkoniyatlar:\n✅ 1 ta mock interview\n✅ 2 daqiqa ovozli javoblar\n✅ 1 ta CV tahlili\n✅ AI yordamchisi 24/7\n\n💡 Imkoniyatdan to'liq foydalaning!\n\nIntervyu boshlash: /interview\nCV yuklash: /cv`,

    ru: `⏰ ПРОБНЫЙ ПЕРИОД: осталось ${daysRemaining} дней!\n\n📊 Ваша статистика:\n• Mock интервью: ${usedInterviews}/${totalInterviews} использовано\n• Осталось: ${totalInterviews - usedInterviews}\n\n🎁 Возможности пробного периода:\n✅ 1 mock интервью\n✅ 2 минуты голосовых ответов\n✅ 1 анализ CV\n✅ AI помощник 24/7\n\n💡 Используйте все возможности!\n\nНачать интервью: /interview\nЗагрузить CV: /cv`,

    en: `⏰ FREE TRIAL: ${daysRemaining} days left!\n\n📊 Your statistics:\n• Mock interviews: ${usedInterviews}/${totalInterviews} used\n• Remaining: ${totalInterviews - usedInterviews}\n\n🎁 Trial period features:\n✅ 1 mock interview\n✅ 2 minutes voice responses\n✅ 1 CV analysis\n✅ AI assistant 24/7\n\n💡 Use all opportunities!\n\nStart interview: /interview\nUpload CV: /cv`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}

/**
 * Trial ending soon message (1 day left)
 * Feature-based marketing (no fake discounts)
 */
export function getTrialEndingSoonMessage(language: string = 'uz'): string {
  const messages = {
    uz: `⚠️ DIQQAT: Bepul sinov ERTAGA tugaydi!\n\n🎯 Premium bilan nimalar olasiz:\n\n💼 STARTER - $10/oy:\n• Kunlik savol va topshiriqlar\n• 10 ta mock interview\n• 10 daqiqa ovozli javoblar\n• 5 ta CV tahlili\n\n🚀 PRO - $20/oy:\n• Kunlik savol + AI progress tracking\n• 30 ta mock interview\n• 30 daqiqa ovozli javoblar\n• Haftalik AI tavsiyalar\n\nRejalarni ko'rish: /upgrade`,

    ru: `⚠️ ВНИМАНИЕ: Пробный период заканчивается ЗАВТРА!\n\n🎯 Что вы получите с Premium:\n\n💼 STARTER - $10/мес:\n• Ежедневные вопросы и задания\n• 10 mock интервью\n• 10 минут голосовых ответов\n• 5 анализов CV\n\n🚀 PRO - $20/мес:\n• Ежедневные задания + AI прогресс\n• 30 mock интервью\n• 30 минут голосовых ответов\n• Еженедельные AI рекомендации\n\nСмотреть планы: /upgrade`,

    en: `⚠️ ATTENTION: Free trial ends TOMORROW!\n\n🎯 What you get with Premium:\n\n💼 STARTER - $10/mo:\n• Daily questions and tasks\n• 10 mock interviews\n• 10 minutes voice responses\n• 5 CV analyses\n\n🚀 PRO - $20/mo:\n• Daily tasks + AI progress tracking\n• 30 mock interviews\n• 30 minutes voice responses\n• Weekly AI recommendations\n\nView plans: /upgrade`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}
