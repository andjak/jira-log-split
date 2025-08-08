import { DistributionStrategy } from './DistributionStrategy';

interface StrategyOptions {
  roundMinutes: number;
}

interface Context {
  perDayActive: Record<string, string[]>; // dayISO -> issue keys active that day
}

export class ActivityDistributionStrategy<Issue extends { key: string }>
  implements DistributionStrategy<Issue>
{
  private readonly roundTo: number;

  constructor(options: StrategyOptions) {
    this.roundTo = Math.max(1, options.roundMinutes || 5);
  }

  distribute(
    issues: Issue[],
    dailyAvailabilityHours: Record<string, number>,
    context?: Context,
  ): Record<string, Record<string, number>> {
    const schedule: Record<string, Record<string, number>> = {};
    const dayOrder = Object.keys(dailyAvailabilityHours).sort();
    const perDayActive = (context?.perDayActive ?? {}) as Record<string, string[]>;

    for (const day of dayOrder) {
      const hours = dailyAvailabilityHours[day] || 0;
      let minutes = Math.max(0, Math.round(hours * 60));
      if (minutes <= 0) continue;

      const actives = (perDayActive[day] || []).filter((k) => issues.some((i) => i.key === k));
      if (actives.length === 0) continue;

      const base = this.roundDownTo(Math.floor(minutes / actives.length), this.roundTo);
      let leftover = minutes - base * actives.length;

      for (let idx = 0; idx < actives.length; idx++) {
        const key = actives[idx];
        let allocate = base;
        if (idx === actives.length - 1) allocate += leftover; // residual to last
        if (!schedule[key]) schedule[key] = {};
        schedule[key][day] = (schedule[key][day] || 0) + allocate;
      }
    }

    return schedule;
  }

  private roundDownTo(valueMinutes: number, step: number): number {
    return Math.floor(valueMinutes / step) * step;
  }
}

