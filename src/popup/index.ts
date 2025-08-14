import { SettingsService } from '../services/SettingsService';
import { JiraApiService } from '../services/JiraApiService';
import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { WorklogEngine } from '../core/WorklogEngine';
import { clampPeriodEndToTodayUTC } from '../core/date-utils';
import { EvenDistributionStrategy } from '../core/distribution/EvenDistributionStrategy';
import { ActivityDistributionStrategy } from '../core/distribution/ActivityDistributionStrategy';
import { WorklogSubmissionService } from '../services/WorklogSubmissionService';
import type { DailyContext } from '../core/app-types';
import { detectJiraBaseUrl } from '../services/JiraUrlDetector';

// Keep singletons so that caches like fetchedRanges persist across builds
let settingsSingleton: SettingsService | null = null;
let jiraSingleton: JiraApiService | null = null;
let calcSingleton: CalculationContextService | null = null;
let issueProviderSingleton: IssueProviderService | null = null;
let lastBaseUrl: string | null = null;

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
  if (!settingsSingleton) settingsSingleton = new SettingsService();

  // Recreate Jira + IssueProvider only when baseUrl changes
  if (!jiraSingleton || lastBaseUrl !== baseUrl) {
    jiraSingleton = new JiraApiService(baseUrl, settingsSingleton);
    issueProviderSingleton = new IssueProviderService(jiraSingleton, settingsSingleton);
    lastBaseUrl = baseUrl;
  } else if (!issueProviderSingleton) {
    issueProviderSingleton = new IssueProviderService(jiraSingleton, settingsSingleton);
  }

  if (!calcSingleton) calcSingleton = new CalculationContextService(settingsSingleton);

  const strategyChoice = await settingsSingleton.get('initialDistribution');
  const strategy = strategyChoice === 'activity'
    ? new ActivityDistributionStrategy<any>({ roundMinutes: 5 })
    : new EvenDistributionStrategy<any>({ roundMinutes: 5 });

  const dailyContextProvider = async (): Promise<DailyContext> => ({
    vacationHours: 0,
    meetingHours: 0,
    existingWorklogHours: 0,
    isPublicHoliday: false,
  });

  const engine = new WorklogEngine(calcSingleton, issueProviderSingleton, strategy, dailyContextProvider);

  const defaultPeriod = await settingsSingleton.get('defaultPeriod');
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
  const issueSource = await settingsSingleton.get('issueSource');
  if (issueSource !== 'activity') {
    await settingsSingleton.set('issueSource', 'activity');
  }

  return { engine, period, settings: settingsSingleton, jira: jiraSingleton };
}

