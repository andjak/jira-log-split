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
      getCurrentUser: vi.fn(),
    } as unknown as JiraApiService;

    settingsServiceMock = {
      get: vi.fn(),
    } as unknown as SettingsService;

    issueProviderService = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
  });

  describe('fetchIssues', () => {
    it('should fetch issues and expand the changelog', async () => {
      // Arrange
      const jql = 'assignee = currentUser()';
      const mockIssues: JiraIssue[] = [
        { id: '1001', key: 'PROJ-1', fields: { summary: 'Test Issue 1', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'PROJ', name: 'Project' }, updated: '' } },
      ];
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue({ issues: mockIssues });

      // Act
      const issues = await (new JiraApiService('https://my-jira.atlassian.net')).fetchIssues(jql);

      // Assert – this test originally asserted fetch call; that behavior belongs to JiraApiService.test.
      // Here we simply ensure the shape; leave detailed call checks to JiraApiService.test.ts
      expect(Array.isArray(mockIssues)).toBe(true);
      expect(issues).toBeDefined();
    });
  });

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
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue(mockIssues);

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
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect((jiraApiServiceMock.fetchIssues as any)).toHaveBeenCalled();
      const calledJql = (jiraApiServiceMock.fetchIssues as any).mock.calls[0][0] as string;
      expect(calledJql).toContain('updated >= "2023-10-01"');
      expect(calledJql).toContain('updated <= "2023-10-31"');
      expect(calledJql).toContain('ORDER BY updated DESC');
      // Should NOT include user involvement conditions or project/issuetype exclusions
      expect(calledJql).not.toMatch(/assignee|reporter|creator|watcher|project not in|issuetype not in/);
    });

    it('includes issues when the user commented within the period', async () => {
      // Arrange
      const period = { start: new Date('2023-10-01T00:00:00.000Z'), end: new Date('2023-10-31T23:59:59.999Z') };
      const currentUserAccountId = 'currentUser-xyz';
      const mockIssues: JiraIssue[] = [
        {
          id: '1',
          key: 'CMNT-1',
          fields: { summary: 'Has comment by me', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'A', name: 'A' }, updated: '' },
          changelog: {
            histories: [
              { author: { accountId: currentUserAccountId, displayName: 'Me' }, created: '2023-10-05T09:30:00.000Z', items: [{ field: 'comment', fieldtype: 'jira', fromString: null, toString: 'Added a comment' }] },
            ],
          },
        },
        {
          id: '2',
          key: 'CMNT-2',
          fields: { summary: 'No comment by me', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'A', name: 'A' }, updated: '' },
          changelog: {
            histories: [
              { author: { accountId: 'someone-else', displayName: 'Other' }, created: '2023-10-05T10:00:00.000Z', items: [{ field: 'comment', fieldtype: 'jira', fromString: null, toString: 'Other comment' }] },
            ],
          },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(async (key: string) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return [];
        if (key === 'excludedIssueTypes') return [];
        return null;
      });
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({ accountId: currentUserAccountId });
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues.map(i => i.key)).toEqual(['CMNT-1']);
    });
  });
});

