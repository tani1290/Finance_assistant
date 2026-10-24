/**
 * Calendar-date helpers.
 *
 * FinPro stores several fields as PostgreSQL `date` columns (no time, no
 * timezone): transaction dates, renewal dates, billing dates, goal deadlines
 * and calendar events. Those values are *calendar dates*, not instants.
 *
 * Two rules keep them stable end-to-end:
 *   1. Parse `YYYY-MM-DD` into UTC midnight before handing it to Prisma. This
 *      is how Prisma represents a `date` value; `new Date('2026-10-21')` would
 *      do the same, but it silently accepts impossible dates such as
 *      `2026-02-31` and timestamps that shift the calendar day.
 *   2. Serialize back to `YYYY-MM-DD`. Returning an ISO timestamp makes a
 *      browser west of UTC render the previous day.
 *
 * Month windows are computed in the user-facing timezone (Asia/Kolkata by
 * default) and expressed as inclusive UTC date bounds, so a month always
 * includes its last calendar day regardless of the server's timezone.
 */

'use strict';

const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n) => String(n).padStart(2, '0');

function isValidYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Parse a calendar date into the UTC-midnight Date Prisma expects for a
 * `@db.Date` column.
 *
 * Accepts `YYYY-MM-DD` and ISO timestamps (the date portion is taken as the
 * calendar date the caller stated). Returns `null` for null/undefined/''.
 * Throws `RangeError` for invalid or impossible dates.
 */
function parseDateOnly(value, fieldName = 'date') {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError(`${fieldName} is not a valid date.`);
    }
    // Date instances coming from Prisma `@db.Date` are UTC midnight. Use their
    // UTC components so round-tripping is lossless.
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const raw = String(value).trim();
  const match = raw.match(DATE_ONLY_RE) || raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
  if (!match) {
    throw new RangeError(`${fieldName} must be a calendar date in YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidYmd(year, month, day)) {
    throw new RangeError(`${fieldName} is not a real calendar date.`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Serialize a `date` column (or an ISO string) as `YYYY-MM-DD`.
 * Returns null for empty input rather than an invalid string.
 */
function formatDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }

  const raw = String(value).trim();
  // DATE_ONLY_RE has three capture groups (year, month, day); the ISO fallback
  // captures the whole date. Handle them separately so `'2026-10-21'` returns
  // the full date instead of just the year.
  if (DATE_ONLY_RE.test(raw)) return raw;
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  return isoMatch ? isoMatch[1] : null;
}

/** Today's calendar date (YYYY-MM-DD) in the given timezone. */
function todayDateOnly(timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Year/month currently in effect in the given timezone. */
function currentMonthParts(timeZone = DEFAULT_TIME_ZONE) {
  const today = todayDateOnly(timeZone);
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

/**
 * Inclusive UTC date bounds for a calendar month. `end` is the last day of the
 * month at UTC midnight, which is exactly what `lte` needs for a `date` column.
 */
function monthRange(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new RangeError('monthRange requires a valid year and month (1-12).');
  }
  return {
    year: y,
    month: m,
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 0)),
  };
}

/** Month bounds for "now" in a user-facing timezone. */
function currentMonthRange(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return monthRange(Number(get('year')), Number(get('month')));
}

/** "October 2026" label without any timezone drift. */
function monthLabel(year, month) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** YYYY-MM-DD bounds for a month, suitable for API responses. */
function monthRangeStrings(year, month) {
  const range = monthRange(year, month);
  return {
    year: range.year,
    month: range.month,
    start: formatDateOnly(range.start),
    end: formatDateOnly(range.end),
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  parseDateOnly,
  formatDateOnly,
  todayDateOnly,
  currentMonthParts,
  monthRange,
  currentMonthRange,
  monthLabel,
  monthRangeStrings,
};
