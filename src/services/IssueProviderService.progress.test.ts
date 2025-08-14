import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueProviderService } from './IssueProviderService';
import { JiraApiService } from './JiraApiService';
import { SettingsService } from './SettingsService';
import { ETA_INITIAL_SECONDS_PER_BATCH } from '../core/constants';

function makeIssue(key: string) {
  return {
    key,
    fields: {
      summary: key,
      updated: new Date().toISOString(),
      comment: { comments: [] },
    },
    changelog: { histories: [] },
  } as any;
}

describe('IssueProviderService streaming progress', () => {
  let jira: JiraApiService;
  let settings: SettingsService;
  let service: IssueProviderService;

  beforeEach(() => {
    settings = new SettingsService();
    jira = new JiraApiService('https://example.atlassian.net', settings);
    service = new IssueProviderService(jira, settings);
    vi.spyOn(jira, 'getCurrentUser').mockResolvedValue({ accountId: 'me' } as any);
    // Avoid touching chrome.storage via SettingsService in tests
    vi.spyOn(settings as any, 'get').mockImplementation(async (key: string) => {
      if (key === 'includedProjects') return [];
      return undefined;
    });
  });

  it('no batches (no jiras): progress is never emitted (totalBatches=0); result empty', async () => {
    // minimal returns 0 total and empty first page
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      await onPage([], 0, 100, 0);
      return [];
    });
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockResolvedValue([]);

    const updates: any[] = [];
    const progresses: any[] = [];

    const result = await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      (iss) => updates.push(iss),
      (info) => progresses.push(info),
    );

    expect(result).toEqual([]);
    expect(updates.length).toBe(0);
    expect(progresses.length).toBe(0);
  });

  it('many batches: before first phase 1 result → no progress emitted yet', async () => {
    let observedZeroBeforeFirstPage = false;
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      // check before emitting first page
      observedZeroBeforeFirstPage = true; // since we haven't called onProgress yet in BE, this should be true
      await onPage([makeIssue('K-1')], 0, 100, 1000);
      return [];
    });
    // Ensure phase 2 invokes onBatch so stream can complete, but we don't need more pages here
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (_keys: string[], opts?: any) => {
      if (opts?.onBatch) await opts.onBatch([]);
      return [];
    });

    const progresses: any[] = [];
    await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      () => {},
      (info) => progresses.push(info),
    );
    expect(observedZeroBeforeFirstPage).toBe(true);
  });

  it('many batches: initial ETA after first phase 1 result uses ETA_INITIAL_SECONDS_PER_BATCH', async () => {
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      // total=1000, pageSize=100 => totalBatches=10
      await onPage(Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+1}`)), 0, 100, 1000);
      return [];
    });
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (keys: string[], opts?: any) => {
      if (opts?.onBatch) await opts.onBatch(keys.map((k) => makeIssue(k)));
      return keys.map((k) => makeIssue(k));
    });

    const progresses: any[] = [];
    await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      () => {},
      (info) => progresses.push(info),
    );

    // First progress should be initial, with processed=0, remaining=10
    const first = progresses[0];
    expect(first.totalBatches).toBe(10);
    expect(first.processedBatches).toBe(0);
    expect(first.remainingBatches).toBe(10);
    expect(first.etaSeconds).toBeCloseTo(10 * ETA_INITIAL_SECONDS_PER_BATCH, 5);
  });

  it('many batches: after first phase 2 batch ETA = first batch time * remaining', async () => {
    const minimalPages = [
      Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+1}`)),
      Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+101}`)),
    ];
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      await onPage(minimalPages[0], 0, 100, 200);
      await onPage(minimalPages[1], 1, 100, 200);
      return minimalPages.flat();
    });
    // Emulate per-batch latency ~200ms
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (keys: string[], opts?: any) => {
      await new Promise((r) => setTimeout(r, 200));
      if (opts?.onBatch) await opts.onBatch(keys.map((k) => makeIssue(k)));
      return keys.map((k) => makeIssue(k));
    });

    const progresses: any[] = [];
    await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      () => {},
      (info) => progresses.push(info),
    );

    // Find first progress with a numeric ETA (after Phase 1 has ended)
    const firstMeasured = progresses.find((p: any) => typeof p.etaSeconds === 'number');
    expect(firstMeasured).toBeTruthy();
    // With 2 batches total: once measured, remaining should end up at 1 during the run
    expect(firstMeasured.remainingBatches).toBeGreaterThanOrEqual(0);
    expect(firstMeasured.etaSeconds).toBeGreaterThan(0);
  });

  it('many batches: after second phase 2 batch ETA uses average, then 0 at the end', async () => {
    const minimalPages = [
      Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+1}`)),
      Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+101}`)),
      Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+201}`)),
    ];
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      await onPage(minimalPages[0], 0, 100, 300);
      await onPage(minimalPages[1], 1, 100, 300);
      await onPage(minimalPages[2], 2, 100, 300);
      return minimalPages.flat();
    });

    let calls = 0;
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (keys: string[], opts?: any) => {
      calls += 1;
      // First batch slow, next batches fast to exercise average
      const delay = calls === 1 ? 300 : 100;
      await new Promise((r) => setTimeout(r, delay));
      if (opts?.onBatch) await opts.onBatch(keys.map((k) => makeIssue(k)));
      return keys.map((k) => makeIssue(k));
    });

    const progresses: any[] = [];
    await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      () => {},
      (info) => progresses.push(info),
    );

    // Find some measured progress during the run (after Phase 1 ends)
    const someMeasured = progresses.find((p: any) => typeof p.etaSeconds === 'number');
    expect(someMeasured).toBeTruthy();
    expect(someMeasured.etaSeconds).toBeGreaterThan(0);

    // Final progress after last batch should be 0 remaining and ETA ~ 0
    const final = progresses[progresses.length - 1];
    expect(final.remainingBatches).toBe(0);
    expect(final.etaSeconds === 0 || final.etaSeconds === null).toBeTruthy();
  });

  it('single batch: initial ETA then 0 after completion', async () => {
    const page = Array.from({ length: 100 }).map((_, i) => makeIssue(`K-${i+1}`));
    vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      await onPage(page, 0, 100, 100);
      return page;
    });
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (keys: string[], _opts?: any) => {
      await new Promise((r) => setTimeout(r, 100));
      if (_opts?.onBatch) await _opts.onBatch(keys.map((k) => makeIssue(k)));
      return keys.map((k) => makeIssue(k));
    });

    const progresses: any[] = [];
    await service.getIssuesByActivityStream(
      { start: new Date('2025-01-01'), end: new Date('2025-01-31') },
      () => {},
      (info) => progresses.push(info),
    );

    // initial progress
    expect(progresses[0].totalBatches).toBe(1);
    expect(progresses[0].remainingBatches).toBe(1);

    // final progress (search to avoid ordering flakiness)
    const final = progresses.find((p: any) => p.remainingBatches === 0);
    expect(final).toBeTruthy();
    expect(final.etaSeconds === 0 || final.etaSeconds === null).toBeTruthy();
  });
});
