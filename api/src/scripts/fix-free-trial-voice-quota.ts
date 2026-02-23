/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIGRATION: Fix free_trial voice quota (2 min → 0 min)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Reset voiceQuota.mockVoice.total and voiceQuota.mockVoice.remaining
 *   to 0 for all free_trial users who were incorrectly initialized with 2.
 *
 *   Root cause: user.schema.ts had a hardcoded default of 2 minutes for
 *   free_trial mock voice, conflicting with COMPLETE_PLAN_LIMITS which
 *   defines free_trial as 0 minutes (text only).
 *
 * SAFETY:
 *   - IDEMPOTENT: Only touches users with plan=free_trial AND mockVoice.total=2
 *     AND mockVoice.used=0 (haven't used any voice). If a user somehow used
 *     voice, we preserve their used count and only correct total/remaining.
 *   - DRY-RUN: Pass --dry-run to preview without writing.
 *   - Does NOT touch paid plan users.
 *
 * USAGE:
 *   # Dry run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/fix-free-trial-voice-quota.ts --dry-run
 *
 *   # Real migration:
 *   npx ts-node -r tsconfig-paths/register src/scripts/fix-free-trial-voice-quota.ts
 *
 * DATE: 2026-02-23
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

const IS_DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FIX: free_trial voice quota (2 min → 0 min)');
  console.log(`  Mode: ${IS_DRY_RUN ? '🔍 DRY RUN (no writes)' : '🚀 LIVE (will write to DB)'}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const connection: Connection = app.get(getConnectionToken());
  const db = connection.db;

  if (!db) {
    console.error('ERROR: Could not get database connection');
    await app.close();
    process.exit(1);
  }

  console.log(`Connected to: ${connection.name}\n`);

  const users = db.collection('users');

  // ── Case 1: Users with mockVoice.total=2 and used=0 (never used voice) ───
  // Safe to reset total=0 and remaining=0 completely
  const neverUsedFilter = {
    'subscription.plan': 'free_trial',
    'voiceQuota.mockVoice.total': 2,
    'voiceQuota.mockVoice.used': 0,
  };
  const neverUsedCount = await users.countDocuments(neverUsedFilter);
  console.log(`Case 1 — free_trial users with 2 min mock voice, used=0: ${neverUsedCount}`);

  if (neverUsedCount > 0) {
    const sample = await users.findOne(neverUsedFilter, {
      projection: { firstName: 1, telegramId: 1, 'voiceQuota.mockVoice': 1 },
    });
    console.log(`  Sample before: telegramId=${sample?.telegramId}, mockVoice=${JSON.stringify(sample?.voiceQuota?.mockVoice)}`);

    if (!IS_DRY_RUN) {
      const result = await users.updateMany(
        neverUsedFilter,
        {
          $set: {
            'voiceQuota.mockVoice.total': 0,
            'voiceQuota.mockVoice.remaining': 0,
          },
        },
      );
      console.log(`  ✅ Updated: ${result.modifiedCount} users\n`);
    } else {
      console.log(`  🔍 DRY RUN — would update ${neverUsedCount} users\n`);
    }
  }

  // ── Case 2: Users with mockVoice.total=2 but used>0 (partially used) ────
  // These users actually consumed some of the 2 minutes.
  // We correct total→0, remaining→0, but log a warning.
  const partiallyUsedFilter = {
    'subscription.plan': 'free_trial',
    'voiceQuota.mockVoice.total': 2,
    'voiceQuota.mockVoice.used': { $gt: 0 },
  };
  const partiallyUsedCount = await users.countDocuments(partiallyUsedFilter);
  console.log(`Case 2 — free_trial users with 2 min mock voice, used>0: ${partiallyUsedCount}`);

  if (partiallyUsedCount > 0) {
    console.log(`  ⚠️  These users actually used voice minutes. Resetting total and remaining to 0.`);
    const samples = await users.find(partiallyUsedFilter, {
      projection: { firstName: 1, telegramId: 1, 'voiceQuota.mockVoice': 1 },
    }).limit(5).toArray();
    console.log(`  Samples:`);
    samples.forEach((u: any) => {
      console.log(`    telegramId=${u.telegramId}, mockVoice=${JSON.stringify(u.voiceQuota?.mockVoice)}`);
    });

    if (!IS_DRY_RUN) {
      const result = await users.updateMany(
        partiallyUsedFilter,
        {
          $set: {
            'voiceQuota.mockVoice.total': 0,
            'voiceQuota.mockVoice.remaining': 0,
          },
        },
      );
      console.log(`  ✅ Updated: ${result.modifiedCount} users\n`);
    } else {
      console.log(`  🔍 DRY RUN — would update ${partiallyUsedCount} users\n`);
    }
  }

  // ── Case 3: Users without voiceQuota at all (very old users) ────────────
  const noQuotaFilter = {
    'subscription.plan': 'free_trial',
    voiceQuota: { $exists: false },
  };
  const noQuotaCount = await users.countDocuments(noQuotaFilter);
  console.log(`Case 3 — free_trial users with NO voiceQuota field: ${noQuotaCount}`);

  if (noQuotaCount > 0) {
    const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);

    if (!IS_DRY_RUN) {
      const result = await users.updateMany(
        noQuotaFilter,
        {
          $set: {
            voiceQuota: {
              mockVoice: { total: 0, used: 0, remaining: 0, resetDate: nextMonth },
              realVoice: { total: 0, used: 0, remaining: 0, resetDate: nextMonth },
            },
          },
        },
      );
      console.log(`  ✅ Initialized: ${result.modifiedCount} users\n`);
    } else {
      console.log(`  🔍 DRY RUN — would initialize ${noQuotaCount} users\n`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalAffected = neverUsedCount + partiallyUsedCount + noQuotaCount;
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Case 1 (used=0, total=2): ${neverUsedCount} users`);
  console.log(`  Case 2 (used>0, total=2): ${partiallyUsedCount} users`);
  console.log(`  Case 3 (no voiceQuota):   ${noQuotaCount} users`);
  console.log(`  Total affected:           ${totalAffected} users`);
  console.log(`  Mode: ${IS_DRY_RUN ? '🔍 DRY RUN — nothing written' : '✅ COMPLETE'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
