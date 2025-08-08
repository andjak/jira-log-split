import { describe, it, expect } from 'vitest';
import { EvenDistributionStrategy } from './EvenDistributionStrategy';

const day1 = '2023-10-02';
const day2 = '2023-10-03';

describe('EvenDistributionStrategy', () => {
  it('distributes 16h across 2 issues, keeping continuity and days order', () => {
    const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });
    const issues = [
      { key: 'ISSUE-1', fields: { updated: '2023-09-01T00:00:00.000Z' } },
      { key: 'ISSUE-2', fields: { updated: '2023-10-01T00:00:00.000Z' } },
    ];

    const availability = { [day1]: 8, [day2]: 8 };

    const schedule = strategy.distribute(issues as any, availability);

    expect(schedule['ISSUE-1'][day1]).toBe(8 * 60);
    expect(schedule['ISSUE-1'][day2] ?? 0).toBe(0);
    expect(schedule['ISSUE-2'][day2]).toBe(8 * 60);
  });

  it('handles remainder minutes with 5-min rounding (65 min total, 2 issues)', () => {
    const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });
    const issues = [
      { key: 'A', fields: { updated: '2023-09-01T00:00:00.000Z' } },
      { key: 'B', fields: { updated: '2023-09-02T00:00:00.000Z' } },
    ];
    const availability = { [day1]: 65 / 60 };

    const schedule = strategy.distribute(issues as any, availability);

    // Expect 30 + 35 minutes
    const a = schedule['A'][day1];
    const b = schedule['B'][day1];
    expect(a + b).toBe(65);
    expect([a, b].sort((x, y) => x - y)).toEqual([30, 35]);
  });

  it('total allocated minutes equal total availability minutes', () => {
    const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });
    const issues = [
      { key: 'I1', fields: { updated: '2023-09-01T00:00:00.000Z' } },
      { key: 'I2', fields: { updated: '2023-09-02T00:00:00.000Z' } },
      { key: 'I3', fields: { updated: '2023-09-03T00:00:00.000Z' } },
    ];
    const availability = { [day1]: 7.5, [day2]: 6.25 };

    const schedule = strategy.distribute(issues as any, availability);

    const sumMinutes = Object.values(schedule).flatMap((m) => Object.values(m)).reduce((a, b) => a + b, 0);
    const totalAvail = Math.round((7.5 + 6.25) * 60);
    expect(sumMinutes).toBeLessThanOrEqual(totalAvail);

    // After rounding down to 5-min steps, never exceed availability
    const leftover = totalAvail - sumMinutes;
    expect(leftover).toBeLessThan(5);
  });
});
