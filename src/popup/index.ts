import { SettingsService } from '../services/SettingsService';
import { JiraApiService } from '../services/JiraApiService';
import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { WorklogEngine } from '../core/WorklogEngine';
import { EvenDistributionStrategy } from '../core/distribution/EvenDistributionStrategy';
import type { DailyContext } from '../core/app-types';

function prevMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start, end };
}

function deriveBaseUrlFromTab(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const output = document.getElementById('output') as HTMLPreElement | null;
  const button = document.getElementById('buildSchedule') as HTMLButtonElement | null;

  if (!button || !output) return;

  button.addEventListener('click', async () => {
    try {
      output.textContent = 'Building...';

      // Get current tab URL to infer Jira base URL
      let baseUrl = 'https://example.atlassian.net';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          const inferred = deriveBaseUrlFromTab(tab.url);
          if (inferred) baseUrl = inferred;
        }
      } catch {}

      const settings = new SettingsService();
      const jira = new JiraApiService(baseUrl);
      const calc = new CalculationContextService(settings);
      const issues = new IssueProviderService(jira, settings);
      const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });

      const dailyContextProvider = async (_date: Date): Promise<DailyContext> => ({
        vacationHours: 0,
        meetingHours: 0,
        existingWorklogHours: 0,
        isPublicHoliday: false,
      });

      const engine = new WorklogEngine(calc, issues, strategy, dailyContextProvider);
      const period = prevMonthRange();
      const schedule = await engine.buildSchedule(period);

      output.textContent = JSON.stringify(schedule, null, 2);
    } catch (err) {
      output.textContent = `Error: ${String(err)}`;
    }
  });
});

