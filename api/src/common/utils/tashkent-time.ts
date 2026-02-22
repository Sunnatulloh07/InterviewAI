/**
 * Tashkent timezone utilities (UTC+5).
 *
 * Single source of truth for all date calculations that must align with
 * the Asia/Tashkent timezone. Centralised here so every service produces
 * identical Date values and MongoDB queries always match stored documents.
 *
 * Why not use Intl / date-fns-tz?
 *   No extra dependencies needed. UTC+5 is a fixed offset (no DST).
 */

const TASHKENT_OFFSET_MINUTES = 5 * 60; // UTC+5

/**
 * Return the start of the current day in Tashkent time, expressed as a
 * UTC Date.
 *
 * Example:
 *   UTC now  = 2026-02-05 02:30:00  → Tashkent = 2026-02-05 07:30:00
 *   Returns  = 2026-02-05 00:00:00 Tashkent = 2026-02-04 19:00:00 UTC
 *
 *   UTC now  = 2026-02-04 20:30:00  → Tashkent = 2026-02-05 01:30:00
 *   Returns  = 2026-02-05 00:00:00 Tashkent = 2026-02-04 19:00:00 UTC
 */
export function getTashkentMidnight(now: Date = new Date()): Date {
  const tashkentMs = now.getTime() + TASHKENT_OFFSET_MINUTES * 60 * 1000;
  const tashkentNow = new Date(tashkentMs);

  // Extract calendar date in Tashkent
  const year = tashkentNow.getUTCFullYear();
  const month = tashkentNow.getUTCMonth();
  const day = tashkentNow.getUTCDate();

  // Midnight in Tashkent as a UTC epoch value
  const tashkentMidnightMs = Date.UTC(year, month, day, 0, 0, 0, 0);

  // Shift back to UTC
  return new Date(tashkentMidnightMs - TASHKENT_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Return the current hour (0-23) in Tashkent local time.
 * Useful for time-of-day guards in cron handlers.
 */
export function getTashkentHour(now: Date = new Date()): number {
  return (now.getUTCHours() + 5) % 24;
}
