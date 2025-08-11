import { SettingsService } from '../services/SettingsService';
import { JiraApiService } from '../services/JiraApiService';
import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { WorklogEngine } from '../core/WorklogEngine';
import { EvenDistributionStrategy } from '../core/distribution/EvenDistributionStrategy';
import { ActivityDistributionStrategy } from '../core/distribution/ActivityDistributionStrategy';
import { WorklogSubmissionService } from '../services/WorklogSubmissionService';
import type { DailyContext } from '../core/app-types';
import { detectJiraBaseUrl } from '../services/JiraUrlDetector';

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

// Removed unused deriveBaseUrlFromTab; URL detection is centralized in JiraUrlDetector

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

  // Ensure default issue source is 'activity' for initial load to test the new behavior
  // If the stored setting differs, override for this session start
  const issueSource = await settings.get('issueSource');
  if (issueSource !== 'activity') {
    await settings.set('issueSource', 'activity');
  }

  return { engine, period, settings, jira };
}

document.addEventListener('DOMContentLoaded', () => {
  const output = document.getElementById('output') as HTMLPreElement | null;
  const buildBtn = document.getElementById('buildSchedule') as HTMLButtonElement | null;

  if (!output) return;

  let cachedSchedule: Record<string, Record<string, number>> | null = null;
  let submission: WorklogSubmissionService | null = null;

  const ensureBaseUrl = async (): Promise<string> => detectJiraBaseUrl({ queryString: window.location.search });

  const runBuild = async () => {
    try {
      output.textContent = 'Building...';

      const baseUrl = await ensureBaseUrl();
      const { engine, period, settings, jira } = await buildEngineWithSettings(baseUrl);
      const schedule = await engine.buildSchedule(period);
      cachedSchedule = schedule;
      submission = new WorklogSubmissionService(jira);

      output.textContent = JSON.stringify({ period, schedule }, null, 2);

      // Add a Save button dynamically once we have a schedule
      const actions = document.getElementById('actions');
      if (actions && !document.getElementById('saveSchedule')) {
        const btn = document.createElement('button');
        btn.id = 'saveSchedule';
        btn.textContent = 'Save schedule';
        btn.addEventListener('click', async () => {
          if (!cachedSchedule || !submission) return;
          const hour = await settings.get('submissionStartHourUTC');
          output.textContent = 'Saving...';
          const result = await submission.submitSchedule(cachedSchedule, { startHourUTC: hour });
          output.textContent = `Saved: ${result.successes}, Failed: ${result.failures}`;
        });
        actions.appendChild(btn);
      }
    } catch (err) {
      output.textContent = `Error: ${String(err)}`;
    }
  };

  // Wire the existing button if present (dev convenience), but auto-run build on load
  if (buildBtn) {
    buildBtn.addEventListener('click', runBuild);
  }

  // Auto-run on load to behave like the dashboard view
  void runBuild();
});

