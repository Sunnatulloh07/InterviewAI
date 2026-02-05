#!/bin/bash

# 🔍 DIAGNOSTIC SCRIPT FOR DAILY TASKS ISSUE
# This script checks why daily_tasks collection is empty

echo "════════════════════════════════════════════════════════════════"
echo "🔍 DAILY TASKS DIAGNOSTIC SCRIPT"
echo "════════════════════════════════════════════════════════════════"
echo ""

# MongoDB credentials
MONGO_USER="interview9854"
MONGO_PASS="inter9986"
MONGO_DB="interviewai"

echo "1️⃣ Checking paid users in database..."
echo "════════════════════════════════════════════════════════════════"
docker exec interviewai-mongodb mongosh -u $MONGO_USER -p $MONGO_PASS --authenticationDatabase admin --quiet --eval "
use $MONGO_DB;
const now = new Date();
const paidUsers = db.users.find({
  'subscription.status': 'active',
  'subscription.plan': { \$in: ['starter', 'pro', 'elite'] },
  \$or: [
    { 'subscription.endDate': { \$exists: false } },
    { 'subscription.endDate': null },
    { 'subscription.endDate': { \$gt: now } }
  ],
  isBlocked: false
}).toArray();

print('');
print('📊 PAID USERS COUNT: ' + paidUsers.length);
print('');

if (paidUsers.length > 0) {
  print('✅ Found paid users:');
  paidUsers.forEach((user, i) => {
    print('  ' + (i+1) + '. User ID: ' + user._id);
    print('     Plan: ' + (user.subscription?.plan || 'N/A'));
    print('     Status: ' + (user.subscription?.status || 'N/A'));
    print('     Telegram ID: ' + (user.telegramId || 'N/A'));
    print('     Language: ' + (user.language || user.preferences?.language || 'N/A'));
    print('     Seen Questions: ' + ((user.seenQuestionIds || []).length));
    print('');
  });
} else {
  print('❌ NO PAID USERS FOUND!');
  print('   This is why daily tasks are not being created.');
  print('   All users are on free_trial plan.');
  print('');
  print('   Total users by plan:');
  const plans = db.users.aggregate([
    { \$group: { _id: '\$subscription.plan', count: { \$sum: 1 } } }
  ]).toArray();
  plans.forEach(p => {
    print('   - ' + (p._id || 'null') + ': ' + p.count);
  });
}
"

echo ""
echo "2️⃣ Checking daily_tasks collection..."
echo "════════════════════════════════════════════════════════════════"
docker exec interviewai-mongodb mongosh -u $MONGO_USER -p $MONGO_PASS --authenticationDatabase admin --quiet --eval "
use $MONGO_DB;
const totalTasks = db.daily_tasks.countDocuments({});
print('Total daily_tasks documents: ' + totalTasks);
print('');

if (totalTasks > 0) {
  print('Latest 3 tasks:');
  const latest = db.daily_tasks.find().sort({ date: -1 }).limit(3).toArray();
  latest.forEach((task, i) => {
    print('  ' + (i+1) + '. User: ' + task.userId + ', Date: ' + task.date + ', Status: ' + task.status);
  });
} else {
  print('❌ daily_tasks collection is EMPTY!');
}
"

echo ""
echo "3️⃣ Checking generated_questions pool..."
echo "════════════════════════════════════════════════════════════════"
docker exec interviewai-mongodb mongosh -u $MONGO_USER -p $MONGO_PASS --authenticationDatabase admin --quiet --eval "
use $MONGO_DB;
const poolSize = db.generated_questions.countDocuments({});
print('Total pool questions: ' + poolSize);
print('');

if (poolSize > 0) {
  print('Questions by language:');
  const langs = db.generated_questions.aggregate([
    { \$group: { _id: '\$language', count: { \$sum: 1 } } }
  ]).toArray();
  langs.forEach(l => {
    print('  - ' + (l._id || 'null') + ': ' + l.count);
  });
  
  print('');
  print('Questions by type:');
  const types = db.generated_questions.aggregate([
    { \$group: { _id: '\$type', count: { \$sum: 1 } } }
  ]).toArray();
  types.forEach(t => {
    print('  - ' + (t._id || 'null') + ': ' + t.count);
  });
}
"

echo ""
echo "4️⃣ Checking cron job execution..."
echo "════════════════════════════════════════════════════════════════"
echo "Recent cron logs (last 50 lines):"
docker logs interviewai-api --tail 100 2>&1 | grep -E "(deliver_daily_tasks|Found.*eligible|Daily tasks)" || echo "❌ No cron logs found"

echo ""
echo "5️⃣ Checking Redis locks..."
echo "════════════════════════════════════════════════════════════════"
docker exec interviewai-redis redis-cli -a interview95redis --no-auth-warning GET cron:daily-tasks:delivery 2>&1 || echo "No active lock"

echo ""
echo "6️⃣ Checking current server time..."
echo "════════════════════════════════════════════════════════════════"
echo "Server time (UTC): $(date -u)"
echo "Server time (local): $(date)"
echo "Expected cron time: 09:00 Asia/Tashkent (04:00 UTC)"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ DIAGNOSTIC COMPLETE"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "📋 SUMMARY:"
echo "If paid users = 0: No tasks will be created (working as designed)"
echo "If paid users > 0 but tasks = 0: Check cron logs above"
echo "If cron not running: Check if it's before 09:00 Tashkent time"
echo ""
