/**
 * 🔍 DAILY TASKS DIAGNOSTIC SCRIPT
 * 
 * Bu script quyidagilarni tekshiradi:
 * 1. Question pool statusini
 * 2. Bugungi daily tasks'larni
 * 3. User'ning daily task'larini
 * 4. Cron job ishlagan-yo'qligini
 * 
 * Usage:
 *   node diagnose-daily-tasks.js [telegramId]
 * 
 * Example:
 *   node diagnose-daily-tasks.js 1778261703
 */

const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://interview9854:inter9986@localhost:27017/interviewai?authSource=admin';

// Get Telegram ID from command line
const targetTelegramId = process.argv[2];

async function diagnose() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db('interviewai');
    
    // ============================================================
    // 1. CHECK QUESTION POOL
    // ============================================================
    console.log('═══════════════════════════════════════════════════════');
    console.log('📦 STEP 1: Checking Question Pool');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const questionPoolCollection = db.collection('generated_questions');
    const totalQuestions = await questionPoolCollection.countDocuments();
    
    console.log(`Total questions in pool: ${totalQuestions}`);
    
    if (totalQuestions === 0) {
      console.log('❌ PROBLEM: Question pool is EMPTY!');
      console.log('   Solution: Run pool refill:');
      console.log('   curl -X POST http://localhost:3000/debug/trigger-pool-refill\n');
    } else {
      console.log('✅ Question pool has questions\n');
      
      // Show sample breakdown
      const sampleBreakdown = await questionPoolCollection.aggregate([
        { $group: { 
            _id: { position: '$position', type: '$type', domain: '$domain' },
            count: { $sum: 1 }
          }
        },
        { $limit: 10 }
      ]).toArray();
      
      console.log('Sample breakdown (first 10 combinations):');
      sampleBreakdown.forEach(item => {
        console.log(`  ${item._id.position}/${item._id.type}/${item._id.domain}: ${item.count} questions`);
      });
      console.log('');
    }
    
    // ============================================================
    // 2. CHECK USER (if Telegram ID provided)
    // ============================================================
    let user = null;
    if (targetTelegramId) {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`👤 STEP 2: Checking User (Telegram ID: ${targetTelegramId})`);
      console.log('═══════════════════════════════════════════════════════\n');
      
      const usersCollection = db.collection('users');
      user = await usersCollection.findOne({ telegramId: parseInt(targetTelegramId) });
      
      if (!user) {
        console.log(`❌ PROBLEM: User with Telegram ID ${targetTelegramId} not found!`);
        console.log('   Please check the Telegram ID is correct.\n');
      } else {
        console.log(`✅ User found: ${user.firstName || 'N/A'} ${user.lastName || ''}`);
        console.log(`   User ID: ${user._id}`);
        console.log(`   Position: ${user.profile?.position || 'N/A'}`);
        console.log(`   Language: ${user.language || 'N/A'}`);
        console.log(`   Timezone: ${user.timezone || 'N/A'}`);
        console.log(`   Subscription: ${user.subscription?.plan || 'free_trial'}`);
        console.log(`   Seen Questions: ${user.seenQuestionIds?.length || 0}`);
        console.log('');
      }
    }
    
    // ============================================================
    // 3. CHECK TODAY'S DAILY TASKS
    // ============================================================
    console.log('═══════════════════════════════════════════════════════');
    console.log('📋 STEP 3: Checking Today\'s Daily Tasks');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const dailyTasksCollection = db.collection('daily_tasks');
    
    // Get today's date in Tashkent timezone (UTC+5)
    const now = new Date();
    const tashkentOffset = 5 * 60; // +5 hours in minutes
    const localOffset = now.getTimezoneOffset(); // Local offset in minutes
    const totalOffset = tashkentOffset + localOffset;
    const tashkentNow = new Date(now.getTime() + totalOffset * 60 * 1000);
    
    const todayStart = new Date(tashkentNow);
    todayStart.setHours(0, 0, 0, 0);
    
    const todayEnd = new Date(tashkentNow);
    todayEnd.setHours(23, 59, 59, 999);
    
    console.log(`Today's date range (Tashkent time):`);
    console.log(`  Start: ${todayStart.toISOString()}`);
    console.log(`  End: ${todayEnd.toISOString()}\n`);
    
    const todayTasksCount = await dailyTasksCollection.countDocuments({
      date: { $gte: todayStart, $lte: todayEnd }
    });
    
    console.log(`Total daily tasks created today: ${todayTasksCount}`);
    
    if (todayTasksCount === 0) {
      console.log('❌ PROBLEM: NO daily tasks created today!');
      console.log('   Possible causes:');
      console.log('   1. Cron job didn\'t run (check logs: pm2 logs api | grep "deliverDailyTasks")');
      console.log('   2. Question pool is empty');
      console.log('   3. No active users to receive tasks');
      console.log('   4. Timezone issue\n');
      
      // Check last delivery
      const lastTask = await dailyTasksCollection.findOne({}, { sort: { date: -1 } });
      if (lastTask) {
        console.log(`   Last task delivery was on: ${lastTask.date}`);
      }
      console.log('');
    } else {
      console.log('✅ Daily tasks created today\n');
      
      // Show sample tasks
      const sampleTasks = await dailyTasksCollection.find({
        date: { $gte: todayStart, $lte: todayEnd }
      }).limit(3).toArray();
      
      console.log('Sample tasks (first 3):');
      sampleTasks.forEach((task, index) => {
        console.log(`  ${index + 1}. User: ${task.userId}, Tasks: ${task.tasks?.length || 0}, Status: ${task.status}`);
      });
      console.log('');
    }
    
    // ============================================================
    // 4. CHECK SPECIFIC USER'S DAILY TASKS (if user found)
    // ============================================================
    if (user) {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`📝 STEP 4: Checking User's Today's Daily Tasks`);
      console.log('═══════════════════════════════════════════════════════\n');
      
      const userTodayTask = await dailyTasksCollection.findOne({
        userId: user._id.toString(),
        date: { $gte: todayStart, $lte: todayEnd }
      });
      
      if (!userTodayTask) {
        console.log(`❌ PROBLEM: User ${targetTelegramId} has NO daily tasks today!`);
        console.log('   Possible causes:');
        console.log('   1. User was not included in cron job delivery');
        console.log('   2. User is not active (check user.deletedAt)');
        console.log('   3. User has bot blocked (check engagement.isBotBlocked)');
        console.log('   4. Timezone mismatch\n');
        
        // Check user's last task ever
        const lastUserTask = await dailyTasksCollection.findOne(
          { userId: user._id.toString() },
          { sort: { date: -1 } }
        );
        
        if (lastUserTask) {
          console.log(`   User's last task was on: ${lastUserTask.date}`);
          console.log(`   Tasks in that delivery: ${lastUserTask.tasks?.length || 0}`);
        } else {
          console.log(`   ⚠️  User has NEVER received daily tasks!`);
        }
        console.log('');
        
        // Check if user is blocked
        if (user.engagement?.isBotBlocked) {
          console.log('   ⚠️  User has blocked the bot!');
        }
        if (user.deletedAt) {
          console.log('   ⚠️  User account is deleted!');
        }
        console.log('');
        
      } else {
        console.log(`✅ User has daily tasks today!`);
        console.log(`   Task ID: ${userTodayTask._id}`);
        console.log(`   Date: ${userTodayTask.date}`);
        console.log(`   Status: ${userTodayTask.status}`);
        console.log(`   Number of tasks: ${userTodayTask.tasks?.length || 0}`);
        console.log('');
        
        if (userTodayTask.tasks && userTodayTask.tasks.length > 0) {
          console.log('   Tasks:');
          userTodayTask.tasks.forEach((task, index) => {
            console.log(`   ${index + 1}. ${task.question?.substring(0, 60)}...`);
            console.log(`      Type: ${task.type}, Domain: ${task.domain}`);
            console.log(`      Completed: ${task.completed ? 'Yes' : 'No'}`);
          });
        } else {
          console.log('   ❌ PROBLEM: Task document exists but tasks array is empty!');
        }
        console.log('');
      }
    }
    
    // ============================================================
    // 5. CHECK CRON JOB LOGS (suggestion)
    // ============================================================
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔧 STEP 5: Manual Checks Needed');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('Run these commands on the server to check cron jobs:\n');
    console.log('1. Check if daily delivery cron ran today:');
    console.log('   pm2 logs api --lines 500 | grep "deliverDailyTasks"\n');
    
    console.log('2. Check for errors during delivery:');
    console.log('   pm2 logs api --lines 500 | grep -i "error"\n');
    
    console.log('3. Manually trigger daily delivery (for testing):');
    console.log('   curl -X POST http://localhost:3000/debug/trigger-daily-tasks\n');
    
    console.log('4. Check question pool status:');
    console.log('   curl http://localhost:3000/debug/question-pool-status\n');
    
    console.log('5. Trigger pool refill if empty:');
    console.log('   curl -X POST http://localhost:3000/debug/trigger-pool-refill\n');
    
    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const issues = [];
    
    if (totalQuestions === 0) {
      issues.push('❌ Question pool is empty');
    }
    
    if (todayTasksCount === 0) {
      issues.push('❌ No daily tasks created today');
    }
    
    if (user && !await dailyTasksCollection.findOne({
      userId: user._id.toString(),
      date: { $gte: todayStart, $lte: todayEnd }
    })) {
      issues.push(`❌ User ${targetTelegramId} has no tasks today`);
    }
    
    if (issues.length === 0) {
      console.log('✅ No obvious issues found in database!');
      console.log('   The problem might be in Telegram bot logic.');
      console.log('   Check the /tasks command handler in telegram-commands.service.ts\n');
    } else {
      console.log('Issues found:');
      issues.forEach(issue => console.log(`  ${issue}`));
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }
}

// Run diagnostics
if (!targetTelegramId) {
  console.log('⚠️  No Telegram ID provided. Running general diagnostics only.\n');
  console.log('Usage: node diagnose-daily-tasks.js [telegramId]');
  console.log('Example: node diagnose-daily-tasks.js 1778261703\n');
}

diagnose();
