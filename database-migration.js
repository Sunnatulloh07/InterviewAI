// MongoDB Migration Script for Engagement System Fixes
// Run this script to create necessary indexes and initial data

// =====================================================
// 1. Create UnregisteredUser Collection and Indexes
// =====================================================

db.createCollection('unregisteredusers', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['telegramChatId', 'language', 'registrationStatus'],
      properties: {
        telegramChatId: {
          bsonType: 'number',
          description: 'must be a number and is required'
        },
        language: {
          bsonType: 'string',
          description: 'must be a string'
        },
        registrationStatus: {
          enum: ['not_started', 'phone_entered', 'otp_sent', 'otp_failed'],
          description: 'must be a valid status'
        }
      }
    }
  }
});

// Create indexes for UnregisteredUser
db.unregisteredusers.createIndex({ telegramChatId: 1 }, { unique: true });
db.unregisteredusers.createIndex({ registrationStatus: 1 });
db.unregisteredusers.createIndex({ lastEngagementSentAt: 1 });
db.unregisteredusers.createIndex({ isBotBlocked: 1 });
db.unregisteredusers.createIndex({ createdAt: -1 });

print('UnregisteredUser collection and indexes created successfully');

// =====================================================
// 2. Create FailedNotification Collection and Indexes
// =====================================================

db.createCollection('failednotifications', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'telegramChatId', 'notificationType', 'errorMessage'],
      properties: {
        userId: {
          bsonType: 'objectId',
          description: 'must be an ObjectId and is required'
        },
        telegramChatId: {
          bsonType: 'number',
          description: 'must be a number and is required'
        },
        notificationType: {
          bsonType: 'string',
          description: 'must be a string and is required'
        },
        errorMessage: {
          bsonType: 'string',
          description: 'must be a string and is required'
        }
      }
    }
  }
});

// Create indexes for FailedNotification
db.failednotifications.createIndex({ userId: 1, notificationType: 1 });
db.failednotifications.createIndex({ nextRetryAt: 1, isPermanentlyFailed: 1 });
db.failednotifications.createIndex({ telegramChatId: 1 });
db.failednotifications.createIndex({ createdAt: -1 });
db.failednotifications.createIndex({ isPermanentlyFailed: 1, updatedAt: 1 });

print('FailedNotification collection and indexes created successfully');

// =====================================================
// 3. Update User Collection - Add New Fields
// =====================================================

// Add trialExpiredNotifiedAt field
// First check if field exists
const hasTrialExpiredField = db.users.findOne({ trialExpiredNotifiedAt: { $exists: true } });
if (!hasTrialExpiredField) {
  db.users.updateMany(
    { trialExpiredNotifiedAt: { $exists: false } },
    { $set: { trialExpiredNotifiedAt: null } }
  );
  print('Added trialExpiredNotifiedAt field to users');
} else {
  print('trialExpiredNotifiedAt field already exists');
}

// Add limitExhaustedNotifiedAt field
const hasLimitExhaustedField = db.users.findOne({ limitExhaustedNotifiedAt: { $exists: true } });
if (!hasLimitExhaustedField) {
  db.users.updateMany(
    { limitExhaustedNotifiedAt: { $exists: false } },
    { $set: { limitExhaustedNotifiedAt: null } }
  );
  print('Added limitExhaustedNotifiedAt field to users');
} else {
  print('limitExhaustedNotifiedAt field already exists');
}

// =====================================================
// 4. Create Additional Indexes for User Collection
// =====================================================

// Index for trial expired queries
db.users.createIndex(
  { 
    'subscription.plan': 1, 
    'subscription.trialEndsAt': 1,
    trialExpiredNotifiedAt: 1
  },
  { 
    name: 'idx_trial_expired_queries',
    background: true 
  }
);

// Index for limit exhausted queries
db.users.createIndex(
  { 
    'subscription.plan': 1, 
    'usage.mockInterviewsThisMonth': 1,
    'voiceQuota.mockVoice.remaining': 1,
    limitExhaustedNotifiedAt: 1
  },
  { 
    name: 'idx_limit_exhausted_queries',
    background: true 
  }
);

// Index for combined engagement queries
db.users.createIndex(
  { 
    'engagement.isBotBlocked': 1, 
    'engagement.notificationsPaused': 1,
    'subscription.plan': 1,
    'subscription.status': 1
  },
  { 
    name: 'idx_engagement_filtered_queries',
    background: true 
  }
);

print('Additional user indexes created successfully');

// =====================================================
// 5. Verify Collections and Indexes
// =====================================================

print('\n=== Verification Results ===');

// List all collections
print('\nCollections:');
db.getCollectionNames().forEach(function(collection) {
  print('  - ' + collection);
});

// Verify UnregisteredUser indexes
print('\nUnregisteredUser Indexes:');
db.unregisteredusers.getIndexes().forEach(function(index) {
  print('  - ' + index.name + ': ' + JSON.stringify(index.key));
});

// Verify FailedNotification indexes
print('\nFailedNotification Indexes:');
db.failednotifications.getIndexes().forEach(function(index) {
  print('  - ' + index.name + ': ' + JSON.stringify(index.key));
});

// Verify User collection has new fields
print('\nUser Collection Sample:');
const sampleUser = db.users.findOne({}, { 
  trialExpiredNotifiedAt: 1, 
  limitExhaustedNotifiedAt: 1,
  subscription: 1 
});
if (sampleUser) {
  print('  Has trialExpiredNotifiedAt: ' + (sampleUser.trialExpiredNotifiedAt !== undefined));
  print('  Has limitExhaustedNotifiedAt: ' + (sampleUser.limitExhaustedNotifiedAt !== undefined));
}

print('\n=== Migration Completed Successfully ===');

// =====================================================
// 6. Optional: Create Initial Stats
// =====================================================

// Count users by subscription plan
print('\nUser Statistics:');
const planStats = db.users.aggregate([
  { $group: { _id: '$subscription.plan', count: { $sum: 1 } } }
]).toArray();
planStats.forEach(function(stat) {
  print('  ' + stat._id + ': ' + stat.count);
});

// Count trial expired users
const expiredCount = db.users.countDocuments({
  'subscription.plan': 'free_trial',
  'subscription.trialEndsAt': { $lt: new Date() }
});
print('  Trial expired users: ' + expiredCount);

// Count limit exhausted users
const mockExhausted = db.users.countDocuments({
  'subscription.plan': 'free_trial',
  'usage.mockInterviewsThisMonth': { $gte: 5 }
});
print('  Mock interviews exhausted: ' + mockExhausted);

const voiceExhausted = db.users.countDocuments({
  'subscription.plan': 'free_trial',
  'voiceQuota.mockVoice.remaining': 0
});
print('  Voice quota exhausted: ' + voiceExhausted);

print('\nReady for deployment!');
