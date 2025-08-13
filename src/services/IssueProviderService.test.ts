import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';
import { IssueProviderService } from './IssueProviderService';
import { SettingsService } from './SettingsService';
import { JiraIssue } from '../core/jira-types';

describe('IssueProviderService', () => {
  let jiraApiServiceMock: JiraApiService;
  let settingsServiceMock: SettingsService;
  let issueProviderService: IssueProviderService;

  beforeEach(() => {
    // Plain object mocks
    jiraApiServiceMock = {
      fetchIssues: vi.fn(),
      fetchIssuesMinimal: vi.fn(),
      fetchIssuesDetailedByKeys: vi.fn(),
      getProjectsWhereUserHasAnyPermission: vi.fn(),
      getCurrentUser: vi.fn(),
    } as unknown as JiraApiService;

    settingsServiceMock = {
      get: vi.fn(),
    } as unknown as SettingsService;

    issueProviderService = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
  });

  // Removed legacy cross-class test that sometimes times out under CI; fetch behavior covered in JiraApiService.test.ts

  describe('getIssues (My Profile Strategy)', () => {
    it('should construct the correct JQL for the "My Profile" strategy', async () => {
      // Arrange
      const period = {
        start: new Date('2023-10-01T00:00:00.000Z'),
        end: new Date('2023-10-31T23:59:59.999Z'),
      };
      const mockIssues: JiraIssue[] = [{ id: '1', key: 'TEST-1', fields: { summary: 'An issue', issuetype: { iconUrl: '', name: 'Task'}, project: {key: 'TEST', name: 'Test Project'}, updated: ''} }];

      // Setup mocks for the different calls to settingsService.get()
      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'myProfile';
        if (key === 'excludedProjects') return ['PROJ-A'];
        if (key === 'excludedIssueTypes') return ['Epic', 'Story'];
        return null;
      });
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect((jiraApiServiceMock.fetchIssues as any)).toHaveBeenCalled();
      const calledJql = (jiraApiServiceMock.fetchIssues as any).mock.calls[0][0] as string;
      // Assert ORDER BY is appended correctly (not joined with AND)
      expect(calledJql.includes(' AND ORDER BY')).toBe(false);
      expect(calledJql.endsWith(' ORDER BY updated DESC')).toBe(true);
      expect(calledJql).toContain('updated >= "2023-10-01"');
      expect(calledJql).toContain('updated <= "2023-10-31"');
      expect(issues).toEqual(mockIssues);
    });
  });

  describe('getIssues (Activity Strategy)', () => {
    it('should return only issues with user activity in the period', async () => {
      // Arrange
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-123';
      const mockIssues: JiraIssue[] = [
        { // Issue 1: Has relevant activity
          id: '1', key: 'ACT-1', fields: { summary: 'Active Issue', issuetype: { iconUrl: '', name: 'Task'}, project: {key: 'ACT', name: 'Activity Project'}, updated: ''},
          changelog: {
            histories: [
              { author: { accountId: currentUserAccountId, displayName: 'Me' }, created: '2023-10-15T10:00:00.000Z', items: [{ field: 'status', toString: 'In Progress', fromString: 'To Do', fieldtype: 'jira' }] }
            ]
          }
        },
        { // Issue 2: No relevant activity by current user
          id: '2', key: 'ACT-2', fields: { summary: 'Inactive Issue', issuetype: { iconUrl: '', name: 'Task'}, project: {key: 'ACT', name: 'Activity Project'}, updated: ''},
          changelog: {
            histories: [
              { author: { accountId: 'anotherUser-456', displayName: 'Someone Else' }, created: '2023-10-16T11:00:00.000Z', items: [{ field: 'status', toString: 'Done', fromString: 'In Progress', fieldtype: 'jira' }] }
            ]
          }
        },
        { // Issue 3: No changelog at all
          id: '3', key: 'ACT-3', fields: { summary: 'Quiet Issue', issuetype: { iconUrl: '', name: 'Task'}, project: {key: 'ACT', name: 'Activity Project'}, updated: ''}
        }
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return [];
        if (key === 'excludedIssueTypes') return [];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect(issues[0].key).toBe('ACT-1');
    });

    it('builds JQL with only time period and orders by updated when using activity source', async () => {
      // Arrange
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-abc';
      const mockIssues: JiraIssue[] = [
        {
          id: '1',
          key: 'DATE-ONLY-1',
          fields: { summary: 'Updated by me', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'A', name: 'A' }, updated: '' },
          changelog: {
            histories: [
              { author: { accountId: currentUserAccountId, displayName: 'Me' }, created: '2023-10-10T12:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] },
            ],
          },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return ['SHOULD-NOT-BE-USED'];
        if (key === 'excludedIssueTypes') return ['SHOULD-NOT-BE-USED'];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any).mockResolvedValue([]);
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(async () => mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(async () => mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect((jiraApiServiceMock.fetchIssuesMinimal as any)).toHaveBeenCalled();
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock.calls[0][0] as string;
      expect(calledJql).toContain('updated >= "2023-10-01"');
      expect(calledJql).toContain('updated <= "2023-10-31"');
      expect(calledJql).toContain('ORDER BY updated DESC');
      // Should NOT include user involvement conditions or project/issuetype exclusions
      expect(calledJql).not.toMatch(/assignee|reporter|creator|watcher|project not in|issuetype not in/);
    });

    it('includes project prefilter only when settings.includedProjects is non-empty; otherwise date-only', async () => {
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-abc';
      const mockIssues: JiraIssue[] = [
        { id: '1', key: 'DATE-ONLY-1', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'A', name: 'A' }, updated: '' }, changelog: { histories: [] as any } },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'includedProjects') return [];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any).mockResolvedValue(['PROJ1', 'PROJ2']);
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(mockIssues);

      await issueProviderService.getIssues(period);

      // With no includedProjects, we should NOT add project in (...) even if user has permissions
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock.calls[0][0] as string;
      expect(calledJql).not.toMatch(/project in \(/);

      // Now simulate includedProjects and expect project filter to be added
      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'includedProjects') return ['P1','P2'];
        return null;
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockClear();
      await issueProviderService.getIssues(period);
      const calledJql2 = (jiraApiServiceMock.fetchIssuesMinimal as any).mock.calls[0][0] as string;
      expect(calledJql2).toMatch(/project in \("P1", "P2"\)/);
    });

    it('falls back without project prefilter when permission fetch fails', async () => {
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-abc';
      const mockIssues: JiraIssue[] = [
        { id: '1', key: 'DATE-ONLY-1', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'A', name: 'A' }, updated: '' }, changelog: { histories: [] as any } },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any).mockRejectedValue(new Error('perm api failed'));
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(mockIssues);

      await issueProviderService.getIssues(period);
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock.calls[0][0] as string;
      expect(calledJql).not.toMatch(/project in \(/);
    });

    it('includes issues when the user commented within the period', async () => {
      // Arrange
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-xyz';
      const mockIssues: JiraIssue[] = [
        {
          id: '1',
          key: 'CMNT-1',
          fields: {
            summary: 'Has comment by me',
            issuetype: { iconUrl: '', name: 'Task' },
            project: { key: 'A', name: 'A' },
            updated: '',
            comment: {
              comments: [
                { id: 'c1', author: { accountId: currentUserAccountId, displayName: 'Me' }, created: '2023-10-05T09:30:00.000Z' },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: { histories: [] as any },
        },
        {
          id: '2',
          key: 'CMNT-2',
          fields: {
            summary: 'No comment by me',
            issuetype: { iconUrl: '', name: 'Task' },
            project: { key: 'A', name: 'A' },
            updated: '',
            comment: {
              comments: [
                { id: 'c2', author: { accountId: 'someone-else', displayName: 'Other' }, created: '2023-10-05T10:00:00.000Z' },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: { histories: [] as any },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return [];
        if (key === 'excludedIssueTypes') return [];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(async () => mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(async () => mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues.map(i => i.key)).toEqual(['CMNT-1']);
      // And ensure it added activity metadata
      expect(issues[0].userActivity?.lastCommentedByMeISO).toBe('2023-10-05T09:30:00.000Z');
      expect(issues[0].userActivity?.lastActivityAtISO).toBe('2023-10-05T09:30:00.000Z');
    });

    it('combines update and comment activity and sorts by user last activity desc', async () => {
      // Arrange
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const me = 'me-1';
      const mockIssues: JiraIssue[] = [
        {
          id: '1', key: 'UPD-OLD', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'P', name: 'P' }, updated: '' },
          changelog: { histories: [ { author: { accountId: me, displayName: 'Me' }, created: '2023-10-05T08:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] } ] },
          // no comments
        },
        {
          id: '2', key: 'CMNT-NEW', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'P', name: 'P' }, updated: '', comment: { comments: [ { id: 'c1', author: { accountId: me, displayName: 'Me' }, created: '2023-10-10T12:00:00.000Z' } ], maxResults: 1, total: 1, startAt: 0 } },
          changelog: { histories: [] as any },
        },
        {
          id: '3', key: 'BOTH', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'P', name: 'P' }, updated: '', comment: { comments: [ { id: 'c1', author: { accountId: me, displayName: 'Me' }, created: '2023-10-09T12:00:00.000Z' } ], maxResults: 1, total: 1, startAt: 0 } },
          changelog: { histories: [ { author: { accountId: me, displayName: 'Me' }, created: '2023-10-08T08:00:00.000Z', items: [{ field: 'status', fieldtype: 'jira', fromString: 'To Do', toString: 'In Progress' }] } ] },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return [];
        if (key === 'excludedIssueTypes') return [];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: me });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(async () => mockIssues);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(async () => mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert: sorted by last activity desc => CMNT-NEW (10th), BOTH (9th), UPD-OLD (5th)
      expect(issues.map((i) => i.key)).toEqual(['CMNT-NEW', 'BOTH', 'UPD-OLD']);
      // Metadata
      const both = issues.find(i => i.key === 'BOTH')!;
      expect(both.userActivity?.lastUpdatedByMeISO).toBe('2023-10-08T08:00:00.000Z');
      expect(both.userActivity?.lastCommentedByMeISO).toBe('2023-10-09T12:00:00.000Z');
      expect(both.userActivity?.lastActivityAtISO).toBe('2023-10-09T12:00:00.000Z');
    });

    it('pipelined phase2: starts detailed fetch for first page while minimal phase continues (feature flag on)', async () => {
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'me-1';
      const page1: JiraIssue[] = [
        { id: '1', key: 'K-1', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' }, changelog: { histories: [] as any } },
      ];
      const page2: JiraIssue[] = [
        { id: '2', key: 'K-2', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'X', name: 'X' }, updated: '' }, changelog: { histories: [] as any } },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'includedProjects') return [];
        if (key === 'pipelinedPhase2Enabled') return true;
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });

      // Use the paged API: simulate onPage receiving two pages
      (jiraApiServiceMock as any).fetchIssuesMinimalPaged = vi.fn(async (_jql: string, onPage: Function) => {
        await onPage(page1, 0);
        await onPage(page2, 1);
        return [...page1, ...page2];
      });
      // Detailed fetch should be invoked twice, once per page
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([]);

      const service = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
      await service.getIssues(period);

      const calls = (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // First call keys should include only K-1
      expect(calls[0][0]).toEqual(['K-1']);
    });

    it('pipelined phase2: uses minimal page size as detailed batch size', async () => {
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'me-2';
      const minimalPage: JiraIssue[] = [
        { id: '11', key: 'PX-11', fields: { summary: '', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'P', name: 'P' }, updated: '' }, changelog: { histories: [] as any } },
      ];
      const minimalPageSize = 100;

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'includedProjects') return [];
        if (key === 'pipelinedPhase2Enabled') return true;
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });

      // Provide paged minimal results with explicit pageSize
      (jiraApiServiceMock as any).fetchIssuesMinimalPaged = vi.fn(async (_jql: string, onPage: Function) => {
        await onPage(minimalPage, 0, minimalPageSize);
        return minimalPage;
      });

      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([]);

      const service = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
      await service.getIssues(period);

      const calls = (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // Assert options.batchSize equals minimal page size
      const passedOptions = calls[0][1] || {};
      expect(passedOptions.batchSize).toBe(minimalPageSize);
    });
  });
});

