import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IrsQuestion, IrsQuestionDocument } from './schemas/irs-question-pool.schema';

/**
 * IRS Question Seed Service
 *
 * Seeds the irs_questions collection on application startup if empty.
 * Idempotent: only inserts if collection has fewer than MINIMUM_QUESTIONS.
 *
 * Strategy: Create questions for the most common techStacks with all
 * positions, categories, and difficulties. The fallback system in
 * ReadinessTestService ensures less common techStacks still work by
 * falling back to any-techStack questions.
 */
@Injectable()
export class IrsQuestionSeedService implements OnModuleInit {
  private readonly logger = new Logger(IrsQuestionSeedService.name);
  private readonly MINIMUM_QUESTIONS = 50;

  constructor(
    @InjectModel(IrsQuestion.name)
    private readonly irsQuestionModel: Model<IrsQuestionDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const count = await this.irsQuestionModel.countDocuments();
      if (count >= this.MINIMUM_QUESTIONS) {
        this.logger.log(`IRS question pool has ${count} questions. Skipping seed.`);
        return;
      }

      this.logger.log(`IRS question pool has ${count} questions. Seeding...`);
      const questions = this.buildSeedQuestions();

      // Use insertMany with ordered:false to skip duplicates
      const result = await this.irsQuestionModel.insertMany(questions, { ordered: false });
      this.logger.log(`Seeded ${result.length} IRS questions successfully.`);
    } catch (error: any) {
      // BulkWriteError with duplicates is fine
      if (error.code === 11000 || error.name === 'BulkWriteError') {
        this.logger.log(`IRS seed completed (some duplicates skipped).`);
      } else {
        this.logger.error(`IRS seed failed: ${error.message}`, error.stack);
      }
    }
  }

  private buildSeedQuestions(): Partial<IrsQuestion>[] {
    const questions: Partial<IrsQuestion>[] = [];

    // Core tech stacks to seed (most popular)
    const techStacks = [
      'javascript', 'typescript', 'python', 'java', 'react', 'node',
      'golang', 'csharp', 'php', 'vue', 'angular', 'kotlin', 'swift',
      'flutter', 'react_native', 'django', 'spring', 'dotnet', 'ruby', 'rust',
    ];

    for (const tech of techStacks) {
      for (const position of ['junior', 'middle', 'senior', 'lead'] as const) {
        // Each position gets questions across all categories and difficulties
        questions.push(...this.generateQuestionsForCombo(tech, position));
      }
    }

    return questions;
  }

  /**
   * Generate a set of questions for a specific techStack + position combo.
   * Creates 2 technical + 1 behavioral + 1 problemSolving + 1 systemDesign
   * with appropriate difficulty spread.
   */
  private generateQuestionsForCombo(
    techStack: string,
    position: string,
  ): Partial<IrsQuestion>[] {
    const techLabel = this.getTechLabel(techStack);
    const posLabel = this.getPosLabel(position);
    const result: Partial<IrsQuestion>[] = [];

    // Difficulty based on position
    const diffMap: Record<string, string[]> = {
      junior: ['easy', 'easy', 'medium', 'easy', 'easy'],
      middle: ['medium', 'medium', 'easy', 'medium', 'hard'],
      senior: ['hard', 'medium', 'medium', 'hard', 'hard'],
      lead: ['hard', 'hard', 'medium', 'hard', 'hard'],
    };
    const diffs = diffMap[position] || diffMap['middle'];

    // 1. Technical question 1
    result.push({
      ...this.getTechnicalQ1(techStack, techLabel, posLabel),
      category: 'technical',
      difficulty: diffs[0],
      position,
      techStack,
      isActive: true,
    });

    // 2. Technical question 2
    result.push({
      ...this.getTechnicalQ2(techStack, techLabel, posLabel),
      category: 'technical',
      difficulty: diffs[1],
      position,
      techStack,
      isActive: true,
    });

    // 3. Behavioral question
    result.push({
      ...this.getBehavioralQ(techStack, techLabel, posLabel, position),
      category: 'behavioral',
      difficulty: diffs[2],
      position,
      techStack,
      isActive: true,
    });

    // 4. Problem solving question
    result.push({
      ...this.getProblemSolvingQ(techStack, techLabel, posLabel),
      category: 'problemSolving',
      difficulty: diffs[3],
      position,
      techStack,
      isActive: true,
    });

    // 5. System design question
    result.push({
      ...this.getSystemDesignQ(techStack, techLabel, posLabel, position),
      category: 'systemDesign',
      difficulty: diffs[4],
      position,
      techStack,
      isActive: true,
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // TECHNICAL QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  private getTechnicalQ1(tech: string, techLabel: string, posLabel: string): Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'> {
    const templates: Record<string, Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'>> = {
      javascript: {
        text_uz: `${posLabel} JavaScript dasturchisi sifatida: closure nima va u qanday ishlaydi? Amaliy misol keltiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} JavaScript разработчик: что такое замыкание (closure) и как оно работает? Приведите практический пример.`,
        text_en: `As a ${posLabel.toLowerCase()} JavaScript developer: what is a closure and how does it work? Give a practical example.`,
        hints: ['Scope chain haqida o\'ylang', 'Funksiya ichida funksiya', 'Ma\'lumotni yashirish'],
      },
      typescript: {
        text_uz: `${posLabel} TypeScript dasturchisi sifatida: Generic turlar nima va ular qachon ishlatiladi? Misol yozing.`,
        text_ru: `Как ${posLabel.toLowerCase()} TypeScript разработчик: что такое дженерики (generics) и когда их использовать? Напишите пример.`,
        text_en: `As a ${posLabel.toLowerCase()} TypeScript developer: what are generics and when should they be used? Write an example.`,
        hints: ['Qayta foydalanish mumkin bo\'lgan turlar', 'Type safety', 'Collection patterns'],
      },
      python: {
        text_uz: `${posLabel} Python dasturchisi sifatida: dekoratorlar (decorators) nima va ular qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Python разработчик: что такое декораторы и как они работают?`,
        text_en: `As a ${posLabel.toLowerCase()} Python developer: what are decorators and how do they work?`,
        hints: ['Higher-order functions', '@syntax', 'Wrapper pattern'],
      },
      java: {
        text_uz: `${posLabel} Java dasturchisi sifatida: OOP ning 4 ta asosiy tamoyilini tushuntiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} Java разработчик: объясните 4 основных принципа ООП.`,
        text_en: `As a ${posLabel.toLowerCase()} Java developer: explain the 4 main principles of OOP.`,
        hints: ['Encapsulation', 'Inheritance', 'Polymorphism', 'Abstraction'],
      },
      react: {
        text_uz: `${posLabel} React dasturchisi sifatida: useEffect hook qanday ishlaydi va dependency array nima?`,
        text_ru: `Как ${posLabel.toLowerCase()} React разработчик: как работает хук useEffect и что такое массив зависимостей?`,
        text_en: `As a ${posLabel.toLowerCase()} React developer: how does the useEffect hook work and what is the dependency array?`,
        hints: ['Side effects', 'Cleanup function', 'Render cycle'],
      },
      node: {
        text_uz: `${posLabel} Node.js dasturchisi sifatida: Event Loop qanday ishlaydi? Asinxron kodni tushuntiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} Node.js разработчик: как работает Event Loop? Объясните асинхронный код.`,
        text_en: `As a ${posLabel.toLowerCase()} Node.js developer: how does the Event Loop work? Explain asynchronous code.`,
        hints: ['Single-threaded', 'Callback queue', 'Non-blocking I/O'],
      },
      golang: {
        text_uz: `${posLabel} Go dasturchisi sifatida: goroutine va channel nima? Concurrency misolini keltiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} Go разработчик: что такое горутины и каналы? Приведите пример конкурентности.`,
        text_en: `As a ${posLabel.toLowerCase()} Go developer: what are goroutines and channels? Give a concurrency example.`,
        hints: ['Lightweight threads', 'CSP model', 'go keyword'],
      },
      csharp: {
        text_uz: `${posLabel} C# dasturchisi sifatida: async/await qanday ishlaydi va Task nima?`,
        text_ru: `Как ${posLabel.toLowerCase()} C# разработчик: как работает async/await и что такое Task?`,
        text_en: `As a ${posLabel.toLowerCase()} C# developer: how does async/await work and what is Task?`,
        hints: ['Task-based async', 'State machine', 'ConfigureAwait'],
      },
      php: {
        text_uz: `${posLabel} PHP dasturchisi sifatida: namespace va autoloading qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} PHP разработчик: как работают пространства имён и автозагрузка?`,
        text_en: `As a ${posLabel.toLowerCase()} PHP developer: how do namespaces and autoloading work?`,
        hints: ['PSR-4', 'Composer autoload', 'use statement'],
      },
      vue: {
        text_uz: `${posLabel} Vue.js dasturchisi sifatida: reaktivlik (reactivity) tizimi qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Vue.js разработчик: как работает система реактивности?`,
        text_en: `As a ${posLabel.toLowerCase()} Vue.js developer: how does the reactivity system work?`,
        hints: ['Proxy/Object.defineProperty', 'ref vs reactive', 'Watchers'],
      },
      angular: {
        text_uz: `${posLabel} Angular dasturchisi sifatida: Dependency Injection qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Angular разработчик: как работает внедрение зависимостей (DI)?`,
        text_en: `As a ${posLabel.toLowerCase()} Angular developer: how does Dependency Injection work?`,
        hints: ['Providers', 'Injector hierarchy', '@Injectable'],
      },
      kotlin: {
        text_uz: `${posLabel} Kotlin dasturchisi sifatida: coroutines nima va ular qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Kotlin разработчик: что такое корутины и как они работают?`,
        text_en: `As a ${posLabel.toLowerCase()} Kotlin developer: what are coroutines and how do they work?`,
        hints: ['suspend functions', 'CoroutineScope', 'Dispatchers'],
      },
      swift: {
        text_uz: `${posLabel} Swift dasturchisi sifatida: protocol-oriented programming tushuntiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} Swift разработчик: объясните протокол-ориентированное программирование.`,
        text_en: `As a ${posLabel.toLowerCase()} Swift developer: explain protocol-oriented programming.`,
        hints: ['Protocol extensions', 'Value types', 'Composition over inheritance'],
      },
      flutter: {
        text_uz: `${posLabel} Flutter dasturchisi sifatida: Widget lifecycle va StatefulWidget qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Flutter разработчик: как работает жизненный цикл виджетов и StatefulWidget?`,
        text_en: `As a ${posLabel.toLowerCase()} Flutter developer: how does Widget lifecycle and StatefulWidget work?`,
        hints: ['initState', 'build method', 'dispose'],
      },
      react_native: {
        text_uz: `${posLabel} React Native dasturchisi sifatida: bridge arxitekturasi qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} React Native разработчик: как работает архитектура моста (bridge)?`,
        text_en: `As a ${posLabel.toLowerCase()} React Native developer: how does the bridge architecture work?`,
        hints: ['JS thread', 'Native thread', 'JSON serialization'],
      },
      django: {
        text_uz: `${posLabel} Django dasturchisi sifatida: ORM va QuerySet qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Django разработчик: как работает ORM и QuerySet?`,
        text_en: `As a ${posLabel.toLowerCase()} Django developer: how does the ORM and QuerySet work?`,
        hints: ['Lazy evaluation', 'Chaining', 'N+1 problem'],
      },
      spring: {
        text_uz: `${posLabel} Spring dasturchisi sifatida: IoC Container va Bean lifecycle tushuntiring.`,
        text_ru: `Как ${posLabel.toLowerCase()} Spring разработчик: объясните IoC контейнер и жизненный цикл бинов.`,
        text_en: `As a ${posLabel.toLowerCase()} Spring developer: explain the IoC Container and Bean lifecycle.`,
        hints: ['ApplicationContext', '@Bean', 'Scopes'],
      },
      dotnet: {
        text_uz: `${posLabel} .NET dasturchisi sifatida: middleware pipeline ASP.NET Core da qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} .NET разработчик: как работает конвейер middleware в ASP.NET Core?`,
        text_en: `As a ${posLabel.toLowerCase()} .NET developer: how does the middleware pipeline work in ASP.NET Core?`,
        hints: ['Request delegate', 'app.Use vs app.Map', 'Order matters'],
      },
      ruby: {
        text_uz: `${posLabel} Ruby dasturchisi sifatida: block, proc va lambda orasidagi farq nima?`,
        text_ru: `Как ${posLabel.toLowerCase()} Ruby разработчик: в чём разница между block, proc и lambda?`,
        text_en: `As a ${posLabel.toLowerCase()} Ruby developer: what is the difference between block, proc, and lambda?`,
        hints: ['Yield', 'Arity checking', 'Return behavior'],
      },
      rust: {
        text_uz: `${posLabel} Rust dasturchisi sifatida: ownership va borrowing tizimi qanday ishlaydi?`,
        text_ru: `Как ${posLabel.toLowerCase()} Rust разработчик: как работает система владения (ownership) и заимствования (borrowing)?`,
        text_en: `As a ${posLabel.toLowerCase()} Rust developer: how does the ownership and borrowing system work?`,
        hints: ['Move semantics', 'Mutable references', 'Lifetime annotations'],
      },
    };

    return templates[tech] || {
      text_uz: `${posLabel} ${techLabel} dasturchisi sifatida: ${techLabel} ning asosiy xususiyatlarini tushuntiring.`,
      text_ru: `Как ${posLabel.toLowerCase()} ${techLabel} разработчик: объясните основные особенности ${techLabel}.`,
      text_en: `As a ${posLabel.toLowerCase()} ${techLabel} developer: explain the core features of ${techLabel}.`,
      hints: ['Core concepts', 'Best practices', 'Common patterns'],
    };
  }

  private getTechnicalQ2(tech: string, techLabel: string, posLabel: string): Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'> {
    const templates: Record<string, Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'>> = {
      javascript: {
        text_uz: `Promise va async/await orasidagi farq nima? Xatoliklarni qanday ushlaysiz (error handling)?`,
        text_ru: `В чём разница между Promise и async/await? Как обрабатывать ошибки?`,
        text_en: `What is the difference between Promise and async/await? How do you handle errors?`,
        hints: ['try/catch', '.catch() chain', 'Promise.all vs Promise.allSettled'],
      },
      typescript: {
        text_uz: `Union types, intersection types va type guards qanday ishlaydi?`,
        text_ru: `Как работают union types, intersection types и type guards?`,
        text_en: `How do union types, intersection types, and type guards work?`,
        hints: ['Narrowing', 'typeof/instanceof', 'Discriminated unions'],
      },
      python: {
        text_uz: `List comprehension va generator orasidagi farq nima? Qachon qaysi birini ishlatish kerak?`,
        text_ru: `В чём разница между list comprehension и генераторами? Когда использовать каждый?`,
        text_en: `What is the difference between list comprehension and generators? When to use each?`,
        hints: ['Memory efficiency', 'Lazy evaluation', 'yield keyword'],
      },
      java: {
        text_uz: `Java Streams API qanday ishlaydi? map, filter, reduce misollari keltiring.`,
        text_ru: `Как работает Java Streams API? Приведите примеры map, filter, reduce.`,
        text_en: `How does Java Streams API work? Give examples of map, filter, reduce.`,
        hints: ['Lazy processing', 'Terminal vs intermediate', 'Parallel streams'],
      },
      react: {
        text_uz: `React da state management: useState, useReducer va Context API qachon ishlatiladi?`,
        text_ru: `Управление состоянием в React: когда использовать useState, useReducer и Context API?`,
        text_en: `State management in React: when to use useState, useReducer, and Context API?`,
        hints: ['Local vs global state', 'Complex state logic', 'Prop drilling'],
      },
      node: {
        text_uz: `Node.js da stream'lar qanday ishlaydi? Readable, Writable va Transform stream tushuntiring.`,
        text_ru: `Как работают потоки (streams) в Node.js? Объясните Readable, Writable и Transform.`,
        text_en: `How do streams work in Node.js? Explain Readable, Writable, and Transform streams.`,
        hints: ['Backpressure', 'Piping', 'Chunk processing'],
      },
    };

    return templates[tech] || {
      text_uz: `${techLabel} da eng ko'p ishlatiladigan design pattern'larni tushuntiring va misol keltiring.`,
      text_ru: `Объясните наиболее используемые паттерны проектирования в ${techLabel} и приведите примеры.`,
      text_en: `Explain the most commonly used design patterns in ${techLabel} and give examples.`,
      hints: ['Singleton', 'Observer', 'Factory'],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BEHAVIORAL QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  private getBehavioralQ(tech: string, techLabel: string, posLabel: string, position: string): Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'> {
    const templates: Record<string, Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'>> = {
      junior: {
        text_uz: `Yangi texnologiyani tez o'rganishingiz kerak bo'lgan vaziyat haqida gapiring. Qanday yondashuvda oldingiz?`,
        text_ru: `Расскажите о ситуации, когда вам нужно было быстро освоить новую технологию. Как вы подошли к этому?`,
        text_en: `Tell me about a time you had to quickly learn a new technology. How did you approach it?`,
        hints: ['STAR metodi', 'Resurslar va strategiya', 'Natija'],
      },
      middle: {
        text_uz: `Jamoadagi texnik qaror bo'yicha kelishmovchilikni qanday hal qilgansiz? Misol keltiring.`,
        text_ru: `Как вы решали разногласия в команде по техническому решению? Приведите пример.`,
        text_en: `How did you resolve a technical disagreement in your team? Give an example.`,
        hints: ['Muloqot', 'Trade-offs tahlili', 'Konsensus'],
      },
      senior: {
        text_uz: `Junior dasturchiga murakkab kontseptsiyani o'rgatishingiz kerak bo'lgan vaqt haqida gapiring.`,
        text_ru: `Расскажите о случае, когда вам пришлось обучить младшего разработчика сложной концепции.`,
        text_en: `Tell me about a time you had to teach a junior developer a complex concept.`,
        hints: ['Mentorlik yondashuvi', 'Soddalash-tirish', 'Natijani kuzatish'],
      },
      lead: {
        text_uz: `Jamoadagi past motivatsiyani qanday aniqlagan va hal qilgansiz?`,
        text_ru: `Как вы выявляли и решали проблему низкой мотивации в команде?`,
        text_en: `How did you identify and address low motivation in your team?`,
        hints: ['1-on-1 suhbatlar', 'Root cause analysis', 'Action plan'],
      },
    };

    return templates[position] || templates['middle'];
  }

  // ═══════════════════════════════════════════════════════════════
  // PROBLEM SOLVING QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  private getProblemSolvingQ(tech: string, techLabel: string, posLabel: string): Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'> {
    const templates: Record<string, Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'>> = {
      javascript: {
        text_uz: `Massivdagi takrorlanuvchi elementlarni O(n) murakkablikda qanday topasiz?`,
        text_ru: `Как найти дублирующиеся элементы в массиве с O(n) сложностью?`,
        text_en: `How would you find duplicate elements in an array with O(n) complexity?`,
        hints: ['Set/Map', 'Hash table', 'Space-time tradeoff'],
      },
      typescript: {
        text_uz: `Type-safe event emitter qanday yaratish mumkin? Generic type'lardan foydalaning.`,
        text_ru: `Как создать типобезопасный event emitter? Используйте дженерики.`,
        text_en: `How would you create a type-safe event emitter? Use generics.`,
        hints: ['Mapped types', 'Conditional types', 'Infer keyword'],
      },
      python: {
        text_uz: `Katta CSV faylni (10GB) memory cheklovida qanday qayta ishlaysiz?`,
        text_ru: `Как обработать большой CSV файл (10GB) с ограничением памяти?`,
        text_en: `How would you process a large CSV file (10GB) with memory constraints?`,
        hints: ['Generator/iterator', 'Chunk processing', 'pandas chunksize'],
      },
      java: {
        text_uz: `Multi-threaded muhitda thread-safe counter qanday yaratish mumkin?`,
        text_ru: `Как создать потокобезопасный счётчик в многопоточной среде?`,
        text_en: `How would you create a thread-safe counter in a multithreaded environment?`,
        hints: ['AtomicInteger', 'synchronized', 'Concurrent classes'],
      },
      react: {
        text_uz: `10,000 ta elementli ro'yxatni render qilishda performance muammolarni qanday hal qilasiz?`,
        text_ru: `Как решить проблемы производительности при рендеринге списка из 10000 элементов?`,
        text_en: `How would you solve performance issues when rendering a list of 10,000 items?`,
        hints: ['Virtualization', 'React.memo', 'useMemo/useCallback'],
      },
      node: {
        text_uz: `Memory leak'ni Node.js dasturda qanday aniqlaysiz va tuzatasiz?`,
        text_ru: `Как обнаружить и устранить утечку памяти в Node.js приложении?`,
        text_en: `How would you detect and fix a memory leak in a Node.js application?`,
        hints: ['Heap snapshot', 'process.memoryUsage', 'WeakRef/WeakMap'],
      },
    };

    return templates[tech] || {
      text_uz: `${techLabel} loyihada performance bottleneck ni qanday aniqlaysiz va optimizatsiya qilasiz?`,
      text_ru: `Как вы определяете и оптимизируете узкие места производительности в ${techLabel} проекте?`,
      text_en: `How do you identify and optimize performance bottlenecks in a ${techLabel} project?`,
      hints: ['Profiling', 'Benchmarking', 'Caching strategies'],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM DESIGN QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  private getSystemDesignQ(tech: string, techLabel: string, posLabel: string, position: string): Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'> {
    const templates: Record<string, Pick<IrsQuestion, 'text_uz' | 'text_ru' | 'text_en' | 'hints'>> = {
      junior: {
        text_uz: `Oddiy REST API qanday tuzilishda bo'ladi? Endpoint dizayni va HTTP metodlarini tushuntiring.`,
        text_ru: `Как устроен простой REST API? Объясните дизайн эндпоинтов и HTTP методы.`,
        text_en: `How is a simple REST API structured? Explain endpoint design and HTTP methods.`,
        hints: ['CRUD operations', 'Status codes', 'Resource naming'],
      },
      middle: {
        text_uz: `Real-time chat tizimini qanday loyihalaysiz? Asosiy komponentlar va texnologiyalarni tushuntiring.`,
        text_ru: `Как вы спроектируете систему чата в реальном времени? Объясните компоненты и технологии.`,
        text_en: `How would you design a real-time chat system? Explain the main components and technologies.`,
        hints: ['WebSocket', 'Message queue', 'Database choice'],
      },
      senior: {
        text_uz: `Katta masshtabli notification tizimini dizayn qiling (10M+ foydalanuvchi).`,
        text_ru: `Спроектируйте масштабную систему уведомлений (10M+ пользователей).`,
        text_en: `Design a large-scale notification system (10M+ users).`,
        hints: ['Message queue', 'Priority system', 'Delivery guarantee'],
      },
      lead: {
        text_uz: `Microservices arxitekturasiga monolitdan migratsiya strategiyasini tushuntiring.`,
        text_ru: `Объясните стратегию миграции с монолита на микросервисную архитектуру.`,
        text_en: `Explain the strategy for migrating from monolith to microservices architecture.`,
        hints: ['Strangler fig pattern', 'Domain boundaries', 'Data consistency'],
      },
    };

    return templates[position] || templates['middle'];
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private getTechLabel(tech: string): string {
    const labels: Record<string, string> = {
      javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
      java: 'Java', csharp: 'C#', golang: 'Go', php: 'PHP', ruby: 'Ruby',
      swift: 'Swift', kotlin: 'Kotlin', rust: 'Rust', react: 'React',
      angular: 'Angular', vue: 'Vue.js', node: 'Node.js', django: 'Django',
      spring: 'Spring', dotnet: '.NET', flutter: 'Flutter', react_native: 'React Native',
    };
    return labels[tech] || tech;
  }

  private getPosLabel(position: string): string {
    const labels: Record<string, string> = {
      junior: 'Junior', middle: 'Middle', senior: 'Senior', lead: 'Lead',
    };
    return labels[position] || position;
  }
}
