const mongoose = require('mongoose');

const MONGO_URI = 'mongodb://interview9854:inter9986@localhost:27018/interviewai?authSource=admin';
const TELEGRAM_ID = 7017999861;

async function checkDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected!\n');
    
    const db = mongoose.connection.db;
    
    // Check user
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 USER INFO:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const user = await db.collection('users').findOne({ telegramId: TELEGRAM_ID });
    
    if (!user) {
      console.log('❌ User NOT FOUND with telegramId:', TELEGRAM_ID);
      await mongoose.connection.close();
      return;
    }
    
    console.log('✅ User found!');
    console.log('User ID:', user._id.toString());
    console.log('Name:', user.firstName, user.lastName || '');
    console.log('Phone:', user.phoneNumber || 'N/A');
    console.log('Telegram ID:', user.telegramId);
    
    console.log('\n📦 Subscription:');
    console.log('  Plan:', user.subscription?.plan || 'N/A');
    console.log('  Status:', user.subscription?.status || 'N/A');
    console.log('  Start:', user.subscription?.startDate || 'N/A');
    console.log('  End:', user.subscription?.endDate || 'N/A');
    
    console.log('\n👤 Profile:');
    console.log('  Position:', user.profile?.position || 'N/A');
    console.log('  Goal:', user.profile?.goal || 'N/A');
    console.log('  Tech Stack:', user.profile?.techStack?.join(', ') || 'N/A');
    
    console.log('\n🚫 Blocked Status:');
    console.log('  isBlocked:', user.isBlocked || false);
    console.log('  isBotBlocked:', user.engagement?.isBotBlocked || false);
    
    // Check eligibility
    const now = new Date();
    const isPremium = ['starter', 'pro', 'elite'].includes(user.subscription?.plan);
    const isActive = user.subscription?.status === 'active';
    const endDate = user.subscription?.endDate ? new Date(user.subscription.endDate) : null;
    const notExpired = !endDate || endDate > now;
    const notBlocked = !user.isBlocked && !user.engagement?.isBotBlocked;
    
    console.log('\n✅ Eligibility for Daily Tasks:');
    console.log('  isPremium (starter/pro/elite):', isPremium ? '✅ YES' : '❌ NO');
    console.log('  isActive:', isActive ? '✅ YES' : '❌ NO');
    console.log('  notExpired:', notExpired ? '✅ YES' : '❌ NO');
    console.log('  notBlocked:', notBlocked ? '✅ YES' : '❌ NO');
    console.log('\n  → ELIGIBLE:', (isPremium && isActive && notExpired && notBlocked) ? '✅✅✅ YES' : '❌❌❌ NO');
    
    // Check all tasks
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 ALL TASKS (Last 10):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const allTasks = await db.collection('dailytasks')
      .find({ userId: user._id })
      .sort({ date: -1 })
      .limit(10)
      .toArray();
    
    if (allTasks.length === 0) {
      console.log('❌ NO TASKS FOUND - User has NEVER received daily tasks!');
      console.log('\nThis means:');
      console.log('  - Cron job never ran for this user, OR');
      console.log('  - User became premium AFTER last cron run, OR');
      console.log('  - There is a bug in the cron job query');
    } else {
      console.log(`✅ Found ${allTasks.length} task(s):\n`);
      allTasks.forEach((task, index) => {
        const taskDate = new Date(task.date);
        const dateStr = taskDate.toISOString().split('T')[0];
        const timeStr = taskDate.toISOString().split('T')[1].split('.')[0];
        const completed = task.tasks.filter(t => t.completed).length;
        const total = task.tasks.length;
        console.log(`  ${index + 1}. ${dateStr} ${timeStr} - ${completed}/${total} completed (${task.status})`);
      });
    }
    
    // Check today's task specifically
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 TODAY\'S TASK CHECK:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Calculate Tashkent midnight
    const nowUtc = new Date();
    const tashkentTime = new Date(nowUtc.getTime() + 5 * 60 * 60 * 1000);
    tashkentTime.setUTCHours(0, 0, 0, 0);
    const todayTashkent = new Date(tashkentTime.getTime() - 5 * 60 * 60 * 1000);
    
    console.log('Current UTC:', nowUtc.toISOString());
    console.log('Tashkent midnight:', todayTashkent.toISOString());
    
    const currentHourTashkent = new Date(nowUtc.getTime() + 5 * 60 * 60 * 1000).getUTCHours();
    console.log(`Current hour in Tashkent: ${currentHourTashkent}:${new Date(nowUtc.getTime() + 5 * 60 * 60 * 1000).getUTCMinutes()}\n`);
    
    const todayTask = await db.collection('dailytasks').findOne({
      userId: user._id,
      date: todayTashkent,
    });
    
    if (!todayTask) {
      console.log('❌ NO TASK FOR TODAY!\n');
      
      if (currentHourTashkent < 9) {
        console.log('⏰ Expected behavior - it\'s before 09:00 Tashkent');
        console.log('   Tasks will be created at 09:00 Tashkent time');
      } else if (currentHourTashkent >= 9 && currentHourTashkent < 11) {
        console.log('⚠️  PROBLEM - it\'s after 09:00 but before 11:00');
        console.log('   Main cron (09:00) should have created tasks');
        console.log('   Verification cron (11:00) will try to fix this');
        console.log('\n🔧 Possible issues:');
        console.log('   1. Cron job not running (check if server is up)');
        console.log('   2. Timezone issue (cron running at wrong time)');
        console.log('   3. User query not matching (check eligibility above)');
      } else {
        console.log('🚨 CRITICAL PROBLEM - it\'s after 11:00');
        console.log('   Both main cron (09:00) AND verification cron (11:00) failed!');
        console.log('\n🔧 Action needed:');
        console.log('   1. Check server logs');
        console.log('   2. Restart server to trigger cron');
        console.log('   3. Or wait until tomorrow 09:00');
      }
    } else {
      console.log('✅ TASK EXISTS FOR TODAY!\n');
      console.log('Task ID:', todayTask._id.toString());
      console.log('Created:', todayTask.date);
      console.log('Status:', todayTask.status);
      console.log('Total tasks:', todayTask.tasks.length);
      console.log('\n📋 Questions:');
      todayTask.tasks.forEach((t, i) => {
        const status = t.completed ? '✅ Done' : '⬜ Pending';
        const score = t.completed ? ` (Score: ${t.score}/10)` : '';
        console.log(`\n  ${i + 1}. [${status}]${score}`);
        console.log(`     Q: ${t.question}`);
        if (t.answer) {
          console.log(`     A: ${t.answer.substring(0, 100)}...`);
        }
      });
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Connection closed');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  }
}

checkDatabase();
