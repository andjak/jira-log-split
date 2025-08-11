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
          body: JSON.stringify({ jql, maxResults: 1000, expand: ['changelog'], fields: ['summary','issuetype','project','updated','comment'] }),
          credentials: 'include',
          mode: 'cors',
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

  describe('credentials and headers', () => {
    it('uses credentials include for GET requests', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ accountId: 'x' }) });
      await jiraApiService.getCurrentUser();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://my-jira.atlassian.net/rest/api/3/myself',
        expect.objectContaining({ credentials: 'include', mode: 'cors' })
      );
    });
  });

  describe('error handling', () => {
    it('includes Jira error messages from JSON body', async () => {
      const jql = 'assignee = currentUser()';
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ errorMessages: ['Invalid JQL'] }),
        text: () => Promise.resolve('{"errorMessages":["Invalid JQL"]}')
      };
      fetchMock.mockResolvedValue(mockResponse);

      await expect(jiraApiService.fetchIssues(jql)).rejects.toThrow(
        'Jira API request failed: 400 Bad Request - Invalid JQL'
      );
    });

    it('falls back to text body when JSON parse fails', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.reject(new Error('Invalid JSON')),
        text: () => Promise.resolve('Some HTML error page')
      };
      fetchMock.mockResolvedValue(mockResponse);

      await expect(jiraApiService.getCurrentUser()).rejects.toThrow(
        'Jira API request failed: 400 Bad Request - Some HTML error page'
      );
    });
  });
});

