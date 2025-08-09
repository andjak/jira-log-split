import { SettingsService } from '../services/SettingsService';
import { JiraApiService } from '../services/JiraApiService';
import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { WorklogEngine } from '../core/WorklogEngine';
import { EvenDistributionStrategy } from '../core/distribution/EvenDistributionStrategy';
import { ActivityDistributionStrategy } from '../core/distribution/ActivityDistributionStrategy';
import type { DailyContext } from '../core/app-types';

function prevMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start, end };
}

function thisMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start, end };
}

function thisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday=0
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 6));
  return { start, end };
}

function prevWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday=0
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day - 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6));
  return { start, end };
}

function deriveBaseUrlFromTab(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    console.debug('Failed to derive base URL from tab', e);
    return null;
  }
}

async function buildEngineWithSettings(baseUrl: string) {
  const settings = new SettingsService();
  const jira = new JiraApiService(baseUrl);
  const calc = new CalculationContextService(settings);
  const issues = new IssueProviderService(jira, settings);

  const strategyChoice = await settings.get('initialDistribution');
  const strategy = strategyChoice === 'activity'
    ? new ActivityDistributionStrategy<any>({ roundMinutes: 5 })
    : new EvenDistributionStrategy<any>({ roundMinutes: 5 });

  const dailyContextProvider = async (): Promise<DailyContext> => ({
    vacationHours: 0,
    meetingHours: 0,
    existingWorklogHours: 0,
    isPublicHoliday: false,
  });

  const engine = new WorklogEngine(calc, issues, strategy, dailyContextProvider);

  const defaultPeriod = await settings.get('defaultPeriod');
  let period: { start: Date; end: Date };
  switch (defaultPeriod) {
    case 'thisWeek':
      period = thisWeekRange();
      break;
    case 'prevWeek':
      period = prevWeekRange();
      break;
    case 'thisMonth':
      period = thisMonthRange();
      break;
    case 'prevMonth':
    default:
      period = prevMonthRange();
      break;
  }

  return { engine, period };
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
      } catch (e) {
        console.debug('tabs.query failed', e);
      }

      const { engine, period } = await buildEngineWithSettings(baseUrl);
      const schedule = await engine.buildSchedule(period);

      output.textContent = JSON.stringify({ period, schedule }, null, 2);
    } catch (err) {
      output.textContent = `Error: ${String(err)}`;
    }
  });
});

