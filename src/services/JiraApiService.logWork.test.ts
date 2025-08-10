import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('JiraApiService.logWork', () => {
  let api: JiraApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    api = new JiraApiService('https://example.atlassian.net');
  });

  it('posts to v3 worklog endpoint with timeSpentSeconds and started', async () => {
    const issueId = 'PROJ-123';
    const started = new Date('2023-10-02T09:30:00.000Z');

    fetchMock.mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });

    await api.logWork(issueId, 5400, started); // 1.5h

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-123/worklog',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        mode: 'cors',
      })
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.timeSpentSeconds).toBe(5400);
    expect(typeof body.started).toBe('string');
    expect(body.started.startsWith('2023-10-02T09:30:00.000Z'.slice(0, 10))).toBe(true);
  });
});

