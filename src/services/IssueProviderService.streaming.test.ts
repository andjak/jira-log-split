import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueProviderService } from './IssueProviderService';
import { JiraApiService } from './JiraApiService';
import { SettingsService } from './SettingsService';
import { JiraIssue } from '../core/jira-types';

describe('IssueProviderService streaming', () => {
  let jiraApiServiceMock: JiraApiService;
  let settingsServiceMock: SettingsService;
  let service: IssueProviderService;

  beforeEach(() => {
    jiraApiServiceMock = {
      fetchIssuesMinimal: vi.fn(),
      fetchIssuesDetailedByKeys: vi.fn(),
      getCurrentUser: vi.fn(),
    } as unknown as JiraApiService;

    // add paged method to mock via dynamic property
    (jiraApiServiceMock as any).fetchIssuesMinimalPaged = vi.fn();

    settingsServiceMock = {
      get: vi.fn(),
    } as unknown as SettingsService;

    service = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
  });

  it('emits sorted incremental updates using binary insertion as detailed batches arrive', async () => {
    const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
    const me = { accountId: 'me-123' };
    (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue(me);

    // Minimal pages with explicit page size 2
    const page1: JiraIssue[] = [
      { id: '1', key: 'K-1', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' }, changelog: { histories: [] as any } },
      { id: '2', key: 'K-2', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' }, changelog: { histories: [] as any } },
    ];
    const page2: JiraIssue[] = [
      { id: '3', key: 'K-3', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' }, changelog: { histories: [] as any } },
    ];

    (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
      if (key === 'includedProjects') return [];
      if (key === 'pipelinedPhase2Enabled') return true;
      return null;
    });

    // Simulate streaming minimal pages
    (jiraApiServiceMock as any).fetchIssuesMinimalPaged.mockImplementation(async (
      _jql: string,
      onPage: (issues: JiraIssue[], pageIndex: number, pageSize: number) => Promise<void> | void,
    ) => {
      await onPage(page1, 0, 2);
      await onPage(page2, 1, 2);
      return [...page1, ...page2];
    });

    // Detailed fetch: call options.onBatch with issues containing activity times
    // Batch 1: K-1 at 2023-10-10, K-2 at 2023-10-05
    // Batch 2: K-3 at 2023-10-07 (should be inserted between K-1 and K-2)
    (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(async (keys: string[], options?: any) => {
      const makeIssue = (key: string, iso: string): JiraIssue => ({
        id: key,
        key,
        fields: { summary: key, issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' },
        changelog: { histories: [ { author: { accountId: me.accountId, displayName: 'Me' }, created: iso, items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] } ] },
      } as any);
      if (keys.includes('K-1') || keys.includes('K-2')) {
        const batch = [makeIssue('K-1', '2023-10-10T12:00:00.000Z'), makeIssue('K-2', '2023-10-05T12:00:00.000Z')];
        await options?.onBatch?.(batch);
        return batch;
      }
      if (keys.includes('K-3')) {
        const batch = [makeIssue('K-3', '2023-10-07T12:00:00.000Z')];
        await options?.onBatch?.(batch);
        return batch;
      }
      await options?.onBatch?.([]);
      return [];
    });

    const onUpdate = vi.fn();
    const final = await (service as any).getIssuesByActivityStream(period, onUpdate);

    // First update from batch1 should be sorted: K-1 (10th) then K-2 (5th)
    expect(onUpdate).toHaveBeenCalled();
    const firstCall = onUpdate.mock.calls[0][0] as JiraIssue[];
    expect(firstCall.map(i => i.key)).toEqual(['K-1', 'K-2']);

    // Second update after K-3 (7th) should be: K-1, K-3, K-2
    const secondCall = onUpdate.mock.calls[1][0] as JiraIssue[];
    expect(secondCall.map(i => i.key)).toEqual(['K-1', 'K-3', 'K-2']);

    // Final return should equal the last emitted sorted array
    expect(final.map((i: JiraIssue) => i.key)).toEqual(['K-1', 'K-3', 'K-2']);
  });
});


