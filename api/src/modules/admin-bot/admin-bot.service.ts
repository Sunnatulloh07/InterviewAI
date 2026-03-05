import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Bot, Context, session, InlineKeyboard } from 'grammy';
import { User, UserDocument } from '../users/schemas/user.schema';

interface AdminBotContext extends Context {
  session: {
    isAdmin?: boolean;
    adminId?: number;
    awaitingMessage?: boolean;
    replyingToUserId?: number; // Target user ID for reply
  };
}

/**
 * Admin Support Bot Service
 * - Admins: Full management (stats, upgrade, extend, etc.)
 * - Regular users: Submit support requests
 */
@Injectable()
export class AdminBotService implements OnModuleInit {
  private readonly logger = new Logger(AdminBotService.name);
  private bot: Bot<AdminBotContext> | null = null;
  private adminTelegramIds: number[] = [];

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    await this.initializeBot();
  }

  /**
   * Get user display name
   */
  private getUserName(user: any): string {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) return user.firstName;
    if (user.telegramFirstName) return user.telegramFirstName;
    return user.phoneNumber || 'Unknown';
  }

  private async initializeBot() {
    const token = this.configService.get<string>('ADMIN_BOT_TOKEN');
    const adminIds = this.configService.get<string>('ADMIN_TELEGRAM_IDS');

    if (!token) {
      this.logger.warn('ADMIN_BOT_TOKEN not found, admin bot disabled');
      return;
    }

    // Parse admin Telegram IDs
    if (adminIds) {
      this.adminTelegramIds = adminIds
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
      this.logger.log(`Admin Telegram IDs configured: ${this.adminTelegramIds.join(', ')}`);
    }

    try {
      this.bot = new Bot<AdminBotContext>(token);

      // Session middleware
      this.bot.use(
        session({
          initial: () => ({
            isAdmin: false,
            adminId: undefined,
            awaitingMessage: false,
          }),
        }),
      );

      // Check if user is admin (but don't block non-admins)
      this.bot.use(async (ctx, next) => {
        const telegramId = ctx.from?.id;
        if (telegramId && this.adminTelegramIds.includes(telegramId)) {
          ctx.session.isAdmin = true;
          ctx.session.adminId = telegramId;
        } else {
          ctx.session.isAdmin = false;
        }
        await next();
      });

      // Register commands
      this.registerCommands();

      // 1. Default menu for ALL users (limited)
      await this.bot.api.setMyCommands([
        { command: 'start', description: '🏠 Bosh menyu / Main menu' },
        { command: 'help', description: '❓ Yordam / Help' },
      ]);

      // 2. Admin menu for specific admins (full access)
      if (this.adminTelegramIds.length > 0) {
        const adminCommands = [
          { command: 'start', description: '🏠 Bosh menyu' },
          { command: 'stats', description: '📊 Statistika' },
          { command: 'find', description: '🔍 Qidirish' },
          { command: 'help', description: '❓ Yordam' },
          { command: 'block', description: '🚫 Bloklash' },
          { command: 'unblock', description: '✅ Blokdan chiqarish' },
        ];

        // Set commands specifically for each admin
        for (const adminId of this.adminTelegramIds) {
          try {
            await this.bot.api.setMyCommands(adminCommands, {
              scope: { type: 'chat', chat_id: adminId },
            });
          } catch (e) {
            this.logger.warn(`Failed to set commands for admin ${adminId}`);
          }
        }
      }

      // Error handler
      this.bot.catch((err) => {
        const ctx = err.ctx;
        this.logger.error(`Error while handling update ${ctx.update.update_id}:`);
        this.logger.error(err.error);
      });

      // Start bot
      this.bot.start();
      this.logger.log('Admin bot started successfully');
    } catch (error: any) {
      this.logger.error(`Failed to initialize admin bot: ${error?.message}`);
    }
  }

  private registerCommands() {
    if (!this.bot) return;

    // Start command - Different for admins and users
    this.bot.command('start', async (ctx) => {
      if (ctx.session.isAdmin) {
        await this.showAdminPanel(ctx);
      } else {
        await this.showUserPanel(ctx);
      }
    });

    // Admin-only commands
    this.bot.command('stats', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      await this.handleStats(ctx);
    });

    this.bot.command('find', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const query = ctx.message?.text?.split(' ').slice(1).join(' ');
      if (!query) {
        await ctx.reply('Usage: /find <phone|telegramId|name>');
        return;
      }
      await this.handleFindUser(ctx, query);
    });

    this.bot.command('user', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const userId = ctx.message?.text?.split(' ')[1];
      if (!userId) {
        await ctx.reply('Usage: /user <userId>');
        return;
      }
      await this.handleUserDetails(ctx, userId);
    });

    this.bot.command('upgrade', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const parts = ctx.message?.text?.split(' ') || [];
      const userId = parts[1];
      const plan = parts[2] as 'starter' | 'pro' | 'elite';

      if (!userId || !plan || !['starter', 'pro', 'elite'].includes(plan)) {
        await ctx.reply('Usage: /upgrade <userId> <starter|pro|elite>');
        return;
      }
      await this.handleUpgrade(ctx, userId, plan);
    });

    this.bot.command('extend', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const parts = ctx.message?.text?.split(' ') || [];
      const userId = parts[1];
      const days = parseInt(parts[2]);

      if (!userId || isNaN(days)) {
        await ctx.reply('Usage: /extend <userId> <days>');
        return;
      }
      await this.handleExtend(ctx, userId, days);
    });

    this.bot.command('cancel', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const userId = ctx.message?.text?.split(' ')[1];
      if (!userId) {
        await ctx.reply('Usage: /cancel <userId>');
        return;
      }
      await this.handleCancel(ctx, userId);
    });

    this.bot.command('block', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const userId = ctx.message?.text?.split(' ')[1];
      if (!userId) {
        await ctx.reply('Usage: /block <userId>');
        return;
      }
      await this.handleBlock(ctx, userId);
    });

    this.bot.command('unblock', async (ctx) => {
      if (!ctx.session.isAdmin) {
        await ctx.reply('⛔ Bu buyruq faqat adminlar uchun');
        return;
      }
      const userId = ctx.message?.text?.split(' ')[1];
      if (!userId) {
        await ctx.reply('Usage: /unblock <userId>');
        return;
      }
      await this.handleUnblock(ctx, userId);
    });

    // Help command - different for admins and users
    this.bot.command('help', async (ctx) => {
      if (ctx.session.isAdmin) {
        await ctx.reply(
          `❓ <b>Admin Yordam</b>\n\n` +
            `<b>Buyruqlar:</b>\n` +
            `/start - Bosh menyu\n` +
            `/stats - Statistika\n` +
            `/find &lt;query&gt; - Foydalanuvchi qidirish\n` +
            `/user &lt;id&gt; - User tafsilotlari\n` +
            `/upgrade &lt;id&gt; &lt;plan&gt; - Plan yangilash\n` +
            `/extend &lt;id&gt; &lt;days&gt; - Obunani uzaytirish\n` +
            `/cancel &lt;id&gt; - Obunani bekor qilish\n` +
            `/block &lt;id&gt; - Foydalanuvchini bloklash\n` +
            `/unblock &lt;id&gt; - Blokdan chiqarish`,
          { parse_mode: 'HTML' },
        );
      } else {
        await ctx.reply(
          `❓ <b>Yordam</b>\n\n` +
            `Bu bot orqali siz:\n` +
            `• Tarif yangilash so'rovi yuborishingiz\n` +
            `• Savollaringizni yuborishingiz mumkin\n\n` +
            `Shunchaki xabar yozing va biz javob beramiz!`,
          { parse_mode: 'HTML' },
        );
      }
    });

    // Handle all messages (support requests from users AND admin replies)
    this.bot.on('message', async (ctx) => {
      // Ignore commands (they are handled by command handlers)
      if (ctx.message?.text?.startsWith('/')) return;

      // 1. If Admin is Replying
      if (ctx.session.isAdmin && ctx.session.replyingToUserId) {
        await this.handleAdminReply(ctx);
        return;
      }

      // 2. If Admin (but not replying) -> Ignore
      if (ctx.session.isAdmin) return;

      // 3. If User -> Support Request
      await this.handleSupportRequest(ctx);
    });

    // Callback query handler
    this.bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery?.data;
      await ctx.answerCallbackQuery();

      if (!ctx.session.isAdmin) {
        // User callbacks
        if (data === 'upgrade_request') {
          const keyboard = new InlineKeyboard()
            .text('💼 Starter ($5)', 'request_plan_starter')
            .row()
            .text('🚀 Pro ($15)', 'request_plan_pro')
            .row()
            .text('👑 Elite ($30)', 'request_plan_elite');

          await ctx.reply(`📝 <b>Tarif rejasini tanlang:</b>\n\n` + `Qaysi tarifga o'tmoqchisiz?`, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
        } else if (data?.startsWith('request_plan_')) {
          const plan = data.replace('request_plan_', '');
          await this.handlePlanRequest(ctx, plan);
        } else if (data === 'support_message') {
          await ctx.reply(
            `💬 <b>Xabar yuborish</b>\n\n` +
              `Savolingiz yoki muammoingizni (rasm, sticker, text) yuboring, biz tez orada javob beramiz!`,
            { parse_mode: 'HTML' },
          );
        }
        return;
      }

      // Admin callbacks
      if (data === 'stats') {
        await this.handleStats(ctx);
      } else if (data === 'find_user') {
        await ctx.reply('Send user phone, telegram ID, or name:\n\nExample: /find +998901234567');
      } else if (data === 'recent_users') {
        await this.handleRecentUsers(ctx);
      } else if (data === 'expired_trials') {
        await this.handleExpiredTrials(ctx);
      } else if (data === 'pending_requests') {
        await this.handlePendingRequests(ctx);
      } else if (data?.startsWith('user_')) {
        const userId = data.replace('user_', '');
        await this.handleUserDetails(ctx, userId);
      } else if (data?.startsWith('upgrade_')) {
        const [, userId, plan] = data.split('_');
        await this.handleUpgrade(ctx, userId, plan as any);
      } else if (data?.startsWith('extend_')) {
        const [, userId, days] = data.split('_');
        await this.handleExtend(ctx, userId, parseInt(days));
      } else if (data?.startsWith('cancel_')) {
        const userId = data.replace('cancel_', '');
        await this.handleCancel(ctx, userId);
      } else if (data?.startsWith('block_')) {
        const userId = data.replace('block_', '');
        await this.handleBlock(ctx, userId);
      } else if (data?.startsWith('unblock_')) {
        const userId = data.replace('unblock_', '');
        await this.handleUnblock(ctx, userId);
      } else if (data?.startsWith('reply_to_')) {
        const userId = parseInt(data.replace('reply_to_', ''));
        ctx.session.replyingToUserId = userId;
        await ctx.reply(
          `✍️ <b>Javob yozish</b>\n\n` +
            `User ID: <code>${userId}</code>\n` +
            `Xabaringizni (text, rasm, sticker) yuboring:`,
          { parse_mode: 'HTML' },
        );
      } else if (data?.startsWith('confirm_upgrade_request_')) {
        const parts = data.replace('confirm_upgrade_request_', '').split('_');
        const userId = parts[0];
        const planName = parts[1];

        const keyboard = new InlineKeyboard()
          .text('✅ HA, Tasdiqlayman', `do_upgrade_${userId}_${planName}`)
          .text("❌ YO'Q", `cancel_upgrade_action`);

        await ctx.editMessageText(
          `⚠️ <b>DIQQAT: Tarifni o'zgartirish</b>\n\n` +
            `Siz haqiqatdan ham ushbu foydalanuvchini <b>${planName.toUpperCase()}</b> tarifiga o'tkazmoqchimisiz?\n` +
            `Bu amal darhol bajariladi.`,
          { parse_mode: 'HTML', reply_markup: keyboard },
        );
      } else if (data?.startsWith('do_upgrade_')) {
        const parts = data.replace('do_upgrade_', '').split('_');
        const userId = parts[0];
        const planName = parts[1] as 'starter' | 'pro' | 'elite';

        // Execute upgrade
        await this.handleUpgrade(ctx, userId, planName);

        // Update message to remove buttons
        try {
          await ctx.editMessageText(
            `✅ <b>Amal bajarildi:</b> User ${planName.toUpperCase()} tarifiga o'tkazildi.`,
            { parse_mode: 'HTML' },
          );
        } catch (e) {
          // Ignore if message can't be edited (e.g. too old)
        }
      } else if (data === 'cancel_upgrade_action') {
        await ctx.editMessageText('❌ Amal bekor qilindi.', { parse_mode: 'HTML' });
      }
    });
  }

  // ============================================================
  // PANELS
  // ============================================================

  private async showAdminPanel(ctx: AdminBotContext) {
    const keyboard = new InlineKeyboard()
      .text('📊 Statistics', 'stats')
      .text('🔍 Find User', 'find_user')
      .row()
      .text('📋 Recent Users', 'recent_users')
      .text('⚠️ Expired Trials', 'expired_trials')
      .row()
      .text('📩 Pending Requests', 'pending_requests');

    await ctx.reply(
      `👋 <b>Admin Panel</b>\n\n` +
        `Admin ID: <code>${ctx.session.adminId}</code>\n\n` +
        `<b>Commands:</b>\n` +
        `/stats - Statistics\n` +
        `/find <query> - Find user\n` +
        `/user <id> - User details\n` +
        `/upgrade <id> <plan> - Upgrade plan\n` +
        `/extend <id> <days> - Extend subscription\n` +
        `/cancel <id> - Cancel subscription`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  }

  private async showUserPanel(ctx: AdminBotContext) {
    const telegramId = ctx.from?.id;
    const user = await this.userModel.findOne({ telegramId });

    const keyboard = new InlineKeyboard()
      .text('⬆️ Tarif yangilash', 'upgrade_request')
      .row()
      .text('💬 Xabar yuborish', 'support_message');

    let userInfo = '';
    if (user) {
      const plan = user.subscription?.plan || 'free_trial';
      const planName =
        plan === 'free_trial' ? 'Sinov' : plan.charAt(0).toUpperCase() + plan.slice(1);
      userInfo =
        `\n\n👤 <b>Sizning profilingiz:</b>\n` +
        `📱 Tel: ${user.phoneNumber}\n` +
        `💳 Tarif: ${planName}`;
    }

    await ctx.reply(
      `👋 <b>Jobi Support</b>\n\n` +
        `Sizga qanday yordam bera olamiz?${userInfo}\n\n` +
        `Quyidagi tugmalardan birini tanlang yoki xabar yozing (matn, rasm, sticker):`,
      { parse_mode: 'HTML', reply_markup: keyboard },
    );
  }

  // ============================================================
  // SUPPORT REQUESTS
  // ============================================================

  private async handleSupportRequest(ctx: AdminBotContext) {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;
    const messageDetails = ctx.message?.text || '[Media Message]';

    // Find user in database
    const user = await this.userModel.findOne({ telegramId });
    const userInfo = user
      ? `${this.getUserName(user)} (${user.phoneNumber})`
      : `${firstName} (@${username || 'N/A'})`;

    // Send to all admins
    for (const adminId of this.adminTelegramIds) {
      try {
        // Send Header first
        await this.bot!.api.sendMessage(
          adminId,
          `📩 <b>Yangi so'rov</b>\n\n` +
            `👤 <b>Foydalanuvchi:</b> ${userInfo}\n` +
            `🆔 Telegram ID: <code>${telegramId}</code>`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text('↩️ Javob berish', `reply_to_${telegramId}`),
          },
        );

        // Forward the actual message (Pass-through)
        await ctx.copyMessage(adminId);
      } catch (error) {
        this.logger.warn(`Failed to notify admin ${adminId}`);
      }
    }

    // Confirm to user (only if not a repeated burst, but for now always confirm)
    // To avoid spamming user if they send album, maybe debouncing?
    // But simple reply is safer.
    await ctx.reply(`✅ <b>Xabaringiz yetkazildi!</b>`, { parse_mode: 'HTML' });

    this.logger.log(`Support request from ${telegramId}: ${messageDetails.substring(0, 50)}...`);
  }

  private async handlePlanRequest(ctx: AdminBotContext, plan: string) {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username;
    const firstName = ctx.from?.first_name;

    // Find user
    const user = await this.userModel.findOne({ telegramId });
    const userInfo = user
      ? `${this.getUserName(user)} (${user.phoneNumber})`
      : `${firstName} (@${username || 'N/A'})`;

    // Notify admins
    for (const adminId of this.adminTelegramIds) {
      try {
        const keyboard = new InlineKeyboard()
          .text(
            `✅ Tasdiqlash (${plan.toUpperCase()})`,
            `confirm_upgrade_request_${user?._id}_${plan}`,
          )
          .row()
          .text('↩️ Javob berish', `reply_to_${telegramId}`);

        await this.bot!.api.sendMessage(
          adminId,
          `📝 <b>Yangi Tarif So'rovi</b>\n\n` +
            `👤 <b>Foydalanuvchi:</b> ${userInfo}\n` +
            `🆔 Telegram ID: <code>${telegramId}</code>\n` +
            `💼 <b>So'ralgan Plan:</b> ${plan.toUpperCase()}`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboard,
          },
        );
      } catch (error) {
        this.logger.warn(`Failed to notify admin ${adminId}`);
      }
    }

    // Confirm to user
    await ctx.reply(
      `✅ <b>So'rovingiz qabul qilindi!</b>\n\n` +
        `Sizning ${plan.toUpperCase()} tarifiga o'tish so'rovingiz adminlarga yuborildi.\n` +
        `Tez orada siz bilan bog'lanamiz!`,
      { parse_mode: 'HTML' },
    );

    this.logger.log(`Plan request from ${telegramId}: ${plan}`);
  }

  private async handleAdminReply(ctx: AdminBotContext) {
    const userId = ctx.session.replyingToUserId;
    if (!userId) return;

    // Send reply to user
    try {
      // Send optional header or just the message
      // Better to just copy message to look natural, or add a small "Support:" marker?
      // Since it's a separate Bot, user knows it's Support.
      // But if user sends media, and admin replies with text, it's fine.
      // If admin replies with photo, we just copy.

      // Let's copy message directly
      await ctx.copyMessage(userId);

      await ctx.reply(`✅ Javob yuborildi!`);
      this.logger.log(`Admin ${ctx.session.adminId} replied to user ${userId}`);
    } catch (error) {
      await ctx.reply(`❌ Xatolik: Xabar yuborilmadi. User botni bloklagan bo'lishi mumkin.`);
      this.logger.error(`Failed to reply to user ${userId}: ${error}`);
    }

    // Clear session? No, keep replying until admin changes focus or stops.
    // If we clear, admin has to click reply again for next message.
    // User requested "conversation like".
    // I will KEEP session.replyingToUserId active.
    // BUT: Admin commands (like /start) should clear it?
    // /start clears it because it resets flow implicitly?
    // Added a check in message handler: if startsWith('/') it returns.
    // So commands work. But replyingToUserId persists.
    // If admin types /start, session `replyingToUserId` is NOT cleared automatically unless I do it.
    // I should probably clear it on /start or specific command?
    // For now, I'll clear it after sending ONE message intended for "single reply".
    // If user wants chat mode, they might want persistent.
    // Existing code CLEARED it: `ctx.session.replyingToUserId = undefined;` (Line 569).
    // I will keep the CLEAR behavior to match previous logic logic unless requested otherwise.
    ctx.session.replyingToUserId = undefined;
  }

  private async handlePendingRequests(ctx: AdminBotContext) {
    await ctx.reply(
      `📩 <b>So'rovlar</b>\n\n` +
        `So'rovlar real-time keladi.\n` +
        `Foydalanuvchi xabar yuborganda siz notification olasiz.`,
      { parse_mode: 'HTML' },
    );
  }

  // ============================================================
  // ADMIN COMMAND HANDLERS
  // ============================================================

  private async handleStats(ctx: AdminBotContext) {
    const totalUsers = await this.userModel.countDocuments();
    const activeUsers = await this.userModel.countDocuments({ 'subscription.status': 'active' });
    const trialUsers = await this.userModel.countDocuments({ 'subscription.plan': 'free_trial' });

    const starterUsers = await this.userModel.countDocuments({ 'subscription.plan': 'starter' });
    const proUsers = await this.userModel.countDocuments({ 'subscription.plan': 'pro' });
    const eliteUsers = await this.userModel.countDocuments({ 'subscription.plan': 'elite' });

    const now = new Date();
    const expiredTrials = await this.userModel.countDocuments({
      'subscription.plan': 'free_trial',
      'subscription.trialEndsAt': { $lt: now },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await this.userModel.countDocuments({ createdAt: { $gte: today } });

    await ctx.reply(
      `📊 <b>Platform Statistics</b>\n\n` +
        `👥 <b>Users</b>\n` +
        `├ Total: ${totalUsers}\n` +
        `├ Active: ${activeUsers}\n` +
        `├ Trial: ${trialUsers}\n` +
        `└ Expired: ${expiredTrials}\n\n` +
        `💳 <b>Subscriptions</b>\n` +
        `├ Free Trial: ${trialUsers}\n` +
        `├ Starter: ${starterUsers}\n` +
        `├ Pro: ${proUsers}\n` +
        `└ Elite: ${eliteUsers}\n\n` +
        `📈 <b>Today</b>\n` +
        `└ New users: ${newUsersToday}`,
      { parse_mode: 'HTML' },
    );
  }

  private async handleFindUser(ctx: AdminBotContext, query: string) {
    const searchQuery = {
      $or: [
        { phoneNumber: { $regex: query, $options: 'i' } },
        { telegramId: isNaN(Number(query)) ? -1 : Number(query) },
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { telegramUsername: { $regex: query, $options: 'i' } },
      ],
    };

    const users = await this.userModel.find(searchQuery).limit(10);

    if (users.length === 0) {
      await ctx.reply(`❌ No users found for: "${query}"`);
      return;
    }

    let message = `🔍 <b>Search Results</b> (${users.length})\n\n`;
    const keyboard = new InlineKeyboard();

    users.forEach((user, i) => {
      const name = this.getUserName(user);
      message += `${i + 1}. ${name}\n`;
      message += `   📞 ${user.phoneNumber}\n`;
      message += `   💳 ${user.subscription?.plan || 'free_trial'}\n\n`;

      keyboard.text(`${i + 1}. ${name.substring(0, 15)}`, `user_${user._id}`);
      if ((i + 1) % 2 === 0) keyboard.row();
    });

    await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  private async handleUserDetails(ctx: AdminBotContext, userId: string) {
    try {
      const user = await this.userModel.findById(userId);

      if (!user) {
        await ctx.reply(`❌ User not found: ${userId}`);
        return;
      }

      const keyboard = new InlineKeyboard()
        .text('💼 → Starter', `upgrade_${userId}_starter`)
        .text('🚀 → Pro', `upgrade_${userId}_pro`)
        .text('👑 → Elite', `upgrade_${userId}_elite`)
        .row()
        .text('+7 days', `extend_${userId}_7`)
        .text('+30 days', `extend_${userId}_30`)
        .row()
        .text(
          user.isBlocked ? '✅ Unblock' : '🚫 Block',
          user.isBlocked ? `unblock_${userId}` : `block_${userId}`,
        )
        .text('⚠️ Cancel Sub', `cancel_${userId}`);

      const trialEnd = user.subscription?.trialEndsAt
        ? new Date(user.subscription.trialEndsAt).toLocaleDateString()
        : 'N/A';

      const name = this.getUserName(user);

      await ctx.reply(
        `👤 <b>User Details</b>\n\n` +
          `<b>ID:</b> <code>${user._id}</code>\n` +
          `<b>Name:</b> ${name}\n` +
          `<b>Phone:</b> ${user.phoneNumber}\n` +
          `<b>Telegram:</b> @${user.telegramUsername || 'N/A'} (${user.telegramId})\n\n` +
          `💳 <b>Subscription</b>\n` +
          `├ Plan: ${user.subscription?.plan || 'free_trial'}\n` +
          `├ Status: ${user.subscription?.status || 'trialing'}\n` +
          `└ Trial ends: ${trialEnd}\n\n` +
          `📊 <b>Usage This Month</b>\n` +
          `├ Mock interviews: ${user.usage?.mockInterviewsThisMonth || 0}\n` +
          `├ Live minutes: ${user.usage?.liveInterviewMinutesThisMonth || 0}\n` +
          `└ CV analyses: ${user.usage?.cvAnalysesThisMonth || 0}`,
        { parse_mode: 'HTML', reply_markup: keyboard },
      );
    } catch (error) {
      this.logger.error(`Error in handleUserDetails: ${error}`);
      await ctx.reply(
        `❌ Xatolik: User ID noto'g'ri yoki tizim xatosi. \nError: ${(error as any).message}`,
      );
    }
  }

  private async handleUpgrade(
    ctx: AdminBotContext,
    userId: string,
    plan: 'starter' | 'pro' | 'elite',
  ) {
    try {
      const now = new Date();
      const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const result = await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'subscription.plan': plan,
          'subscription.status': 'active',
          'subscription.startDate': now,
          'subscription.endDate': endDate,
          'subscription.trialStartDate': null,
          'subscription.trialEndsAt': null,
        },
      });

      if (!result) {
        await ctx.reply(`❌ Failed to upgrade user: ${userId}`);
        return;
      }

      const name = this.getUserName(result);

      await ctx.reply(
        `✅ <b>User Upgraded</b>\n\n` +
          `User: ${name}\n` +
          `New plan: ${plan.toUpperCase()}\n` +
          `Valid until: ${endDate.toLocaleDateString()}`,
        { parse_mode: 'HTML' },
      );

      this.logger.log(`Admin ${ctx.session.adminId} upgraded user ${userId} to ${plan}`);
    } catch (error) {
      this.logger.error(`Error in handleUpgrade: ${error}`);
      await ctx.reply(`❌ Error: upgrade failed.`);
    }
  }

  private async handleExtend(ctx: AdminBotContext, userId: string, days: number) {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        await ctx.reply(`❌ User not found: ${userId}`);
        return;
      }

      const currentEnd = user.subscription?.endDate || user.subscription?.trialEndsAt || new Date();
      const newEnd = new Date(new Date(currentEnd).getTime() + days * 24 * 60 * 60 * 1000);

      const updateField =
        user.subscription?.plan === 'free_trial'
          ? 'subscription.trialEndsAt'
          : 'subscription.endDate';

      await this.userModel.findByIdAndUpdate(userId, {
        $set: { [updateField]: newEnd },
      });

      const name = this.getUserName(user);

      await ctx.reply(
        `✅ <b>Subscription Extended</b>\n\n` +
          `User: ${name}\n` +
          `Extended by: ${days} days\n` +
          `New end date: ${newEnd.toLocaleDateString()}`,
        { parse_mode: 'HTML' },
      );

      this.logger.log(`Admin ${ctx.session.adminId} extended user ${userId} by ${days} days`);
    } catch (error) {
      this.logger.error(`Error in handleExtend: ${error}`);
      await ctx.reply(`❌ Error: extend failed.`);
    }
  }

  private async handleCancel(ctx: AdminBotContext, userId: string) {
    try {
      const result = await this.userModel.findByIdAndUpdate(userId, {
        $set: { 'subscription.status': 'expired' },
      });

      if (!result) {
        await ctx.reply(`❌ User not found: ${userId}`);
        return;
      }

      const name = this.getUserName(result);

      await ctx.reply(
        `⚠️ <b>Subscription Cancelled</b>\n\n` + `User: ${name}\n` + `Status: Expired`,
        { parse_mode: 'HTML' },
      );

      this.logger.log(`Admin ${ctx.session.adminId} cancelled subscription for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error in handleCancel: ${error}`);
      await ctx.reply(`❌ Error: cancel failed.`);
    }
  }

  private async handleBlock(ctx: AdminBotContext, userId: string) {
    try {
      const result = await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          isBlocked: true,
          blockedAt: new Date(),
          blockedBy: ctx.session.adminId,
        },
      });

      if (!result) {
        await ctx.reply(`❌ User not found`);
        return;
      }

      const name = this.getUserName(result);
      await ctx.reply(
        `🚫 <b>User Blocked</b>\n\n` + `User: ${name}\n` + `Status: Blocked from using the bot.`,
        { parse_mode: 'HTML' },
      );
      this.logger.log(`Admin ${ctx.session.adminId} blocked user ${userId}`);
    } catch (error) {
      this.logger.error(`Error in handleBlock: ${error}`);
      await ctx.reply(`❌ Error: block failed. Invalid ID?`);
    }
  }

  private async handleUnblock(ctx: AdminBotContext, userId: string) {
    try {
      const result = await this.userModel.findByIdAndUpdate(userId, {
        $set: { isBlocked: false },
        $unset: { blockedAt: 1, blockedBy: 1 },
      });

      if (!result) {
        await ctx.reply(`❌ User not found`);
        return;
      }

      const name = this.getUserName(result);
      await ctx.reply(`✅ <b>User Unblocked</b>\n\n` + `User: ${name}\n` + `Status: Active`, {
        parse_mode: 'HTML',
      });
      this.logger.log(`Admin ${ctx.session.adminId} unblocked user ${userId}`);
    } catch (error) {
      this.logger.error(`Error in handleUnblock: ${error}`);
      await ctx.reply(`❌ Error: unblock failed.`);
    }
  }

  private async handleRecentUsers(ctx: AdminBotContext) {
    const users = await this.userModel
      .find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName phoneNumber subscription.plan createdAt');

    let message = `📋 <b>Recent Users</b>\n\n`;
    const keyboard = new InlineKeyboard();

    users.forEach((user, i) => {
      const date = new Date((user as any).createdAt).toLocaleDateString();
      const name = this.getUserName(user);
      message += `${i + 1}. ${name} | ${user.subscription?.plan || 'trial'}\n`;
      message += `   📞 ${user.phoneNumber} | ${date}\n\n`;

      keyboard.text(`${i + 1}`, `user_${user._id}`);
      if ((i + 1) % 5 === 0) keyboard.row();
    });

    await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  private async handleExpiredTrials(ctx: AdminBotContext) {
    const now = new Date();
    const users = await this.userModel
      .find({
        'subscription.plan': 'free_trial',
        'subscription.trialEndsAt': { $lt: now },
      })
      .limit(20)
      .select('firstName lastName phoneNumber subscription.trialEndsAt');

    if (users.length === 0) {
      await ctx.reply('✅ No expired trials');
      return;
    }

    let message = `⚠️ <b>Expired Trials</b> (${users.length})\n\n`;
    const keyboard = new InlineKeyboard();

    users.forEach((user, i) => {
      const name = this.getUserName(user);
      const expiredDate = user.subscription?.trialEndsAt
        ? new Date(user.subscription.trialEndsAt).toLocaleDateString()
        : 'N/A';
      message += `${i + 1}. ${name}\n`;
      message += `   📞 ${user.phoneNumber} | Expired: ${expiredDate}\n\n`;

      keyboard.text(`${i + 1}`, `user_${user._id}`);
      if ((i + 1) % 5 === 0) keyboard.row();
    });

    await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}
