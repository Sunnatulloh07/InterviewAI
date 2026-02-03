const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://interview9854:inter9986@localhost:27018/interviewai?authSource=admin';
const TELEGRAM_ID = 7017999861;

async function debugUserTasks() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db('interviewai');
    
    // ================================================
    // 1. CHECK USER
    // ================================================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 USER INFO:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const user = await db.collection('users').findOne({ telegramId: TELEGRAM_ID });
    
    if (!user) {
      console.log('❌ User not found with telegramId:', TELEGRAM_ID);
      return;
    }
    
    console.log('User ID:', user._id);
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
    
    // Check if user qualifies for daily tasks
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
    
    // ================================================
    // 2. CHECK DAILY TASKS
    // ================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 DAILY TASKS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const allTasks = await db.collection('dailytasks')
      .find({ userId: user._id })
      .sort({ date: -1 })
      .limit(10)
      .toArray();
    
    console.log('Total tasks found:', allTasks.length);
    
    if (allTasks.length === 0) {
      console.log('❌ NO TASKS FOUND - User has never received daily tasks!');
    } else {
      console.log('\nRecent tasks:');
      allTasks.forEach((task, index) => {
        const dateStr = new Date(task.date).toISOString().split('T')[0];
        const completed = task.tasks.filter(t => t.completed).length;
        const total = task.tasks.length;
        console.log(`  ${index + 1}. ${dateStr} - ${completed}/${total} completed (status: ${task.status})`);
      });
    }
    
    // ================================================
    // 3. CHECK TODAY'S TASK
    // ================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 TODAY\'S TASK:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Calculate Tashkent midnight (same logic as backend)
    const nowUtc = new Date();
    const tashkentTime = new Date(nowUtc.getTime() + 5 * 60 * 60 * 1000);
    tashkentTime.setUTCHours(0, 0, 0, 0);
    const todayTashkent = new Date(tashkentTime.getTime() - 5 * 60 * 60 * 1000);
    
    console.log('Current time (UTC):', nowUtc.toISOString());
    console.log('Tashkent midnight:', todayTashkent.toISOString());
    
    const todayTask = await db.collection('dailytasks').findOne({
      userId: user._id,
      date: todayTashkent,
    });
    
    if (!todayTask) {
      console.log('❌ NO TASK FOR TODAY');
      console.log('\nPossible reasons:');
      console.log('  1. Cron job hasn\'t run yet (runs at 09:00 Tashkent)');
      console.log('  2. User not eligible (check eligibility above)');
      console.log('  3. Cron job failed (check server logs)');
    } else {
      console.log('✅ TASK EXISTS FOR TODAY');
      console.log('\nTask details:');
      console.log('  ID:', todayTask._id);
      console.log('  Date:', todayTask.date);
      console.log('  Status:', todayTask.status);
      console.log('  Total tasks:', todayTask.tasks.length);
      console.log('\nQuestions:');
      todayTask.tasks.forEach((t, i) => {
        console.log(`  ${i + 1}. [${t.completed ? '✅' : '⬜'}] ${t.question.substring(0, 60)}...`);
      });
    }
    
    // ================================================
    // 4. CHECK CRON LOGS (Redis)
    // ================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 RECOMMENDATIONS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (!todayTask && isPremium && isActive && notExpired && notBlocked) {
      console.log('⚠️  User is eligible but has no task for today!');
      console.log('\n✅ Action items:');
      console.log('  1. Check if cron job ran today at 09:00 Tashkent');
      console.log('  2. Check server logs for errors');
      console.log('  3. Manually trigger task delivery:');
      console.log('     - Restart the server to re-run cron');
      console.log('     - Or wait for verification cron at 11:00 Tashkent');
    } else if (!isPremium) {
      console.log('❌ User is not on a premium plan (starter/pro/elite)');
      console.log('   Current plan:', user.subscription?.plan || 'N/A');
    } else if (!isActive) {
      console.log('❌ Subscription is not active');
      console.log('   Current status:', user.subscription?.status || 'N/A');
    } else if (!notExpired) {
      console.log('❌ Subscription has expired');
      console.log('   End date:', user.subscription?.endDate);
    } else if (!notBlocked) {
      console.log('❌ User is blocked');
      console.log('   isBlocked:', user.isBlocked);
      console.log('   isBotBlocked:', user.engagement?.isBotBlocked);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await client.close();
    console.log('\n✅ Connection closed');
  }
}

debugUserTasks();
