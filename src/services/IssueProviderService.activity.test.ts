import { describe, it, expect } from 'vitest';
import { IssueProviderService } from './IssueProviderService';
import type { JiraIssue } from '../core/jira-types';

// Use real class; we won't hit network for this method

describe('IssueProviderService.derivePerDayActive', () => {
  it('groups issue keys by day when user has status-change activity within period', async () => {
    const svc = new IssueProviderService({} as any, {} as any);

    const period = {
      start: new Date('2023-10-01T00:00:00.000Z'),
      end: new Date('2023-10-31T23:59:59.999Z'),
    };
    const me = 'me-123';

    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'A',
        fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' },
        changelog: {
          histories: [
            { author: { accountId: me, displayName: 'Me' }, created: '2023-10-02T09:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] },
            { author: { accountId: me, displayName: 'Me' }, created: '2023-10-03T10:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'In Progress', toString: 'Done' }] },
          ],
        },
      },
      {
        id: '2',
        key: 'B',
        fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' },
        changelog: {
          histories: [
            { author: { accountId: me, displayName: 'Me' }, created: '2023-10-02T14:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] },
          ],
        },
      },
      {
        id: '3',
        key: 'C',
        fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' },
        changelog: {
          histories: [
            { author: { accountId: 'someone-else', displayName: 'Other' }, created: '2023-10-02T12:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] },
          ],
        },
      },
    ];

    const perDay = svc.derivePerDayActive(issues, period, me);

    expect(perDay['2023-10-02'].sort()).toEqual(['A', 'B']);
    expect(perDay['2023-10-03']).toEqual(['A']);
    expect(perDay['2023-10-01']).toBeUndefined();
  });
});

