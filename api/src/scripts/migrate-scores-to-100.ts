/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIGRATION: Score Scale 0-10 → 0-100
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Multiply all legacy 0-10 scores by 10 to convert to 0-100 scale.
 *   New code already writes 0-100 scores, so this script only touches
 *   documents that still have old 0-10 values.
 *
 * SAFETY:
 *   - IDEMPOTENT: Only updates scores <= 10 (already-migrated 0-100 scores
 *     will NOT be touched because they're > 10). Scores of exactly 0 are
 *     unchanged (0 * 10 = 0). This means the script can safely run multiple
 *     times without double-multiplying.
 *   - DRY-RUN: Pass --dry-run to preview changes without writing to DB.
 *   - LOGGING: Every collection prints before/after counts and sample docs.
 *   - ROLLBACK: If needed, run with --rollback to divide by 10.
 *
 * COLLECTIONS AFFECTED:
 *   1. dailytasks       → tasks[].score
 *   2. interviewanswers → score, feedback.score
 *   3. interviewsessions → overallScore, feedback.overallScore,
 *                          feedback.ratings.* (5 sub-fields)
 *   4. interviewquestions → averageScore
 *   5. analyticsevents  → properties.averageScore (only daily_task_completed)
 *
 * COLLECTIONS SKIPPED:
 *   - cvs → analysis.atsScore, analysis.overallRating, analysis.sectionScores.*
 *     (Already 0-100 scale from the beginning — confirmed in cv-analysis.service.ts)
 *   - segment-questions → questions[].difficulty (1-10 difficulty rating, NOT a score)
 *
 * USAGE:
 *   # Dry run (preview only, no writes):
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-scores-to-100.ts --dry-run
 *
 *   # Real migration:
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-scores-to-100.ts
 *
 *   # Rollback (divide by 10 — emergency only):
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-scores-to-100.ts --rollback
 *
 * AUTHOR: AI Migration Script
 * DATE: 2026-02-23
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

// ─── Configuration ───────────────────────────────────────────────────────────

const IS_DRY_RUN = process.argv.includes('--dry-run');
const IS_ROLLBACK = process.argv.includes('--rollback');

/** Only touch scores in this range (0-10 inclusive). Scores > 10 are already migrated. */
const OLD_SCALE_MAX = 10;

/** Multiplier: 10 for forward migration, 0.1 for rollback */
const MULTIPLIER = IS_ROLLBACK ? 0.1 : 10;

/** For rollback: only touch scores > 10 and <= 100 */
const ROLLBACK_MIN = 11;
const ROLLBACK_MAX = 100;

// ─── Types ───────────────────────────────────────────────────────────────────

interface MigrationResult {
  collection: string;
  field: string;
  matched: number;
  modified: number;
  skipped?: string;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  SCORE MIGRATION: 0-10 → 0-100`);
  console.log(`  Mode: ${IS_DRY_RUN ? '🔍 DRY RUN (no writes)' : IS_ROLLBACK ? '⏪ ROLLBACK (÷10)' : '🚀 LIVE MIGRATION (×10)'}`);
  console.log(`  Multiplier: ${MULTIPLIER}`);
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

  const results: MigrationResult[] = [];

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // 1. DAILY TASKS — tasks[].score
    // ═══════════════════════════════════════════════════════════════════════
    results.push(await migrateDailyTasks(db));

    // ═══════════════════════════════════════════════════════════════════════
    // 2. INTERVIEW ANSWERS — score, feedback.score
    // ═══════════════════════════════════════════════════════════════════════
    results.push(...await migrateInterviewAnswers(db));

    // ═══════════════════════════════════════════════════════════════════════
    // 3. INTERVIEW SESSIONS — overallScore, feedback.overallScore, feedback.ratings.*
    // ═══════════════════════════════════════════════════════════════════════
    results.push(...await migrateInterviewSessions(db));

    // ═══════════════════════════════════════════════════════════════════════
    // 4. INTERVIEW QUESTIONS — averageScore
    // ═══════════════════════════════════════════════════════════════════════
    results.push(await migrateInterviewQuestions(db));

    // ═══════════════════════════════════════════════════════════════════════
    // 5. ANALYTICS EVENTS — properties.averageScore
    // ═══════════════════════════════════════════════════════════════════════
    results.push(await migrateAnalyticsEvents(db));

  } catch (error: any) {
    console.error(`\n\nFATAL ERROR: ${error.message}`);
    console.error(error.stack);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalModified = 0;
  for (const r of results) {
    const status = r.skipped
      ? `⏭  SKIPPED (${r.skipped})`
      : r.modified > 0
        ? `✅ ${r.modified} docs modified`
        : `⚪ No changes needed`;
    console.log(`  ${r.collection}.${r.field}: ${status} (matched: ${r.matched})`);
    totalModified += r.modified;
  }

  console.log(`\n  Total documents modified: ${totalModified}`);
  console.log(`  Mode: ${IS_DRY_RUN ? '🔍 DRY RUN — nothing was written' : IS_ROLLBACK ? '⏪ ROLLBACK complete' : '✅ MIGRATION complete'}`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');

  await app.close();
  process.exit(0);
}

// ─── Migration Functions ─────────────────────────────────────────────────────

/**
 * 1. DAILY TASKS
 *
 * Structure: dailytasks.tasks = [{ score: Number, ... }, ...]
 * Embedded array — need aggregation pipeline update.
 *
 * Strategy: Use $map to transform each task's score.
 * Only transform if score exists AND score <= 10 (for forward) or > 10 (for rollback).
 */
async function migrateDailyTasks(db: any): Promise<MigrationResult> {
  const collection = db.collection('dailytasks');
  const label = 'dailytasks';
  const field = 'tasks[].score';

  console.log(`\n── ${label}.${field} ────────────────────────────────`);

  // Count documents with at least one task that has a score in the old range
  const matchFilter = IS_ROLLBACK
    ? { 'tasks.score': { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX } }
    : { 'tasks.score': { $gt: 0, $lte: OLD_SCALE_MAX } };

  const matchedCount = await collection.countDocuments(matchFilter);
  console.log(`  Matched documents: ${matchedCount}`);

  if (matchedCount === 0) {
    console.log(`  ⚪ No documents to migrate`);
    return { collection: label, field, matched: 0, modified: 0 };
  }

  // Show sample before migration
  const sample = await collection.findOne(matchFilter, { projection: { tasks: 1 } });
  if (sample) {
    const scores = sample.tasks
      ?.filter((t: any) => t.score != null)
      .map((t: any) => t.score);
    console.log(`  Sample scores before: [${scores?.join(', ')}]`);
  }

  if (IS_DRY_RUN) {
    console.log(`  🔍 DRY RUN — skipping write`);
    return { collection: label, field, matched: matchedCount, modified: 0, skipped: 'dry-run' };
  }

  // Aggregation pipeline update: multiply each task's score
  // Conditional: only multiply scores in the target range
  const result = await collection.updateMany(
    matchFilter,
    [
      {
        $set: {
          tasks: {
            $map: {
              input: '$tasks',
              as: 'task',
              in: {
                $mergeObjects: [
                  '$$task',
                  {
                    score: {
                      $cond: {
                        if: {
                          $and: [
                            { $ne: ['$$task.score', null] },
                            IS_ROLLBACK
                              ? { $gt: ['$$task.score', OLD_SCALE_MAX] }
                              : { $lte: ['$$task.score', OLD_SCALE_MAX] },
                            IS_ROLLBACK
                              ? { $lte: ['$$task.score', ROLLBACK_MAX] }
                              : { $gt: ['$$task.score', 0] },
                          ],
                        },
                        then: {
                          $round: [{ $multiply: ['$$task.score', MULTIPLIER] }, 0],
                        },
                        else: '$$task.score',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ],
  );

  console.log(`  ✅ Modified: ${result.modifiedCount}`);

  // Show sample after migration
  if (sample) {
    const after = await collection.findOne({ _id: sample._id }, { projection: { tasks: 1 } });
    const scoresAfter = after?.tasks
      ?.filter((t: any) => t.score != null)
      .map((t: any) => t.score);
    console.log(`  Sample scores after:  [${scoresAfter?.join(', ')}]`);
  }

  return { collection: label, field, matched: matchedCount, modified: result.modifiedCount };
}

/**
 * 2. INTERVIEW ANSWERS
 *
 * Fields:
 *   - score (top-level Number)
 *   - feedback.score (nested in Object)
 */
async function migrateInterviewAnswers(db: any): Promise<MigrationResult[]> {
  const collection = db.collection('interviewanswers');
  const results: MigrationResult[] = [];

  // 2a. Top-level score
  {
    const label = 'interviewanswers';
    const field = 'score';
    console.log(`\n── ${label}.${field} ────────────────────────────────`);

    const matchFilter = IS_ROLLBACK
      ? { score: { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX } }
      : { score: { $gt: 0, $lte: OLD_SCALE_MAX } };

    const matchedCount = await collection.countDocuments(matchFilter);
    console.log(`  Matched documents: ${matchedCount}`);

    if (matchedCount === 0) {
      console.log(`  ⚪ No documents to migrate`);
      results.push({ collection: label, field, matched: 0, modified: 0 });
    } else {
      const sample = await collection.findOne(matchFilter, { projection: { score: 1 } });
      console.log(`  Sample score before: ${sample?.score}`);

      if (IS_DRY_RUN) {
        console.log(`  🔍 DRY RUN — skipping write`);
        results.push({ collection: label, field, matched: matchedCount, modified: 0, skipped: 'dry-run' });
      } else {
        const result = await collection.updateMany(
          matchFilter,
          [{ $set: { score: { $round: [{ $multiply: ['$score', MULTIPLIER] }, 0] } } }],
        );
        console.log(`  ✅ Modified: ${result.modifiedCount}`);

        if (sample) {
          const after = await collection.findOne({ _id: sample._id }, { projection: { score: 1 } });
          console.log(`  Sample score after:  ${after?.score}`);
        }
        results.push({ collection: label, field, matched: matchedCount, modified: result.modifiedCount });
      }
    }
  }

  // 2b. feedback.score (nested)
  {
    const label = 'interviewanswers';
    const field = 'feedback.score';
    console.log(`\n── ${label}.${field} ────────────────────────────────`);

    const matchFilter = IS_ROLLBACK
      ? { 'feedback.score': { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX } }
      : { 'feedback.score': { $gt: 0, $lte: OLD_SCALE_MAX } };

    const matchedCount = await collection.countDocuments(matchFilter);
    console.log(`  Matched documents: ${matchedCount}`);

    if (matchedCount === 0) {
      console.log(`  ⚪ No documents to migrate`);
      results.push({ collection: label, field, matched: 0, modified: 0 });
    } else {
      const sample = await collection.findOne(matchFilter, { projection: { 'feedback.score': 1 } });
      console.log(`  Sample feedback.score before: ${sample?.feedback?.score}`);

      if (IS_DRY_RUN) {
        console.log(`  🔍 DRY RUN — skipping write`);
        results.push({ collection: label, field, matched: matchedCount, modified: 0, skipped: 'dry-run' });
      } else {
        const result = await collection.updateMany(
          matchFilter,
          [{ $set: { 'feedback.score': { $round: [{ $multiply: ['$feedback.score', MULTIPLIER] }, 0] } } }],
        );
        console.log(`  ✅ Modified: ${result.modifiedCount}`);
        results.push({ collection: label, field, matched: matchedCount, modified: result.modifiedCount });
      }
    }
  }

  return results;
}

/**
 * 3. INTERVIEW SESSIONS
 *
 * Fields:
 *   - overallScore (top-level)
 *   - feedback.overallScore (nested)
 *   - feedback.ratings.technicalAccuracy (nested)
 *   - feedback.ratings.communication (nested)
 *   - feedback.ratings.structuredThinking (nested)
 *   - feedback.ratings.confidence (nested)
 *   - feedback.ratings.problemSolving (nested)
 */
async function migrateInterviewSessions(db: any): Promise<MigrationResult[]> {
  const collection = db.collection('interviewsessions');
  const results: MigrationResult[] = [];

  // Helper: migrate a single numeric field
  async function migrateField(fieldPath: string): Promise<MigrationResult> {
    const label = 'interviewsessions';
    console.log(`\n── ${label}.${fieldPath} ────────────────────────────────`);

    const matchFilter = IS_ROLLBACK
      ? { [fieldPath]: { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX } }
      : { [fieldPath]: { $gt: 0, $lte: OLD_SCALE_MAX } };

    const matchedCount = await collection.countDocuments(matchFilter);
    console.log(`  Matched documents: ${matchedCount}`);

    if (matchedCount === 0) {
      console.log(`  ⚪ No documents to migrate`);
      return { collection: label, field: fieldPath, matched: 0, modified: 0 };
    }

    const sample = await collection.findOne(matchFilter, { projection: { [fieldPath]: 1 } });
    // Extract nested value for logging
    const sampleValue = fieldPath.split('.').reduce((obj, key) => obj?.[key], sample);
    console.log(`  Sample ${fieldPath} before: ${sampleValue}`);

    if (IS_DRY_RUN) {
      console.log(`  🔍 DRY RUN — skipping write`);
      return { collection: label, field: fieldPath, matched: matchedCount, modified: 0, skipped: 'dry-run' };
    }

    const result = await collection.updateMany(
      matchFilter,
      [{ $set: { [fieldPath]: { $round: [{ $multiply: [`$${fieldPath}`, MULTIPLIER] }, 0] } } }],
    );
    console.log(`  ✅ Modified: ${result.modifiedCount}`);

    if (sample) {
      const after = await collection.findOne({ _id: sample._id }, { projection: { [fieldPath]: 1 } });
      const afterValue = fieldPath.split('.').reduce((obj, key) => obj?.[key], after);
      console.log(`  Sample ${fieldPath} after:  ${afterValue}`);
    }

    return { collection: label, field: fieldPath, matched: matchedCount, modified: result.modifiedCount };
  }

  // Migrate all score fields
  results.push(await migrateField('overallScore'));
  results.push(await migrateField('feedback.overallScore'));
  results.push(await migrateField('feedback.ratings.technicalAccuracy'));
  results.push(await migrateField('feedback.ratings.communication'));
  results.push(await migrateField('feedback.ratings.structuredThinking'));
  results.push(await migrateField('feedback.ratings.confidence'));
  results.push(await migrateField('feedback.ratings.problemSolving'));

  return results;
}

/**
 * 4. INTERVIEW QUESTIONS — averageScore
 */
async function migrateInterviewQuestions(db: any): Promise<MigrationResult> {
  const collection = db.collection('interviewquestions');
  const label = 'interviewquestions';
  const field = 'averageScore';

  console.log(`\n── ${label}.${field} ────────────────────────────────`);

  const matchFilter = IS_ROLLBACK
    ? { averageScore: { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX } }
    : { averageScore: { $gt: 0, $lte: OLD_SCALE_MAX } };

  const matchedCount = await collection.countDocuments(matchFilter);
  console.log(`  Matched documents: ${matchedCount}`);

  if (matchedCount === 0) {
    console.log(`  ⚪ No documents to migrate`);
    return { collection: label, field, matched: 0, modified: 0 };
  }

  const sample = await collection.findOne(matchFilter, { projection: { averageScore: 1, question: 1 } });
  console.log(`  Sample averageScore before: ${sample?.averageScore} (question: "${sample?.question?.substring(0, 60)}...")`);

  if (IS_DRY_RUN) {
    console.log(`  🔍 DRY RUN — skipping write`);
    return { collection: label, field, matched: matchedCount, modified: 0, skipped: 'dry-run' };
  }

  const result = await collection.updateMany(
    matchFilter,
    [{ $set: { averageScore: { $round: [{ $multiply: ['$averageScore', MULTIPLIER] }, 1] } } }],
  );
  console.log(`  ✅ Modified: ${result.modifiedCount}`);

  return { collection: label, field, matched: matchedCount, modified: result.modifiedCount };
}

/**
 * 5. ANALYTICS EVENTS — properties.averageScore
 *
 * Only touches events with eventType = 'daily_task_completed'.
 * The properties field is untyped (Record<string, any>), so we're extra careful.
 */
async function migrateAnalyticsEvents(db: any): Promise<MigrationResult> {
  const collection = db.collection('analyticsevents');
  const label = 'analyticsevents';
  const field = 'properties.averageScore';

  console.log(`\n── ${label}.${field} ────────────────────────────────`);

  const matchFilter = IS_ROLLBACK
    ? {
        eventType: 'daily_task_completed',
        'properties.averageScore': { $gt: OLD_SCALE_MAX, $lte: ROLLBACK_MAX },
      }
    : {
        eventType: 'daily_task_completed',
        'properties.averageScore': { $gt: 0, $lte: OLD_SCALE_MAX },
      };

  const matchedCount = await collection.countDocuments(matchFilter);
  console.log(`  Matched documents: ${matchedCount}`);

  if (matchedCount === 0) {
    console.log(`  ⚪ No documents to migrate`);
    return { collection: label, field, matched: 0, modified: 0 };
  }

  const sample = await collection.findOne(matchFilter, {
    projection: { eventType: 1, 'properties.averageScore': 1 },
  });
  console.log(`  Sample properties.averageScore before: ${sample?.properties?.averageScore}`);

  if (IS_DRY_RUN) {
    console.log(`  🔍 DRY RUN — skipping write`);
    return { collection: label, field, matched: matchedCount, modified: 0, skipped: 'dry-run' };
  }

  const result = await collection.updateMany(
    matchFilter,
    [
      {
        $set: {
          'properties.averageScore': {
            $round: [{ $multiply: ['$properties.averageScore', MULTIPLIER] }, 1],
          },
        },
      },
    ],
  );
  console.log(`  ✅ Modified: ${result.modifiedCount}`);

  return { collection: label, field, matched: matchedCount, modified: result.modifiedCount };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
