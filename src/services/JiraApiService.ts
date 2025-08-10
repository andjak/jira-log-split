import { JiraIssue, JiraUser, JiraWorklog } from '../core/jira-types';

export class JiraApiService {
  private readonly baseUrl: string;
  private readonly JIRA_API_V2 = '/rest/api/2';
  private readonly JIRA_API_V3 = '/rest/api/3';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  public async getCurrentUser(): Promise<JiraUser> {
    return this._request<JiraUser>(`${this.JIRA_API_V3}/myself`);
  }


  /**
   * Fetches Jira issues based on a JQL query.
   * Expands the changelog to get issue activity.
   */
  public async fetchIssues(jql: string): Promise<JiraIssue[]> {
    const body = {
      jql,
      maxResults: 1000,
      expand: ['changelog'], // Important for the "distribute by activity" feature
    };
    const data = await this._request<{ issues: JiraIssue[] }>(`${this.JIRA_API_V2}/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return data.issues || [];
  }

  public async getExistingWorklogs(issueIds: string[], startDate: Date, endDate: Date): Promise<JiraWorklog[]> {
    // Note: The Jira REST API for worklogs is a bit complex.
    // A simple approach is to fetch worklogs for each issue individually.
    // A more advanced (but complex) approach might involve a custom JQL function if available.
    console.log('Fetching worklogs for', issueIds, startDate, endDate);
    // This will be implemented in a future step.
    return Promise.resolve([]);
  }

  public async logWork(issueId: string, timeSpentSeconds: number, started: Date): Promise<void> {
    await this._request(
      `${this.JIRA_API_V3}/issue/${encodeURIComponent(issueId)}/worklog`,
      {
        method: 'POST',
        body: JSON.stringify({
          timeSpentSeconds,
          started: started.toISOString(),
        }),
      },
    );
  }

  /**
   * A private helper method to handle all API requests.
   */
  private async _request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Use browser session cookies; MV3 extension has host_permissions for cross-origin
    const response = await fetch(url, {
      credentials: 'include',
      mode: 'cors',
      ...options,
      headers,
    });

    if (!response.ok) {
      let details = '';
      try {
        const data: any = await response.json();
        if (Array.isArray(data?.errorMessages) && data.errorMessages.length > 0) {
          details = ` - ${data.errorMessages.join('; ')}`;
        } else if (typeof data?.message === 'string') {
          details = ` - ${data.message}`;
        }
      } catch {
        try {
          const text = await response.text();
          if (text) details = ` - ${text}`;
        } catch {}
      }
      throw new Error(`Jira API request failed: ${response.status} ${response.statusText}${details}`);
    }

    // Handle responses with no content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }
}


