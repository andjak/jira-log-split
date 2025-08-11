import { JiraIssue, JiraUser, JiraWorklog } from '../core/jira-types';
import {
  ADAPTIVE_DEFAULT_START_CONCURRENCY,
  ADAPTIVE_FALLBACK_CONCURRENCY,
  ADAPTIVE_MAX_CONCURRENCY,
  ADAPTIVE_RAMP_UP_MIN_STEP,
  ADAPTIVE_RAMP_UP_RATIO,
  ADAPTIVE_THROTTLE_BACKOFF_RATIO,
  JIRA_DEFAULT_PAGINATION_CONCURRENCY,
  JIRA_DETAILED_FETCH_BATCH_SIZE,
  JIRA_SEARCH_DESIRED_PAGE_SIZE,
} from '../core/constants';
import { SettingsService } from './SettingsService';

export class JiraApiService {
  private readonly baseUrl: string;
  private readonly JIRA_API_V2 = '/rest/api/2';
  private readonly JIRA_API_V3 = '/rest/api/3';

  constructor(baseUrl: string, private readonly settings?: SettingsService) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  public async getCurrentUser(): Promise<JiraUser> {
    return this._request<JiraUser>(`${this.JIRA_API_V3}/myself`);
  }


  /**
   * Fetches Jira issues based on a JQL query.
   * Expands the changelog to get issue activity.
   */
  public async fetchIssues(jql: string): Promise<JiraIssue[]> {
    const desiredPageSize = JIRA_SEARCH_DESIRED_PAGE_SIZE;
    const all: JiraIssue[] = [];
    // First request to discover actual page size limits and total
    const firstBody = {
      jql,
      maxResults: desiredPageSize,
      startAt: 0,
      expand: ['changelog'],
      fields: ['summary', 'issuetype', 'project', 'updated', 'comment'],
    } as const;

    const first = await this._request<{
      issues: JiraIssue[];
      total?: number;
      startAt?: number;
      maxResults?: number;
    }>(`${this.JIRA_API_V2}/search`, { method: 'POST', body: JSON.stringify(firstBody) });

    const firstIssues = first.issues || [];
    all.push(...firstIssues);

    const total = typeof first.total === 'number' ? first.total : firstIssues.length;
    const pageSize = typeof first.maxResults === 'number' ? first.maxResults : desiredPageSize;

    // If everything fit into the first page, return
    if (all.length >= total) {
      await this.persistRampedUpConcurrencyIfSaved();
      return all;
    }

    // Build the remaining page start offsets
    const starts: number[] = [];
    for (let s = pageSize; s < total; s += pageSize) starts.push(s);

    // Concurrency limit to avoid hammering Jira
    const concurrency = JIRA_DEFAULT_PAGINATION_CONCURRENCY;
    let cursor = 0;
    const results: JiraIssue[][] = [];

    const worker = async () => {
      while (cursor < starts.length) {
        const idx = cursor++;
        const startAt = starts[idx];
        const body = {
          jql,
          maxResults: pageSize,
          startAt,
          expand: ['changelog'],
          fields: ['summary', 'issuetype', 'project', 'updated', 'comment'],
        } as const;
        const data = await this._request<{ issues: JiraIssue[] }>(`${this.JIRA_API_V2}/search`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        results[idx] = data.issues || [];
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, starts.length) }, () => worker());
    try {
      await Promise.all(workers);
      await this.updateAdaptiveConcurrency(concurrency);
    } catch (err: any) {
      // If we see throttling, reduce concurrency by 25% and do a sequential retry path
      if (err?.message?.includes('429') || err?.message?.includes('503')) {
        const reduced = Math.max(1, Math.floor(concurrency * 0.75));
        await this.updateAdaptiveConcurrency(reduced);
      }
      throw err;
    }

    for (const page of results) {
      if (page && page.length) all.push(...page);
    }

    return all;
  }

