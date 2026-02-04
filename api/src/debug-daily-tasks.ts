import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DailyTasksService } from './modules/tasks/daily-tasks.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DailyTask } from './modules/tasks/schemas/daily-task.schema';

/**
 * 🔍 ENHANCED DEBUG SCRIPT FOR DAILY TASKS
 * 
 * This script provides comprehensive diagnostics for daily tasks system:
 * 1. Shows all tasks in database (last 7 days)
 * 2. Checks Tashkent timezone calculations
 * 3. Verifies cron job should have run
 * 4. Tests getTodayTasks() function
 * 5. Shows eligibility criteria
 * 
 * Usage:
 *   npm run debug:daily-tasks
 *   OR
 *   ts-node src/debug-daily-tasks.ts
 */

async function debugDailyTasks() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 DAILY TASKS SYSTEM DIAGNOSTICS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const dailyTasksService = app.get(DailyTasksService);
    const DailyTaskModel = app.get('DailyTaskModel') as Model<DailyTask>;

    // ═══════════════════════════════════════════════════════════════════
    // 1. TIMEZONE DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════════════
    console.log('📅 TIMEZONE DIAGNOSTICS:\n');

    const now = new Date();
    const tashkentMidnight = dailyTasksService.getTashkentMidnightPublic();
    const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const tashkentHour = tashkentNow.getUTCHours();
    const tashkentMinute = tashkentNow.getUTCMinutes();

    console.log(`Current UTC time:       ${now.toISOString()}`);
    console.log(`Current Tashkent time:  ${tashkentNow.toISOString().replace('T', ' ').substring(0, 19)} (${tashkentHour}:${tashkentMinute.toString().padStart(2, '0')})`);
    console.log(`Tashkent midnight:      ${tashkentMidnight.toISOString()}`);
    console.log(`Tomorrow midnight:      ${new Date(tashkentMidnight.getTime() + 24 * 60 * 60 * 1000).toISOString()}\n`);

    // Check if cron should have run
    if (tashkentHour >= 9) {
      console.log('✅ Cron SHOULD have run (current time >= 09:00 Tashkent)');
      if (tashkentHour < 11) {
        console.log('⚠️  If no tasks exist, cron may have failed!');
      } else {
        console.log('⚠️  Verification cron (11:00) should have fixed missing tasks');
      }
    } else {
      console.log('⏰ Cron has NOT run yet (current time < 09:00 Tashkent)');
      console.log(`   Tasks will be delivered at 09:00 (in ${9 - tashkentHour} hours)`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. DATABASE TASKS - LAST 7 DAYS
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 DATABASE TASKS (Last 7 days):\n');

    const sevenDaysAgo = new Date(tashkentMidnight.getTime() - 7 * 24 * 60 * 60 * 1000);
    const allTasks = await DailyTaskModel.find({
      date: { $gte: sevenDaysAgo },
    })
      .sort({ date: -1 })
      .limit(50)
      .lean();

    if (allTasks.length === 0) {
      console.log('❌ NO TASKS FOUND in last 7 days!');
      console.log('\n🔧 POSSIBLE REASONS:');
      console.log('   1. Cron job has never run successfully');
      console.log('   2. No premium users in database');
      console.log('   3. All users are blocked or expired');
      console.log('   4. Database connection issue');
      console.log('   5. Collection name mismatch');
    } else {
      console.log(`Found ${allTasks.length} task documents:\n`);

      // Group by date
      const tasksByDate = new Map<string, any[]>();
      allTasks.forEach((task) => {
        const dateKey = new Date(task.date).toISOString().split('T')[0];
        if (!tasksByDate.has(dateKey)) {
          tasksByDate.set(dateKey, []);
        }
        tasksByDate.get(dateKey)!.push(task);
      });

      // Display grouped
      for (const [dateKey, tasks] of tasksByDate) {
        const isToday = dateKey === new Date(tashkentMidnight).toISOString().split('T')[0];
        const marker = isToday ? '📍 TODAY' : '';
        
        console.log(`📅 ${dateKey} ${marker}`);
        console.log(`   Users: ${tasks.length}`);
        
        const completed = tasks.filter((t) => t.status === 'completed').length;
        const pending = tasks.filter((t) => t.status === 'pending').length;
        const expired = tasks.filter((t) => t.status === 'expired').length;
        
        console.log(`   Status: ✅ ${completed} completed, ⏳ ${pending} pending, ❌ ${expired} expired`);

        // Show first 3 tasks as examples
        if (isToday && tasks.length > 0) {
          console.log('\n   Sample tasks:');
          tasks.slice(0, 3).forEach((task, idx) => {
            const completedCount = task.tasks.filter((t: any) => t.completed).length;
            console.log(`   ${idx + 1}. User: ${task.userId}`);
            console.log(`      Tasks: ${completedCount}/${task.tasks.length} completed`);
            console.log(`      Questions: ${task.tasks.map((t: any) => t.question.substring(0, 50) + '...').join(' | ')}`);
          });
        }
        console.log('');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. CHECK TODAY'S TASKS COUNT
    // ═══════════════════════════════════════════════════════════════════
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TODAY\'S TASKS ANALYSIS:\n');

    const tomorrow = new Date(tashkentMidnight.getTime() + 24 * 60 * 60 * 1000);
    const todayTasksCount = await DailyTaskModel.countDocuments({
      date: {
        $gte: tashkentMidnight,
        $lt: tomorrow,
      },
    });

    console.log(`Date range: ${tashkentMidnight.toISOString()} to ${tomorrow.toISOString()}`);
    console.log(`Today's tasks count: ${todayTasksCount}`);

    if (todayTasksCount === 0) {
      console.log('\n❌ NO TASKS FOR TODAY!');
      console.log('\n🔧 NEXT STEPS:');
      console.log('   1. Run manual trigger: POST /debug/trigger-daily-tasks');
      console.log('   2. Check cron logs: pm2 logs | grep "daily tasks"');
      console.log('   3. Check Redis lock: redis-cli GET cron:daily-tasks:delivery');
      console.log('   4. Check premium users count (see below)');
    } else {
      console.log(`\n✅ Tasks exist for today (${todayTasksCount} users)`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. CHECK ELIGIBLE USERS COUNT
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👥 ELIGIBLE USERS ANALYSIS:\n');

    const UserModel = app.get('UserModel') as Model<any>;
    const now2 = new Date();

    const eligibleCount = await UserModel.countDocuments({
      'subscription.status': 'active',
      'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
      $or: [
        { 'subscription.endDate': { $exists: false } },
        { 'subscription.endDate': null },
        { 'subscription.endDate': { $gt: now2 } },
      ],
      isBlocked: false,
      'engagement.isBotBlocked': { $ne: true },
    });

    console.log(`Eligible premium users: ${eligibleCount}`);

    if (eligibleCount === 0) {
      console.log('\n❌ NO ELIGIBLE USERS!');
      console.log('   This is why no tasks are being created.');
      console.log('\n🔧 FIX: Create a premium user or upgrade existing user');
    } else {
      console.log(`\n✅ ${eligibleCount} users should receive daily tasks`);
      
      if (todayTasksCount < eligibleCount) {
        console.log(`\n⚠️  WARNING: Task count (${todayTasksCount}) < Eligible users (${eligibleCount})`);
        console.log('   Some users did not receive tasks!');
        console.log('   Verification cron (11:00) should fix this.');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. SAMPLE USER CHECK
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 SAMPLE USER CHECK:\n');

    const sampleUser: any = await UserModel.findOne({
      'subscription.plan': { $in: ['starter', 'pro', 'elite'] },
    })
      .select('_id telegramId firstName subscription profile engagement')
      .lean();

    if (!sampleUser) {
      console.log('❌ No premium users found in database');
    } else {
      const userId = sampleUser._id.toString();
      console.log(`Found premium user: ${sampleUser.firstName} (ID: ${userId})`);
      console.log(`Telegram ID: ${sampleUser.telegramId}`);
      console.log(`Plan: ${sampleUser.subscription?.plan}`);
      console.log(`Status: ${sampleUser.subscription?.status}`);

      // Check if this user has today's task
      const userTask = await dailyTasksService.getTodayTasks(
        userId,
        tashkentMidnight,
      );

      if (userTask) {
        console.log('\n✅ This user HAS today\'s task');
        console.log(`   Task ID: ${(userTask as any)._id}`);
        console.log(`   Status: ${userTask.status}`);
        console.log(`   Tasks: ${userTask.tasks.length}`);
      } else {
        console.log('\n❌ This user DOES NOT have today\'s task');
        console.log('   Reason: Check eligibility or cron execution');
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ DIAGNOSTICS COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

debugDailyTasks();