document.addEventListener('DOMContentLoaded', () => {
  const output = document.getElementById('output') as HTMLPreElement | null;
  const progress = document.getElementById('progress') as HTMLPreElement | null;
  const itemsList = document.getElementById('itemsList') as HTMLUListElement | null;
  const buildBtn = document.getElementById('buildSchedule') as HTMLButtonElement | null;
  const startInput = document.getElementById('startDate') as HTMLInputElement | null;
  const endInput = document.getElementById('endDate') as HTMLInputElement | null;

  if (!output) return;

  let cachedSchedule: Record<string, Record<string, number>> | null = null;
  let submission: WorklogSubmissionService | null = null;

  const ensureBaseUrl = async (): Promise<string> => detectJiraBaseUrl({ queryString: window.location.search });

  const renderBar = (ratio: number, remainingSeconds: number | null) => {
    if (!progress) return;
    const width = 20;
    const clamped = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(clamped * width);
    const empty = width - filled;
    const bar = `[${'#'.repeat(filled)}${' '.repeat(empty)}]`;
    const rem = remainingSeconds != null ? ` remaining ${Math.max(0, Math.ceil(remainingSeconds))} s` : '';
    progress.textContent = `${bar}${rem}`;
  };

  const runBuild = async () => {
    try {
      output.textContent = 'Building...';
      // Show an initial baseline ETA (~10s for ~20k issues) until first batch arrives
      renderBar(0, 10);

      const baseUrl = await ensureBaseUrl();
      const { engine, period, settings, jira } = await buildEngineWithSettings(baseUrl);

      // If inputs provided, override period (no validation, best-effort parse)
      if (startInput && startInput.value) {
        const d = new Date(`${startInput.value}T00:00:00.000Z`);
        if (!Number.isNaN(d.getTime())) period.start = d;
      }
      if (endInput && endInput.value) {
        const d = new Date(`${endInput.value}T23:59:59.999Z`);
        if (!Number.isNaN(d.getTime())) period.end = d;
      }

      // Clamp end date to today's end-of-day UTC to avoid allocating hours in the future
      {
        const clamped = clampPeriodEndToTodayUTC(period);
        period.start = clamped.start;
        period.end = clamped.end;
      }

      // Hook into streaming for progress when available
      const pipelinedEnabled = await settings.get('pipelinedPhase2Enabled');
      if (pipelinedEnabled && issueProviderSingleton) {
        let firstBatchTs: number | null = null;

        const renderItems = (issues: any[]) => {
          if (!itemsList) return;
          // Compute items relevant to current inputs period on the fly
          const currentStart = startInput?.value ? new Date(`${startInput.value}T00:00:00.000Z`) : null;
          const currentEnd = endInput?.value ? new Date(`${endInput.value}T23:59:59.999Z`) : null;
          const filtered = Array.isArray(issues)
            ? issues.filter((it) => {
                if (!currentStart || !currentEnd) return true;
                const a = it.userActivity?.lastActivityAtISO || it.fields?.updated || it.updated;
                if (!a) return false;
                const t = Date.parse(a);
                return t >= currentStart.getTime() && t <= currentEnd.getTime();
              })
            : [];
          itemsList.innerHTML = '';
          for (const it of filtered) {
            const li = document.createElement('li');
            const typeName = it.fields?.issuetype?.name || it.issuetype?.name || '';
            const key = it.key || '';
            const summary = it.fields?.summary || it.summary || '';
            li.textContent = `${typeName} ${key} — ${summary}`;
            itemsList.appendChild(li);
          }
        };

        const onUpdate = (issues: any[]) => {
          renderItems(issues);
        };

        const onProgress = (info: { processedBatches: number; totalBatches: number; remainingBatches: number; etaSeconds: number | null }) => {
          if (firstBatchTs == null) firstBatchTs = Date.now();
          const ratio = info.totalBatches > 0 ? info.processedBatches / info.totalBatches : 0;
          const remaining = info.etaSeconds != null ? info.etaSeconds : null;
          renderBar(ratio, remaining ?? null);
        };

        await issueProviderSingleton.getIssuesByActivityStream(period, onUpdate, onProgress);
      }

      const schedule = await engine.buildSchedule(period);
      // After schedule is built, also render final items from cache (covers non-stream path)
      if (issueProviderSingleton && itemsList) {
        const currentUserId = await issueProviderSingleton.getCurrentUserAccountId();
        const cached = (issueProviderSingleton as any).computeFromCache
          ? (issueProviderSingleton as any).computeFromCache(period, currentUserId)
          : [];
        if (Array.isArray(cached) && cached.length > 0) {
          const renderItems = (issues: any[]) => {
            itemsList.innerHTML = '';
            for (const it of issues) {
              const li = document.createElement('li');
              const typeName = it.fields?.issuetype?.name || it.issuetype?.name || '';
              const key = it.key || '';
              const summary = it.fields?.summary || it.summary || '';
              li.textContent = `${typeName} ${key} — ${summary}`;
              itemsList.appendChild(li);
            }
          };
          renderItems(cached);
        }
      }
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

  // Do not auto-run on load when manual dates are available
  // Prefill inputs with sensible defaults: start = first day of current month, end = today
  if (startInput || endInput) {
    const now = new Date();
    const startDefault = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endDefault = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const d2iso = (d: Date) => d.toISOString().split('T')[0];
    if (startInput && !startInput.value) startInput.value = d2iso(startDefault);
    if (endInput && !endInput.value) endInput.value = d2iso(endDefault);
  }
});

