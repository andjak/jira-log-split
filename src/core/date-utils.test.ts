import { describe, it, expect } from 'vitest';
import { clampPeriodEndToTodayUTC, endOfTodayUTC } from './date-utils';

describe('date-utils', () => {
  it('clamps period end to today end-of-day UTC when end is in the future', () => {
    const fixedNow = new Date('2025-08-14T10:00:00.000Z');
    const period = {
      start: new Date('2025-08-01T00:00:00.000Z'),
      end: new Date('2025-09-01T00:00:00.000Z'), // future
    };
    const clamped = clampPeriodEndToTodayUTC(period, fixedNow);
    expect(clamped.end.getTime()).toEqual(endOfTodayUTC(fixedNow).getTime());
    expect(clamped.start.getTime()).toEqual(period.start.getTime());
  });

  it('keeps period end unchanged when end is today or earlier', () => {
    const fixedNow = new Date('2025-08-14T10:00:00.000Z');
    const period = {
      start: new Date('2025-08-01T00:00:00.000Z'),
      end: new Date('2025-08-14T23:59:59.999Z'), // exactly today end
    };
    const clamped = clampPeriodEndToTodayUTC(period, fixedNow);
    expect(clamped.end.getTime()).toEqual(period.end.getTime());
  });
});


