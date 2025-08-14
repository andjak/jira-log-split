import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueProviderService } from './IssueProviderService';
import { JiraApiService } from './JiraApiService';
import { SettingsService } from './SettingsService';

type AnyIssue = any;

function makeIssue(key: string, iso: string): AnyIssue {
  return {
    key,
    fields: {
      summary: key,
      issuetype: { name: 'Story' },
      updated: iso,
      comment: { comments: [] },
    },
    changelog: {
      histories: [
        {
          author: { accountId: 'me' },
          created: iso,
          items: [{ field: 'status' }],
        },
      ],
    },
  };
}

describe('IssueProviderService streaming period changes', () => {
  let jira: JiraApiService;
  let settings: SettingsService;
  let svc: IssueProviderService;

  beforeEach(() => {
    settings = new SettingsService();
    jira = new JiraApiService('https://example.atlassian.net', settings);
    svc = new IssueProviderService(jira, settings);
    vi.spyOn(jira, 'getCurrentUser').mockResolvedValue({ accountId: 'me' } as any);
    // Avoid accessing chrome storage in tests
    vi.spyOn(settings as any, 'get').mockImplementation(async (key: string) => {
      if (key === 'includedProjects') return [];
      if (key === 'pipelinedPhase2Enabled') return true;
      return undefined;
    });
  });

  it('shrinking period keeps still-covered items and removes out-of-range without network', async () => {
    // Seed cache with two issues: one inside new period, one outside
    (svc as any).allFetchedIssues = [
      makeIssue('OLD-IN', '2025-08-10T10:00:00.000Z'),
      makeIssue('OLD-OUT', '2025-08-20T10:00:00.000Z'),
    ];
    // fetched previously covered the whole month
    ;(svc as any).fetchedRanges = [{ start: '2025-08-01', end: '2025-08-31' }];

    const updates: AnyIssue[][] = [];
    const minimalPaged = vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockResolvedValue([]);

    const result = await svc.getIssuesByActivityStream(
      { start: new Date('2025-08-01T00:00:00Z'), end: new Date('2025-08-15T23:59:59Z') },
      (iss) => updates.push(iss),
    );

    // No network calls for minimal phase
    expect(minimalPaged).not.toHaveBeenCalled();
    // Streaming should serve from cache with only OLD-IN
    expect(result.map((i: AnyIssue) => i.key)).toEqual(['OLD-IN']);
    expect(updates.length).toBe(1);
    expect(updates[0].map((i) => i.key)).toEqual(['OLD-IN']);
  });

  it('expanding period adds newly found items while keeping previous and avoiding duplicates', async () => {
    // Pre-existing cache
    (svc as any).allFetchedIssues = [makeIssue('OLD-1', '2025-08-10T10:00:00.000Z')];
    ;(svc as any).fetchedRanges = [{ start: '2025-08-01', end: '2025-08-13' }];

    // New delta will be 2025-07-24..2025-07-31
    const minimalPaged = vi.spyOn(jira as any, 'fetchIssuesMinimalPaged').mockImplementation(async (_jql: string, onPage: any) => {
      await onPage([ { key: 'NEW-1' }, { key: 'OLD-1' } ] as AnyIssue[], 0, 100, 2);
      return [];
    });
    vi.spyOn(jira, 'fetchIssuesDetailedByKeys').mockImplementation(async (keys: string[], opts?: any) => {
      const details = keys.map((k) => (k === 'NEW-1' ? makeIssue('NEW-1', '2025-07-28T09:00:00.000Z') : makeIssue('OLD-1', '2025-08-10T10:00:00.000Z')));
      if (opts?.onBatch) await opts.onBatch(details);
      return details as any;
    });

    const updates: AnyIssue[][] = [];
    const result = await svc.getIssuesByActivityStream(
      { start: new Date('2025-07-24T00:00:00Z'), end: new Date('2025-08-13T23:59:59Z') },
      (iss) => updates.push(iss),
    );

    expect(minimalPaged).toHaveBeenCalled();
    // Final set should include OLD-1 (from cache) and NEW-1 (from delta), without duplicate OLD-1
    const keys = result.map((i: AnyIssue) => i.key);
    expect(keys.sort()).toEqual(['NEW-1', 'OLD-1']);
    // At least one update should include both
    const anyBoth = updates.some((u) => u.map((i) => i.key).sort().join(',') === 'NEW-1,OLD-1');
    expect(anyBoth).toBe(true);
  });
});


