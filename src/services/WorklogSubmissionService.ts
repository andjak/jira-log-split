import type { WorklogSchedule } from '../core/app-types';
import { JiraApiService } from './JiraApiService';

interface SubmitOptions {
  startHourUTC: number; // e.g., 9 => 09:00 UTC
}

interface SubmitResult {
  successes: number;
  failures: number;
}

interface PendingItem {
  issueId: string;
  dayISO: string;
  minutes: number;
}

export class WorklogSubmissionService {
  private readonly pending: PendingItem[] = [];

  constructor(private readonly jira: JiraApiService) {}

  async submitSchedule(schedule: WorklogSchedule, options: SubmitOptions): Promise<SubmitResult> {
    let successes = 0;
    let failures = 0;

    for (const [issueId, perDay] of Object.entries(schedule)) {
      for (const [dayISO, minutes] of Object.entries(perDay)) {
        if (!minutes || minutes <= 0) continue;
        try {
          const started = this.composeStarted(dayISO, options.startHourUTC);
          await this.jira.logWork(issueId, minutes * 60, started);
          successes++;
        } catch {
          this.pending.push({ issueId, dayISO, minutes });
          failures++;
        }
      }
    }

    return { successes, failures };
  }

  async retryPending(): Promise<SubmitResult> {
    let successes = 0;
    let failures = 0;
    const remaining: PendingItem[] = [];

    for (const item of this.pending) {
      try {
        const started = this.composeStarted(item.dayISO, 9);
        await this.jira.logWork(item.issueId, item.minutes * 60, started);
        successes++;
      } catch {
        remaining.push(item);
        failures++;
      }
    }

    this.pending.length = 0;
    this.pending.push(...remaining);

    return { successes, failures };
  }

  private composeStarted(dayISO: string, hourUTC: number): Date {
    const [y, m, d] = dayISO.split('-').map((s) => parseInt(s, 10));
    return new Date(Date.UTC(y, m - 1, d, hourUTC, 0, 0));
  }
}
