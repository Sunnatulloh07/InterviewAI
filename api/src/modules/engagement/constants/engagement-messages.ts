/**
 * Engagement Messages for Different User Segments
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
    uz: `🚀 InterviewAI Pro bilan intervyuga 100% tayyor bo'ling!\n\n📊 Statistika:\n• 85% foydalanuvchilar dream job topdi\n• 4.9/5 reyting\n• 10,000+ muvaffaqiyatli intervyu\n\n💡 Bugun boshlang: /register`,
    ru: `🚀 Будьте на 100% готовы к собеседованию с InterviewAI Pro!\n\n📊 Статистика:\n• 85% пользователей нашли работу мечты\n• Рейтинг 4.9/5\n• 10,000+ успешных интервью\n\n💡 Начните сегодня: /register`,
    en: `🚀 Be 100% ready for interviews with InterviewAI Pro!\n\n📊 Statistics:\n• 85% users found their dream job\n• 4.9/5 rating\n• 10,000+ successful interviews\n\n💡 Start today: /register`,
  },
  {
    uz: `🎁 7 KUNLIK BEPUL SINOV VERSIYASI!\n\n✨ Hozir ro'yxatdan o'tsangiz quyidagilarni TEKIN olasiz:\n• 5 ta mock interview\n• 5 daqiqa ovozli javoblar\n• CV tahlili\n• AI yordamchisi\n\n⏰ Vaqt cheklangan! /register`,
    ru: `🎁 7 ДНЕЙ БЕСПЛАТНОГО ПРОБНОГО ПЕРИОДА!\n\n✨ Зарегистрируйтесь сейчас и получите БЕСПЛАТНО:\n• 5 mock интервью\n• 5 минут голосовых ответов\n• Анализ CV\n• AI помощник\n\n⏰ Предложение ограничено! /register`,
    en: `🎁 7 DAYS FREE TRIAL!\n\n✨ Register now and get FREE:\n• 5 mock interviews\n• 5 minutes voice responses\n• CV analysis\n• AI assistant\n\n⏰ Limited time offer! /register`,
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
    uz: `⭐ Success story:\n\n"Men Junior Developer edim, InterviewAI Pro bilan 3 oy mashq qilganimdan keyin Google'ga o'tdim!" - Aziz, 24\n\n💪 Siz ham qila olasiz!\n\nBoshlash: /register`,
    ru: `⭐ История успеха:\n\n"Я был Junior Developer, после 3 месяцев практики с InterviewAI Pro перешел в Google!" - Азиз, 24\n\n💪 Вы тоже можете!\n\nНачать: /register`,
    en: `⭐ Success story:\n\n"I was a Junior Developer, after 3 months of practice with InterviewAI Pro I joined Google!" - Aziz, 24\n\n💪 You can do it too!\n\nStart: /register`,
  },
  {
    uz: `🔥 TOP 3 sabab nima uchun hozir boshlash kerak:\n\n1️⃣ Intervyu sezoni boshlandi (ko'p kompaniyalar yollaydi)\n2️⃣ 7 kunlik BEPUL sinov - hech narsa yo'qotmaysiz\n3️⃣ Qanchalik erta boshlasangiz, shunchalik tayyor bo'lasiz\n\n⚡ Kech qolmang: /register`,
    ru: `🔥 ТОП 3 причины начать сейчас:\n\n1️⃣ Начался сезон интервью (много компаний нанимают)\n2️⃣ 7 дней БЕСПЛАТНО - вы ничего не теряете\n3️⃣ Чем раньше начнете, тем лучше подготовитесь\n\n⚡ Не опаздывайте: /register`,
    en: `🔥 TOP 3 reasons to start now:\n\n1️⃣ Interview season started (many companies hiring)\n2️⃣ 7 days FREE trial - you lose nothing\n3️⃣ The earlier you start, the better prepared you'll be\n\n⚡ Don't be late: /register`,
  },
  {
    uz: `🎓 Nima o'rganasiz?\n\n📚 Texnik savollarga javob berish\n📚 Behavioral intervyular\n📚 System design asoslari\n📚 STAR metodi\n📚 Ish beruvchini qanday hayratda qoldirish\n\n🎯 Hammasi bir joyda!\n\nQo'shiling: /register`,
    ru: `🎓 Чему вы научитесь?\n\n📚 Отвечать на технические вопросы\n📚 Поведенческие интервью\n📚 Основы System Design\n📚 STAR метод\n📚 Как впечатлить работодателя\n\n🎯 Все в одном месте!\n\nПрисоединяйтесь: /register`,
    en: `🎓 What will you learn?\n\n📚 Answer technical questions\n📚 Behavioral interviews\n📚 System Design basics\n📚 STAR method\n📚 How to impress employers\n\n🎯 All in one place!\n\nJoin: /register`,
  },
  {
    uz: `⚡ MAXSUS TAKLIF - faqat bugun!\n\n🎁 Birinchi 100 ta foydalanuvchi uchun:\n• Extend trial: 7 kun → 10 kun\n• Bonus: 3 ta qo'shimcha mock interview\n• Premium tips TEKIN\n\n🏃‍♂️ Shoshiling: /register`,
    ru: `⚡ СПЕЦИАЛЬНОЕ ПРЕДЛОЖЕНИЕ - только сегодня!\n\n🎁 Для первых 100 пользователей:\n• Продлен trial: 7 дней → 10 дней\n• Бонус: 3 дополнительных mock интервью\n• Premium советы БЕСПЛАТНО\n\n🏃‍♂️ Спешите: /register`,
    en: `⚡ SPECIAL OFFER - today only!\n\n🎁 For the first 100 users:\n• Extended trial: 7 days → 10 days\n• Bonus: 3 extra mock interviews\n• Premium tips FREE\n\n🏃‍♂️ Hurry: /register`,
  },
  {
    uz: `💡 Oxirgi eslatma!\n\nIntervyuga tayyorlanish - bu investitsiya.\n\n⏰ 1 soat/kun = 30 kun ichida mutaxassis darajada\n\n🎯 InterviewAI Pro sizning shaxsiy mentor va coachingiz.\n\n✅ Tayyor bo'lasizmi?\n\nBoshlang: /register`,
    ru: `💡 Последнее напоминание!\n\nПодготовка к интервью - это инвестиция.\n\n⏰ 1 час/день = за 30 дней до уровня эксперта\n\n🎯 InterviewAI Pro - ваш личный ментор и коуч.\n\n✅ Готовы?\n\nНачните: /register`,
    en: `💡 Final reminder!\n\nInterview preparation is an investment.\n\n⏰ 1 hour/day = expert level in 30 days\n\n🎯 InterviewAI Pro is your personal mentor and coach.\n\n✅ Ready?\n\nStart: /register`,
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
 */
