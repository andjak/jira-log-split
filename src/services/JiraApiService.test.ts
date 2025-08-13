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
    it('should fetch issues and expand the changelog with pagination and parallel pages', async () => {
      // Arrange
      const jql = 'assignee = currentUser()';
      const page1: JiraIssue[] = [
        { id: '1001', key: 'PROJ-1', fields: { summary: 'Test Issue 1', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'PROJ', name: 'Project' }, updated: '' } },
      ];
      const page2: JiraIssue[] = [
        { id: '1002', key: 'PROJ-2', fields: { summary: 'Test Issue 2', issuetype: { iconUrl: '', name: 'Task' }, project: { key: 'PROJ', name: 'Project' }, updated: '' } },
      ];
      const resp1 = { ok: true, json: () => Promise.resolve({ issues: page1, total: 2, startAt: 0, maxResults: 1 }) };
      const resp2 = { ok: true, json: () => Promise.resolve({ issues: page2, total: 2, startAt: 1, maxResults: 1 }) };
      fetchMock.mockResolvedValueOnce(resp1).mockResolvedValueOnce(resp2);

      // Act
      const issues = await jiraApiService.fetchIssues(jql);

      // Assert
      // First call is the initial page discovery (startAt 0)
      expect(fetchMock.mock.calls[0][0]).toBe('https://my-jira.atlassian.net/rest/api/2/search');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ startAt: 0, maxResults: 100 });
      // Second call is next page; page size comes from server (maxResults: 1 in this test)
      expect(fetchMock.mock.calls[1][0]).toBe('https://my-jira.atlassian.net/rest/api/2/search');
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ startAt: 1, maxResults: 1 });
      expect(issues).toEqual([...page1, ...page2]);
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

