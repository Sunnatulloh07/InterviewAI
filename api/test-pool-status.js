/**
 * Quick test script to verify question pool status
 * Run this on the production server where MongoDB is accessible
 * 
 * Usage: node test-pool-status.js
 */

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://interview9854:inter9986@localhost:27017/interviewai?authSource=admin';

async function checkPoolStatus() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('interviewai');
    const collection = db.collection('generated_questions');
    
    // Define all combinations to check
    const combinations = [
      { position: 'junior', types: ['technical'], domains: ['frontend', 'backend', 'mobile', 'data_science'] },
      { position: 'junior', types: ['behavioral'], domains: ['soft_skills'] },
      { position: 'mid', types: ['technical'], domains: ['frontend', 'backend', 'mobile', 'devops', 'data_science'] },
      { position: 'mid', types: ['behavioral'], domains: ['soft_skills'] },
      { position: 'mid', types: ['system_design'], domains: ['architecture'] },
      { position: 'senior', types: ['technical'], domains: ['frontend', 'backend', 'mobile', 'devops', 'data_science', 'security'] },
      { position: 'senior', types: ['behavioral'], domains: ['soft_skills'] },
      { position: 'senior', types: ['system_design'], domains: ['architecture'] },
      { position: 'lead', types: ['technical'], domains: ['frontend', 'backend', 'devops', 'security'] },
      { position: 'lead', types: ['behavioral'], domains: ['soft_skills'] },
      { position: 'lead', types: ['system_design'], domains: ['architecture'] },
    ];
    
    console.log('\n📊 Question Pool Status:\n');
    console.log('Position | Type          | Domain        | Count | Status');
    console.log('---------|---------------|---------------|-------|-------');
    
    let totalQuestions = 0;
    let healthyPools = 0;
    let warningPools = 0;
    
    for (const combo of combinations) {
      for (const type of combo.types) {
        for (const domain of combo.domains) {
          const count = await collection.countDocuments({
            position: combo.position,
            type: type,
            domain: domain,
          });
          
          totalQuestions += count;
          const status = count >= 30 ? '✅' : '⚠️';
          
          if (count >= 30) healthyPools++;
          else warningPools++;
          
          console.log(
            `${combo.position.padEnd(8)} | ${type.padEnd(13)} | ${domain.padEnd(13)} | ${count.toString().padEnd(5)} | ${status}`
          );
        }
      }
    }
    
    console.log('\n📈 Summary:');
    console.log(`Total questions: ${totalQuestions}`);
    console.log(`Healthy pools (≥30): ${healthyPools}`);
    console.log(`Warning pools (<30): ${warningPools}`);
    
    if (totalQuestions === 0) {
      console.log('\n⚠️  WARNING: Question pool is EMPTY!');
      console.log('   Run the pool refill endpoint to generate questions.');
    } else if (warningPools > 0) {
      console.log('\n⚠️  Some pools need refilling.');
    } else {
      console.log('\n✅ All pools are healthy!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkPoolStatus();