export function getTrialReminderMessage(
  daysRemaining: number,
  usedInterviews: number,
  totalInterviews: number,
  language: string = 'uz',
): string {
  const messages = {
    uz: `⏰ BEPUL SINOV: ${daysRemaining} kun qoldi!\n\n📊 Sizning statistikangiz:\n• Mock interviews: ${usedInterviews}/${totalInterviews} ishlatildi\n• Ovozli javoblar: ${totalInterviews - usedInterviews} ta qoldi\n\n🎁 Bepul sinov davridagi imkoniyatlar:\n✅ ${totalInterviews} ta mock interview\n✅ 5 daqiqa ovozli javoblar\n✅ CV tahlili\n✅ Kunlik amaliy topshiriqlar\n✅ AI yordamchisi 24/7\n\n💡 Imkoniyatdan to'liq foydalaning!\n\nIntervyu boshlash: /interview\nCV yuklash: /cv`,

    ru: `⏰ ПРОБНЫЙ ПЕРИОД: осталось ${daysRemaining} дней!\n\n📊 Ваша статистика:\n• Mock интервью: ${usedInterviews}/${totalInterviews} использовано\n• Голосовые ответы: ${totalInterviews - usedInterviews} осталось\n\n🎁 Возможности пробного периода:\n✅ ${totalInterviews} mock интервью\n✅ 5 минут голосовых ответов\n✅ Анализ CV\n✅ Ежедневные задания\n✅ AI помощник 24/7\n\n💡 Используйте все возможности!\n\nНачать интервью: /interview\nЗагрузить CV: /cv`,

    en: `⏰ FREE TRIAL: ${daysRemaining} days left!\n\n📊 Your statistics:\n• Mock interviews: ${usedInterviews}/${totalInterviews} used\n• Voice responses: ${totalInterviews - usedInterviews} remaining\n\n🎁 Trial period features:\n✅ ${totalInterviews} mock interviews\n✅ 5 minutes voice responses\n✅ CV analysis\n✅ Daily tasks\n✅ AI assistant 24/7\n\n💡 Use all opportunities!\n\nStart interview: /interview\nUpload CV: /cv`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}

/**
 * Trial ending soon message (1 day left)
 */
export function getTrialEndingSoonMessage(language: string = 'uz'): string {
  const messages = {
    uz: `⚠️ DIQQAT: Bepul sinov ERTAGA tugaydi!\n\n🎯 Davom etish uchun:\n1️⃣ Pro rejani tanlang (50% chegirma)\n2️⃣ Cheksiz mock interviews\n3️⃣ 45 daqiqa ovozli javoblar/oy\n4️⃣ Advanced AI tahlil\n\n💰 Faqat 49,000 so'm/oy\n\nRejalarni ko'rish: /plans`,

    ru: `⚠️ ВНИМАНИЕ: Пробный период заканчивается ЗАВТРА!\n\n🎯 Чтобы продолжить:\n1️⃣ Выберите Pro план (скидка 50%)\n2️⃣ Неограниченные mock интервью\n3️⃣ 45 минут голосовых ответов/месяц\n4️⃣ Продвинутый AI анализ\n\n💰 Всего 49,000 сум/месяц\n\nСмотреть планы: /plans`,

    en: `⚠️ ATTENTION: Free trial ends TOMORROW!\n\n🎯 To continue:\n1️⃣ Choose Pro plan (50% discount)\n2️⃣ Unlimited mock interviews\n3️⃣ 45 minutes voice responses/month\n4️⃣ Advanced AI analysis\n\n💰 Only 49,000 sum/month\n\nView plans: /plans`,
  };

  return messages[language as keyof typeof messages] || messages.uz;
}
