import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';
import { JiraIssue } from '../core/jira-types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('JiraApiService', () => {
  let jiraApiService: JiraApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    jiraApiService = new JiraApiService('https://my-jira.atlassian.net');
  });

  describe('fetchIssues', () => {
    it('should fetch issues and expand the changelog', async () => {
      // Arrange
      const jql = 'assignee = currentUser()';
      const mockIssues: JiraIssue[] = [
        { id: '1001', key: 'PROJ-1', fields: { summary: 'Test Issue 1', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'PROJ', name: 'Project' }, updated: '' } },
      ];
      const mockResponse = { ok: true, json: () => Promise.resolve({ issues: mockIssues }) };
      fetchMock.mockResolvedValue(mockResponse);

      // Act
      const issues = await jiraApiService.fetchIssues(jql);

      // Assert
      expect(fetchMock).toHaveBeenCalledWith(
        'https://my-jira.atlassian.net/rest/api/2/search',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ jql, maxResults: 1000, expand: ['changelog'] }),
        })
      );
      expect(issues).toEqual(mockIssues);
    });

    it('should throw an error if the network response is not ok', async () => {
      // Arrange
      const jql = 'assignee = currentUser()';
      const mockResponse = { ok: false, status: 401, statusText: 'Unauthorized' };
      fetchMock.mockResolvedValue(mockResponse);

      // Act & Assert
      await expect(jiraApiService.fetchIssues(jql)).rejects.toThrow('Jira API request failed: 401 Unauthorized');
    });
  });
});

