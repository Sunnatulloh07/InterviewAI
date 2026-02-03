const mongoose = require('mongoose');

const MONGO_URI = 'mongodb://interview9854:inter9986@localhost:27018/interviewai?authSource=admin';
const USER_ID = '6978a3bc1d98de85b1826c2d';

async function testAggregation() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const db = mongoose.connection.db;
    const userObjectId = new mongoose.Types.ObjectId(USER_ID);
    
    // Get current month
    const now = new Date();
    const targetMonth = now.getMonth(); // 1 (February, 0-indexed)
    const targetYear = now.getFullYear(); // 2026
    
    console.log('Current month:', targetMonth + 1, '/', targetYear);
    
    // Calculate start and end dates (same logic as backend)
    const startDate = new Date(Date.UTC(targetYear, targetMonth, 1));
    startDate.setUTCHours(startDate.getUTCHours() - 5); // Tashkent offset
    
    const endDate = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999));
    endDate.setUTCHours(endDate.getUTCHours() - 5); // Tashkent offset
    
    console.log('Start date:', startDate.toISOString());
    console.log('End date:', endDate.toISOString());
    console.log();
    
    // Check raw documents first
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 RAW DOCUMENTS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const rawDocs = await db.collection('dailytasks').find({
      userId: userObjectId,
      date: { $gte: startDate, $lte: endDate }
    }).toArray();
    
    console.log(`Found ${rawDocs.length} documents for this user in this month`);
    
    if (rawDocs.length === 0) {
      console.log('❌ NO DOCUMENTS MATCH THE DATE RANGE!');
      console.log('\nPossible reasons:');
      console.log('1. Tasks created outside the date range');
      console.log('2. Timezone calculation issue');
      console.log('3. Wrong month/year');
      
      // Check what dates exist
      console.log('\n🔍 Checking ALL tasks for this user:');
      const allDocs = await db.collection('dailytasks').find({
        userId: userObjectId
      }).sort({ date: -1 }).toArray();
      
      console.log(`Total documents: ${allDocs.length}\n`);
      allDocs.forEach((doc, i) => {
        console.log(`${i+1}. Date: ${new Date(doc.date).toISOString()} | Tasks: ${doc.tasks.length} | Status: ${doc.status}`);
      });
      
    } else {
      console.log('\n✅ Documents found:\n');
      rawDocs.forEach((doc, i) => {
        const completedCount = doc.tasks.filter(t => t.completed).length;
        console.log(`${i+1}. Date: ${new Date(doc.date).toISOString()}`);
        console.log(`   Tasks: ${doc.tasks.length} | Completed: ${completedCount} | Status: ${doc.status}`);
        doc.tasks.forEach((t, j) => {
          console.log(`   ${j+1}. [${t.completed ? '✅' : '⬜'}] ${t.question.substring(0, 50)}...`);
        });
        console.log();
      });
      
      // Count total tasks
      const totalTasksCount = rawDocs.reduce((sum, doc) => sum + doc.tasks.length, 0);
      console.log(`📊 Total individual tasks: ${totalTasksCount}`);
    }
    
    // Run aggregation
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 AGGREGATION PIPELINE:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const stats = await db.collection('dailytasks').aggregate([
      {
        $match: {
          userId: userObjectId,
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $unwind: '$tasks',
      },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$tasks.completed', true] }, 1, 0],
            },
          },
          totalScore: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$tasks.completed', true] }, { $ifNull: ['$tasks.score', false] }] },
                '$tasks.score',
                0,
              ],
            },
          },
          scoredTasks: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$tasks.completed', true] }, { $ifNull: ['$tasks.score', false] }] },
                1,
                0,
              ],
            },
          },
          voiceAnswers: {
            $sum: {
              $cond: [{ $eq: ['$tasks.answerType', 'voice'] }, 1, 0],
            },
          },
          imageAnswers: {
            $sum: {
              $cond: [{ $eq: ['$tasks.answerType', 'image'] }, 1, 0],
            },
          },
        },
      },
    ]).toArray();
    
    console.log('Aggregation result:', JSON.stringify(stats, null, 2));
    
    if (stats.length === 0) {
      console.log('\n❌ AGGREGATION RETURNED EMPTY!');
      console.log('This means $match stage filtered out all documents');
    } else {
      const result = stats[0];
      console.log('\n✅ AGGREGATION SUCCESS:');
      console.log('Total tasks:', result.totalTasks);
      console.log('Completed:', result.completed);
      console.log('Failed:', result.totalTasks - result.completed);
      console.log('Voice answers:', result.voiceAnswers);
      console.log('Image answers:', result.imageAnswers);
      console.log('AI answered:', result.voiceAnswers + result.imageAnswers);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Connection closed');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testAggregation();
