import { DistributionStrategy } from './DistributionStrategy';

interface StrategyOptions {
  roundMinutes: number; // e.g. 5
}

export class EvenDistributionStrategy<Issue extends { key: string; fields?: { updated?: string }; userActivity?: { lastActivityAtISO?: string } }>
  implements DistributionStrategy<Issue>
{
  private readonly roundTo: number;

  constructor(options: StrategyOptions) {
    this.roundTo = Math.max(1, options.roundMinutes || 5);
  }

  distribute(
    issues: Issue[],
    dailyAvailabilityHours: Record<string, number>,
  ): Record<string, Record<string, number>> {
    const dayOrder = Object.keys(dailyAvailabilityHours).sort();
    const availabilityMinutes: Record<string, number> = Object.fromEntries(
      dayOrder.map((d) => [d, Math.max(0, Math.round((dailyAvailabilityHours[d] || 0) * 60))]),
    );

    const totalAvailable = Object.values(availabilityMinutes).reduce((a, b) => a + b, 0);
    if (totalAvailable === 0 || issues.length === 0) return {};

    // Prefer user's last activity if available; fall back to issue's updated time
    const sortedIssues = [...issues].sort((a, b) => {
      const aTs = a.userActivity?.lastActivityAtISO
        ? Date.parse(a.userActivity.lastActivityAtISO)
        : (a.fields?.updated ? Date.parse(a.fields.updated) : 0);
      const bTs = b.userActivity?.lastActivityAtISO
        ? Date.parse(b.userActivity.lastActivityAtISO)
        : (b.fields?.updated ? Date.parse(b.fields.updated) : 0);
      return aTs - bTs; // earlier first
    });

    const perIssueRaw = totalAvailable / sortedIssues.length;
    const perIssueRounded = this.roundDownTo(perIssueRaw, this.roundTo);
    let remainder = totalAvailable - perIssueRounded * sortedIssues.length;

    const schedule: Record<string, Record<string, number>> = {};

    for (const issue of sortedIssues) {
      let remainingForIssue = perIssueRounded + Math.min(remainder, this.roundTo);
      remainder -= Math.min(remainder, this.roundTo);

      for (const day of dayOrder) {
        if (remainingForIssue <= 0) break;
        const available = availabilityMinutes[day];
        if (available <= 0) continue;

        const toAllocate = Math.min(available, remainingForIssue);
        const rounded = this.roundDownTo(toAllocate, this.roundTo);
        if (rounded <= 0) continue;

        availabilityMinutes[day] -= rounded;
        remainingForIssue -= rounded;
        if (!schedule[issue.key]) schedule[issue.key] = {};
        schedule[issue.key][day] = (schedule[issue.key][day] || 0) + rounded;
      }
    }

    return schedule;
  }

  private roundDownTo(valueMinutes: number, step: number): number {
    return Math.floor(valueMinutes / step) * step;
  }
}

