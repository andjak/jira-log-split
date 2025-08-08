import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { DistributionStrategy } from './distribution/DistributionStrategy';
import type { DailyContext } from './app-types';

interface Period {
  start: Date;
  end: Date;
}

export class WorklogEngine<Issue extends { key: string }> {
  constructor(
    private readonly calculationContext: CalculationContextService,
    private readonly issueProvider: IssueProviderService,
    private readonly strategy: DistributionStrategy<Issue>,
    private readonly dailyContextProvider: (date: Date) => Promise<DailyContext>,
  ) {}

  public async buildSchedule(period: Period): Promise<Record<string, Record<string, number>>> {
    const days = this.enumerateDays(period.start, period.end);

    // Build availability map in hours per day
    const availabilityHours: Record<string, number> = {};
    for (const day of days) {
      const ctx = await this.dailyContextProvider(day);
      availabilityHours[this.iso(day)] = await this.calculationContext.getAvailableHours(day, ctx);
    }

    // Fetch issues
    const issues = (await this.issueProvider.getIssues(period)) as unknown as Issue[];

    // Apply distribution strategy
    return this.strategy.distribute(issues, availabilityHours);
  }

  private enumerateDays(start: Date, end: Date): Date[] {
    const days: Date[] = [];
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    // Inclusive of start and end
    while (d.getTime() <= last.getTime()) {
      days.push(new Date(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return days;
  }

  private iso(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

