/**
 * Phase 3 — calendar-date regression tests.
 *
 * Financial `date` columns (transaction dates, renewals, due dates) are
 * calendar dates, not instants. These tests lock down the two failure modes
 * that caused the dashboard/AI divergence and the one-day shifts:
 *   1. a date-only value being serialized as an ISO timestamp, and
 *   2. a month window computed in the server timezone instead of IST.
 */

const {
  DEFAULT_TIME_ZONE,
  parseDateOnly,
  formatDateOnly,
  todayDateOnly,
  currentMonthParts,
  monthRange,
  currentMonthRange,
  monthLabel,
  monthRangeStrings,
} = require('../utils/dateOnly');

describe('parseDateOnly', () => {
  test('parses a calendar date as UTC midnight', () => {
    const parsed = parseDateOnly('2026-10-21');
    expect(parsed.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  test('accepts an ISO timestamp by taking the stated date portion', () => {
    expect(parseDateOnly('2026-10-21T23:45:00.000Z').toISOString())
      .toBe('2026-10-21T00:00:00.000Z');
  });

  test('accepts a Date by using its UTC calendar components', () => {
    const parsed = parseDateOnly(new Date('2026-03-01T00:00:00.000Z'));
    expect(parsed.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  test('accepts a leap day only in a leap year', () => {
    expect(parseDateOnly('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(() => parseDateOnly('2026-02-29')).toThrow(RangeError);
  });

  test('rejects impossible and malformed dates instead of rolling over', () => {
    expect(() => parseDateOnly('2026-04-31')).toThrow(RangeError);
    expect(() => parseDateOnly('2026-13-01')).toThrow(RangeError);
    expect(() => parseDateOnly('21/10/2026')).toThrow(RangeError);
    expect(() => parseDateOnly('not-a-date')).toThrow(RangeError);
  });

  test('returns null for empty input', () => {
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });
});

describe('formatDateOnly', () => {
  test('serializes a UTC-midnight Date without a time component', () => {
    expect(formatDateOnly(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-10-01');
  });

  test('does not shift a date stored late in the UTC day', () => {
    expect(formatDateOnly(new Date('2026-10-20T23:30:00.000Z'))).toBe('2026-10-20');
  });

  test('normalizes an ISO string and passes through a date-only string', () => {
    expect(formatDateOnly('2026-10-21T18:30:00.000Z')).toBe('2026-10-21');
    expect(formatDateOnly('2026-10-21')).toBe('2026-10-21');
  });

  test('returns null for empty or invalid values instead of "Invalid Date"', () => {
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly('')).toBeNull();
    expect(formatDateOnly(new Date('nope'))).toBeNull();
  });
});

describe('month windows', () => {
  test('30- and 31-day months end on their real last day', () => {
    expect(monthRange(2026, 4).end.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(monthRange(2026, 10).end.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  test('February ends on the 28th or 29th as appropriate', () => {
    expect(monthRange(2026, 2).end.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(monthRange(2024, 2).end.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  test('rejects an invalid month instead of silently rolling over', () => {
    expect(() => monthRange(2026, 0)).toThrow(RangeError);
    expect(() => monthRange(2026, 13)).toThrow(RangeError);
    expect(() => monthRange(2026, 1.5)).toThrow(RangeError);
  });

  test('currentMonthRange uses the IST calendar even when UTC is still last month', () => {
    // 2026-10-31 20:00 UTC is 2026-11-01 01:30 in Asia/Kolkata.
    const range = currentMonthRange(new Date('2026-10-31T20:00:00.000Z'), 'Asia/Kolkata');
    expect(range.year).toBe(2026);
    expect(range.month).toBe(11);
    expect(formatDateOnly(range.start)).toBe('2026-11-01');
    expect(formatDateOnly(range.end)).toBe('2026-11-30');
  });

  test('currentMonthRange rolls into the next year at the IST new year', () => {
    // 2026-12-31 20:00 UTC is 2027-01-01 01:30 in Asia/Kolkata.
    const range = currentMonthRange(new Date('2026-12-31T20:00:00.000Z'), 'Asia/Kolkata');
    expect(range.year).toBe(2027);
    expect(range.month).toBe(1);
    expect(formatDateOnly(range.start)).toBe('2027-01-01');
  });

  test('an early-UTC instant remains in the same IST month', () => {
    // 2026-01-01 00:30 UTC is 2026-01-01 06:00 in Asia/Kolkata.
    const range = currentMonthRange(new Date('2026-01-01T00:30:00.000Z'), 'Asia/Kolkata');
    expect(range.month).toBe(1);
    expect(formatDateOnly(range.end)).toBe('2026-01-31');
  });

  test('monthRangeStrings returns inclusive date-only bounds', () => {
    expect(monthRangeStrings(2026, 2)).toMatchObject({
      start: '2026-02-01',
      end: '2026-02-28',
    });
  });

  test('monthLabel is timezone-stable', () => {
    expect(monthLabel(2026, 10)).toBe('October 2026');
  });

  test('default timezone remains Asia/Kolkata', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Kolkata');
  });

  test('todayDateOnly returns a date-only string', () => {
    expect(todayDateOnly()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('currentMonthParts matches the IST month', () => {
    const parts = currentMonthParts('Asia/Kolkata');
    expect(parts.year).toBeGreaterThanOrEqual(2024);
    expect(parts.month).toBeGreaterThanOrEqual(1);
    expect(parts.month).toBeLessThanOrEqual(12);
  });
});
