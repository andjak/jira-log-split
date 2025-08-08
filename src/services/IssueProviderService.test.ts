import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueProviderService } from './IssueProviderService';
import { JiraApiService } from './JiraApiService';
import { SettingsService } from './SettingsService';
import { JiraIssue } from '../core/jira-types';

// Mock the dependencies
vi.mock('./JiraApiService');
vi.mock('./SettingsService');

describe('IssueProviderService', () => {
  let jiraApiServiceMock: vi.Mocked<JiraApiService>;
  let settingsServiceMock: vi.Mocked<SettingsService>;
  let issueProviderService: IssueProviderService;

  beforeEach(() => {
    // Create fresh mocks for each test
    jiraApiServiceMock = new (vi.mocked(JiraApiService))() as vi.Mocked<JiraApiService>;
    settingsServiceMock = new (vi.mocked(SettingsService))() as vi.Mocked<SettingsService>;
    
    // Instantiate the service with its mocked dependencies
    issueProviderService = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
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
      vi.spyOn(settingsServiceMock, 'get').mockImplementation(async (key) => {
        if (key === 'issueSource') return 'myProfile';
        if (key === 'excludedProjects') return ['PROJ-A'];
        if (key === 'excludedIssueTypes') return ['Epic', 'Story'];
        return null;
      });
      jiraApiServiceMock.fetchIssues.mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      const expectedJql = [
        `updated >= "2023-10-01"`,
        `updated <= "2023-10-31"`,
        `(assignee in (currentUser()) OR reporter in (currentUser()) OR creator in (currentUser()) OR watcher in (currentUser()))`,
        `project not in ("PROJ-A")`,
        `issuetype not in ("Epic", "Story")`,
        `ORDER BY updated DESC`
      ].join(' AND ');
      
      expect(jiraApiServiceMock.fetchIssues).toHaveBeenCalledWith(expectedJql);
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

      // Setup mocks
      vi.spyOn(settingsServiceMock, 'get').mockImplementation(async (key) => {
        if (key === 'issueSource') return 'activity';
        if (key === 'excludedProjects') return [];
        if (key === 'excludedIssueTypes') return [];
        return null;
      });
      // We also need a way to get the current user's ID. Let's assume JiraApiService has a method for it.
      vi.spyOn(jiraApiServiceMock, 'getCurrentUser').mockResolvedValue({ accountId: currentUserAccountId });
      jiraApiServiceMock.fetchIssues.mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect(issues[0].key).toBe('ACT-1');
    });
  });
});