  /**
   * Phase 1: Fetch minimal issue data fast (no expand, tiny fields)
   */
  public async fetchIssuesMinimal(jql: string): Promise<JiraIssue[]> {
    const desiredPageSize = JIRA_SEARCH_DESIRED_PAGE_SIZE;
    const all: JiraIssue[] = [];

    const firstBody = {
      jql,
      maxResults: desiredPageSize,
      startAt: 0,
      fields: ['summary', 'updated', 'key'],
    } as const;

    const first = await this._request<{
      issues: JiraIssue[];
      total?: number;
      startAt?: number;
      maxResults?: number;
    }>(`${this.JIRA_API_V2}/search`, { method: 'POST', body: JSON.stringify(firstBody) });

    const firstIssues = first.issues || [];
    all.push(...firstIssues);

    const total = typeof first.total === 'number' ? first.total : firstIssues.length;
    const pageSize = typeof first.maxResults === 'number' ? first.maxResults : desiredPageSize;

    if (all.length >= total) return all;

    const starts: number[] = [];
    for (let s = pageSize; s < total; s += pageSize) starts.push(s);

    const { initialConcurrency } = await this.getStartingConcurrencyInfo();
    await this.debugLog('phase-minimal-start', { initialConcurrency });
    const tasks: Array<() => Promise<JiraIssue[]>> = starts.map((startAt) => async () => {
      const body = {
        jql,
        maxResults: pageSize,
        startAt,
        fields: ['summary', 'updated', 'key'],
      } as const;
      const data = await this._request<{ issues: JiraIssue[] }>(`${this.JIRA_API_V2}/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return data.issues || [];
    });

    const { results: pages } = await this.processQueueWithAdaptiveConcurrency(tasks, initialConcurrency);
    for (const p of pages) if (p && p.length) all.push(...p);
    await this.persistRampedUpConcurrencyIfSaved();
    await this.debugLog('phase-minimal-end', { pages: pages.length });
    return all;
  }

  /**
   * Phase 2: Fetch detailed issue data for a set of keys, in batches.
   * Uses JQL key IN (...) to request batches with changelog/comments.
   */
  public async fetchIssuesDetailedByKeys(keys: string[], options?: { batchSize?: number; concurrency?: number }): Promise<JiraIssue[]> {
    if (!keys || keys.length === 0) return [];
    const batchSize = Math.max(1, options?.batchSize ?? JIRA_DETAILED_FETCH_BATCH_SIZE);
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += batchSize) batches.push(keys.slice(i, i + batchSize));

    const { initialConcurrency } = await this.getStartingConcurrencyInfo();
    const concurrency = Math.max(1, options?.concurrency ?? initialConcurrency);
    await this.debugLog('phase-detailed-start', { initialConcurrency, usedConcurrency: concurrency, batches: batches.length });

    const tasks: Array<() => Promise<JiraIssue[]>> = batches.map((chunk) => async () => {
      const jqlChunk = `key in (${chunk.map((k) => `"${k}"`).join(',')})`;
      const body = {
        jql: jqlChunk,
        maxResults: chunk.length,
        startAt: 0,
        expand: ['changelog'],
        fields: ['summary', 'issuetype', 'project', 'updated', 'comment'],
      } as const;
      const data = await this._request<{ issues: JiraIssue[] }>(`${this.JIRA_API_V2}/search`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return data.issues || [];
    });

    const { results: pages, hadThrottle, finalConcurrency } = await this.processQueueWithAdaptiveConcurrency(tasks, concurrency);
    if (hadThrottle) {
      await this.updateAdaptiveConcurrency(finalConcurrency);
    } else {
      await this.updateAdaptiveConcurrency(concurrency);
    }
    await this.debugLog('phase-detailed-end', { hadThrottle, finalConcurrency });
    const all: JiraIssue[] = [];
    for (const p of pages) if (p && p.length) all.push(...p);
    return all;
  }

  private async processQueueWithAdaptiveConcurrency<T>(taskFactories: Array<() => Promise<T>>, startConcurrency: number): Promise<{ results: T[]; finalConcurrency: number; hadThrottle: boolean }> {
    const results: T[] = new Array(taskFactories.length);
    let concurrency = Math.max(1, startConcurrency);
    const pending: number[] = taskFactories.map((_, i) => i);
    let hadThrottle = false;

    while (pending.length > 0) {
      const batch = pending.splice(0, Math.min(concurrency, pending.length));
      const outcomes = await Promise.all(
        batch.map(async (idx) => {
          try {
            const value = await taskFactories[idx]();
            return { idx, ok: true as const, value };
          } catch (err: any) {
            return { idx, ok: false as const, err };
          }
        }),
      );

      let throttled = false;
      const failed: number[] = [];
      for (const o of outcomes) {
        if (o.ok) {
          (results as any)[o.idx] = o.value;
        } else if (this.isThrottleError(o.err)) {
          throttled = true;
          failed.push(o.idx);
        } else {
          throw o.err;
        }
      }

      if (throttled) {
        hadThrottle = true;
        const reduced = Math.max(1, Math.floor(concurrency * ADAPTIVE_THROTTLE_BACKOFF_RATIO));
        const next = reduced === concurrency ? Math.max(1, concurrency - 1) : reduced;
        await this.debugLog('throttle-reduce', { from: concurrency, to: next, failed: failed.length });
        concurrency = next;
        pending.unshift(...failed);
        await this.updateAdaptiveConcurrency(concurrency);
      }
    }

    return { results, finalConcurrency: concurrency, hadThrottle };
  }

  private async debugLog(event: string, payload: any): Promise<void> {
    try {
      // Console for immediate visibility when developing
      // eslint-disable-next-line no-console
      console.info(`[AC] ${event}`, payload);
      // Persist a short history for inspection in Application > Extension storage > Local
      const host = new URL(this.baseUrl).host;
      if (typeof chrome !== 'undefined' && (chrome as any)?.storage?.local) {
        const key = 'adaptiveConcurrencyLastRun';
        const current: any = await (chrome as any).storage.local.get([key]);
        const arr: any[] = Array.isArray(current[key]) ? current[key] : [];
        arr.push({ t: Date.now(), host, event, payload });
        if (arr.length > 200) arr.splice(0, arr.length - 200);
        await (chrome as any).storage.local.set({ [key]: arr });
      }
    } catch {
      // ignore in tests / non-extension environments
    }
  }

  private isThrottleError(err: any): boolean {
    if (!err) return false;
    const msg = String(err?.message || err);
    return msg.includes('429') || msg.includes('503');
  }

  private async getStartingConcurrencyInfo(): Promise<{ initialConcurrency: number; saved?: number }> {
    try {
      if (!this.settings) return { initialConcurrency: ADAPTIVE_FALLBACK_CONCURRENCY };
      const map = await this.settings.get('adaptiveConcurrencyByHost');
      const host = new URL(this.baseUrl).host;
      const saved = map[host];
      if (saved && saved > 0) return { initialConcurrency: saved, saved };
      return { initialConcurrency: ADAPTIVE_DEFAULT_START_CONCURRENCY };
    } catch {
      return { initialConcurrency: ADAPTIVE_FALLBACK_CONCURRENCY };
    }
  }

  private async persistRampedUpConcurrencyIfSaved(): Promise<void> {
    try {
      if (!this.settings) return;
      const map = await this.settings.get('adaptiveConcurrencyByHost');
      const host = new URL(this.baseUrl).host;
      const saved = map[host];
      if (saved && saved > 0) {
        const ramped = Math.min(
          ADAPTIVE_MAX_CONCURRENCY,
          Math.max(saved + ADAPTIVE_RAMP_UP_MIN_STEP, Math.floor(saved * ADAPTIVE_RAMP_UP_RATIO)),
        );
        await this.updateAdaptiveConcurrency(ramped);
      } else {
        await this.updateAdaptiveConcurrency(ADAPTIVE_DEFAULT_START_CONCURRENCY);
      }
    } catch {
      // ignore
    }
  }

  // Removed unused helper: getAdaptiveConcurrency

  private async updateAdaptiveConcurrency(newValue: number): Promise<void> {
    try {
      if (!this.settings) return;
      const host = new URL(this.baseUrl).host;
      const map = await this.settings.get('adaptiveConcurrencyByHost');
      map[host] = Math.max(1, Math.floor(newValue));
      await this.settings.set('adaptiveConcurrencyByHost', map);
    } catch {
      // best-effort
    }
  }

  public async getExistingWorklogs(issueIds: string[], startDate: Date, endDate: Date): Promise<JiraWorklog[]> {
    // Note: The Jira REST API for worklogs is a bit complex.
    // A simple approach is to fetch worklogs for each issue individually.
    // A more advanced (but complex) approach might involve a custom JQL function if available.
    console.log('Fetching worklogs for', issueIds, startDate, endDate);
    // This will be implemented in a future step.
    return Promise.resolve([]);
  }

  public async logWork(issueId: string, timeSpentSeconds: number, started: Date): Promise<void> {
    await this._request(
      `${this.JIRA_API_V3}/issue/${encodeURIComponent(issueId)}/worklog`,
      {
        method: 'POST',
        body: JSON.stringify({
          timeSpentSeconds,
          started: started.toISOString(),
        }),
      },
    );
  }

  /**
   * A private helper method to handle all API requests.
   */
  private async _request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Use browser session cookies; MV3 extension has host_permissions for cross-origin
    const response = await fetch(url, {
      credentials: 'include',
      mode: 'cors',
      ...options,
      headers,
    });

    if (!response.ok) {
      let details = '';
      try {
        const data: any = await response.json();
        if (Array.isArray(data?.errorMessages) && data.errorMessages.length > 0) {
          details = ` - ${data.errorMessages.join('; ')}`;
        } else if (typeof data?.message === 'string') {
          details = ` - ${data.message}`;
        }
      } catch {
        try {
          const text = await response.text();
          if (text) details = ` - ${text}`;
        } catch {
          // no-op; keep details empty
        }
      }
      throw new Error(`Jira API request failed: ${response.status} ${response.statusText}${details}`);
    }

    // Handle responses with no content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }
}


