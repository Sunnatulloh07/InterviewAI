/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIGRATION: Initialize missing dailyTasks field for existing users
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   BUG-B root cause: older user documents do not have a `dailyTasks` field.
 *   The MongoDB aggregation pipeline in completeTask() does:
 *     $add: ['$dailyTasks.currentStreak', 1]
 *   When `dailyTasks` is missing/null, MongoDB evaluates null + 1 = null,
 *   so the streak is always written as null → displayed as 0.
 *
 *   This script initializes `dailyTasks` with zeroed counters for all users
 *   who are missing the field, so the $ifNull guard (added in the same fix)
 *   has correct baseline values going forward.
 *
 * SAFETY:
 *   - IDEMPOTENT: Only touches users where dailyTasks field does not exist.
 *   - DRY-RUN: Pass --dry-run to preview without writing.
 *   - Does NOT overwrite existing dailyTasks data.
 *
 * USAGE:
 *   # Dry run:
 *   npx ts-node -r tsconfig-paths/register src/scripts/fix-missing-daily-tasks-field.ts --dry-run
 *
 *   # Real migration:
 *   npx ts-node -r tsconfig-paths/register src/scripts/fix-missing-daily-tasks-field.ts
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
  console.log('  MIGRATION: Initialize missing dailyTasks field');
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

  // ── Case 1: Users with no dailyTasks field at all ─────────────────────────
  const missingFilter = { dailyTasks: { $exists: false } };
  const missingCount = await users.countDocuments(missingFilter);
  console.log(`Case 1 — Users missing dailyTasks field entirely: ${missingCount}`);

  if (missingCount > 0) {
    const sample = await users.findOne(missingFilter, {
      projection: { firstName: 1, telegramId: 1, dailyTasks: 1 },
    });
    console.log(`  Sample before: telegramId=${sample?.telegramId}, dailyTasks=${JSON.stringify(sample?.dailyTasks)}`);

    if (!IS_DRY_RUN) {
      const result = await users.updateMany(
        missingFilter,
        {
          $set: {
            dailyTasks: {
              currentStreak: 0,
              longestStreak: 0,
              totalCompleted: 0,
            },
          },
        },
      );
      console.log(`  Updated: ${result.modifiedCount} users\n`);
    } else {
      console.log(`  [DRY RUN] Would update ${missingCount} users\n`);
    }
  } else {
    console.log('  No users missing dailyTasks field.\n');
  }

  // ── Case 2: Users with dailyTasks field but null/undefined counters ────────
  const nullCounterFilter = {
    dailyTasks: { $exists: true },
    $or: [
      { 'dailyTasks.currentStreak': null },
      { 'dailyTasks.currentStreak': { $exists: false } },
    ],
  };
  const nullCount = await users.countDocuments(nullCounterFilter);
  console.log(`Case 2 — Users with dailyTasks but null currentStreak: ${nullCount}`);

  if (nullCount > 0) {
    const sample = await users.findOne(nullCounterFilter, {
      projection: { firstName: 1, telegramId: 1, dailyTasks: 1 },
    });
    console.log(`  Sample before: telegramId=${sample?.telegramId}, dailyTasks=${JSON.stringify(sample?.dailyTasks)}`);

    if (!IS_DRY_RUN) {
      const result = await users.updateMany(
        nullCounterFilter,
        {
          $set: {
            'dailyTasks.currentStreak': 0,
            'dailyTasks.longestStreak': 0,
            'dailyTasks.totalCompleted': 0,
          },
        },
      );
      console.log(`  Updated: ${result.modifiedCount} users\n`);
    } else {
      console.log(`  [DRY RUN] Would update ${nullCount} users\n`);
    }
  } else {
    console.log('  No users with null dailyTasks counters.\n');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalFixed = missingCount + nullCount;
  console.log('═══════════════════════════════════════════════════════════════');
  if (IS_DRY_RUN) {
    console.log(`  [DRY RUN] Would have fixed ${totalFixed} users total.`);
    console.log('  Run without --dry-run to apply changes.');
  } else {
    console.log(`  Migration complete. Fixed ${totalFixed} users total.`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
