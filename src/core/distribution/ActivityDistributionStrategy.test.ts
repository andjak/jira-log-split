import { describe, it, expect } from 'vitest';
import { ActivityDistributionStrategy } from './ActivityDistributionStrategy';

const day1 = '2023-10-02';
const day2 = '2023-10-03';

describe('ActivityDistributionStrategy', () => {
  it('splits available minutes across issues active that day, 5-min rounding', () => {
    const strategy = new ActivityDistributionStrategy<any>({ roundMinutes: 5 });
    const issues = [
      { key: 'A' },
      { key: 'B' },
      { key: 'C' },
    ];

    const availability = { [day1]: 8, [day2]: 4 };

    const perDayActive: Record<string, string[]> = {
      [day1]: ['A', 'B', 'C'],
      [day2]: ['A', 'B'],
    };

    const schedule = strategy.distribute(issues as any, availability, { perDayActive });

    // day1: 8h = 480 min / 3 => 160 each
    expect(schedule['A'][day1]).toBe(160);
    expect(schedule['B'][day1]).toBe(160);
    expect(schedule['C'][day1]).toBe(160);

    // day2: 4h = 240 min / 2 => 120 each
    expect(schedule['A'][day2]).toBe(120);
    expect(schedule['B'][day2]).toBe(120);
    expect(schedule['C'][day2] ?? 0).toBe(0);
  });
});

