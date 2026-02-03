import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UsersService } from './modules/users/users.service';
import { DailyTasksService } from './modules/tasks/daily-tasks.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

const TELEGRAM_ID = 7017999861;

async function debugUserTasks() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const usersService = app.get(UsersService);
    const dailyTasksService = app.get(DailyTasksService);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 USER INFO:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const user = await usersService.findByTelegramId(TELEGRAM_ID);
    
    if (!user) {
      console.log('❌ User not found with telegramId:', TELEGRAM_ID);
      return;
    }
    
    console.log('User ID:', (user._id as any).toString());
    console.log('Name:', user.firstName, user.lastName);
    console.log('Phone:', user.phoneNumber);
    console.log('Telegram ID:', user.telegramId);
    console.log('\n📦 Subscription:');
    console.log('  Plan:', user.subscription?.plan || 'N/A');
    console.log('  Status:', user.subscription?.status || 'N/A');
    console.log('  Start Date:', user.subscription?.startDate);
    console.log('  End Date:', user.subscription?.endDate);
    console.log('\n👤 Profile:');
    console.log('  Position:', user.profile?.position || 'N/A');
    console.log('  Goal:', user.profile?.goal || 'N/A');
    console.log('\n🚫 Blocks:');
    console.log('  isBlocked:', user.isBlocked || false);
    console.log('  isBotBlocked:', user.engagement?.isBotBlocked || false);
    
    // Check eligibility
    const now = new Date();
    const isPremium = ['starter', 'pro', 'elite'].includes(user.subscription?.plan);
    const isActive = user.subscription?.status === 'active';
    const notExpired = !user.subscription?.endDate || new Date(user.subscription.endDate) > now;
    const notBlocked = !user.isBlocked && !user.engagement?.isBotBlocked;
    
    console.log('\n✅ Eligibility Check:');
    console.log('  isPremium:', isPremium, isPremium ? '✅' : '❌');
    console.log('  isActive:', isActive, isActive ? '✅' : '❌');
    console.log('  notExpired:', notExpired, notExpired ? '✅' : '❌');
    console.log('  notBlocked:', notBlocked, notBlocked ? '✅' : '❌');
    console.log('  → ELIGIBLE:', isPremium && isActive && notExpired && notBlocked ? '✅ YES' : '❌ NO');
    
    // Get monthly stats
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 MONTHLY STATS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const stats = await dailyTasksService.getMonthlyStats((user._id as any).toString());
    console.log('Total tasks:', stats.totalTasks);
    console.log('Completed:', stats.completed);
    console.log('Failed:', stats.failed);
    console.log('AI Answered:', stats.aiAnswered);
    console.log('Average Score:', stats.averageScore);
    console.log('Current Streak:', stats.currentStreak);
    console.log('Longest Streak:', stats.longestStreak);
    console.log('Completion Rate:', stats.completionRate + '%');
    
    // Get today's task
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 TODAY\'S TASK:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const todayTashkent = dailyTasksService.getTashkentMidnightPublic();
    console.log('Tashkent midnight:', todayTashkent.toISOString());
    console.log('Current UTC time:', new Date().toISOString());
    
    const todayTask = await dailyTasksService.getTodayTasks((user._id as any).toString(), todayTashkent);
    
    if (!todayTask) {
      console.log('❌ NO TASK FOR TODAY\n');
      console.log('Possible reasons:');
      console.log('  1. Cron job hasn\'t run yet (runs at 09:00 Tashkent)');
      console.log('  2. User not eligible (check eligibility above)');
      console.log('  3. Cron job failed (check server logs)');
      console.log('\n⚠️  Current server time might be before 09:00 Tashkent');
      
      const currentHourTashkent = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours();
      console.log(`   Current hour in Tashkent: ${currentHourTashkent}:00`);
      
      if (currentHourTashkent < 9) {
        console.log('   ✅ This is expected! Tasks will be delivered at 09:00');
      } else if (currentHourTashkent >= 9 && currentHourTashkent < 11) {
        console.log('   ⚠️  Tasks should have been delivered! Check cron logs.');
      } else {
        console.log('   🔧 Verification cron should have fixed this at 11:00');
      }
    } else {
      console.log('✅ TASK EXISTS FOR TODAY\n');
      console.log('Task ID:', (todayTask._id as any).toString());
      console.log('Date:', todayTask.date);
      console.log('Status:', todayTask.status);
      console.log('Total tasks:', todayTask.tasks.length);
      console.log('\nQuestions:');
      todayTask.tasks.forEach((t, i) => {
        const status = t.completed ? '✅' : '⬜';
        const score = t.completed ? ` (${t.score}/10)` : '';
        console.log(`  ${i + 1}. [${status}] ${t.question}${score}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await app.close();
  }
}

debugUserTasks();
