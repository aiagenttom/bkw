/**
 * Timezone utility — computes UTC offset dynamically for DST-aware queries.
 *
 * Uses Intl.DateTimeFormat to determine the correct offset for any date
 * in the configured timezone (e.g. Europe/Vienna: +1 in winter, +2 in summer).
 */
import db from './db.js';

/** Get the configured timezone name (default: Europe/Vienna) */
export function getTimezone() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get();
  return row?.value || 'Europe/Vienna';
}

/**
 * Compute UTC offset in hours for a given date in the configured timezone.
 * @param {string|Date} [dateInput] - ISO date string (YYYY-MM-DD) or Date object.
 *                                    Defaults to now.
 * @returns {number} offset in hours (e.g. 1 for CET, 2 for CEST)
 */
export function getTzOffset(dateInput) {
  const tz = getTimezone();
  const date = dateInput instanceof Date
    ? dateInput
    : dateInput
      ? new Date(dateInput + 'T12:00:00Z')   // noon UTC to avoid edge-case day shifts
      : new Date();

  // Compare UTC rendering vs timezone rendering to find offset
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
  return Math.round((new Date(tzStr) - new Date(utcStr)) / 3_600_000);
}

/**
 * Get local "today" date string (YYYY-MM-DD) in the configured timezone.
 * @returns {string}
 */
export function getLocalToday() {
  const tz = getTimezone();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}
