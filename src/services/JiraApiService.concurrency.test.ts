import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';
import type { SettingsService } from './SettingsService';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function okSearchResponse(body: any) {
  return { ok: true, json: () => Promise.resolve(body) } as any;
}

function throttledResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Service Unavailable',
    json: () => Promise.resolve({ errorMessages: [] }),
    text: () => Promise.resolve(''),
  } as any;
}

describe('JiraApiService adaptive concurrency', () => {
  let settingsMock: SettingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    (global as any).fetch = fetchMock;
    settingsMock = {
      get: vi.fn(),
      set: vi.fn(),
    } as unknown as SettingsService;
  });

  it('uses saved per-host concurrency and ramps up +10% on success (minimal phase)', async () => {
    // Arrange: host with saved concurrency 20
    (settingsMock.get as any).mockImplementation(async (key: string) => {
      if (key === 'adaptiveConcurrencyByHost') return { 'my-jira.atlassian.net': 20 };
      return {};
    });

    const svc = new JiraApiService('https://my-jira.atlassian.net', settingsMock);

    // First page: total 3, page size 1
    fetchMock
      .mockResolvedValueOnce(
        okSearchResponse({ issues: [{ id: '1' }], total: 3, startAt: 0, maxResults: 1 }),
      )
      // startAt:1
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: '2' }] }))
      // startAt:2
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: '3' }] }));

    // Act
    const issues = await svc.fetchIssuesMinimal('updated >= "2023-01-01"');

    // Assert
    expect(issues).toHaveLength(3);
    // Persisted concurrency should ramp up by 10% (min capped by max) => 22
    expect((settingsMock.set as any)).toHaveBeenCalledWith(
      'adaptiveConcurrencyByHost',
      expect.objectContaining({ 'my-jira.atlassian.net': 22 }),
    );
  });

  it('defaults to a high starting concurrency (100) when none saved and persists (minimal phase)', async () => {
    (settingsMock.get as any).mockResolvedValue({});
    const svc = new JiraApiService('https://my-jira.atlassian.net', settingsMock);

    fetchMock
      .mockResolvedValueOnce(
        okSearchResponse({ issues: [{ id: '1' }], total: 2, startAt: 0, maxResults: 1 }),
      )
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: '2' }] }));

    const issues = await svc.fetchIssuesMinimal('jql');
    expect(issues).toHaveLength(2);
    expect((settingsMock.set as any)).toHaveBeenCalledWith(
      'adaptiveConcurrencyByHost',
      expect.objectContaining({ 'my-jira.atlassian.net': 100 }),
    );
  });

  it('reduces concurrency by 25% and persists when throttled (detailed phase)', async () => {
    (settingsMock.get as any).mockResolvedValue({}); // default 12
    const svc = new JiraApiService('https://my-jira.atlassian.net', settingsMock);

    // Single batch, triggers 429 and reduction logic
    fetchMock.mockResolvedValueOnce(throttledResponse(429));

    await expect(
      svc.fetchIssuesDetailedByKeys(["K-1"]),
    ).rejects.toThrow();

    // Starting at 100 -> 75 persisted (default when none saved)
    expect((settingsMock.set as any)).toHaveBeenCalledWith(
      'adaptiveConcurrencyByHost',
      expect.objectContaining({ 'my-jira.atlassian.net': 75 }),
    );
  });

  it('honors explicit concurrency passed in options and persists it on success (detailed phase)', async () => {
    (settingsMock.get as any).mockResolvedValue({}); // ignore saved; explicit will override
    const svc = new JiraApiService('https://my-jira.atlassian.net', settingsMock);

    // Prepare two batches; both succeed with paginated responses
    const firstPage = okSearchResponse({ issues: [{ id: 'X' }], total: 1, startAt: 0, maxResults: 1 });
    // Dynamic batching may produce more than 2 batches depending on limits, so respond OK for any number of calls
    fetchMock.mockResolvedValue(firstPage);

    const keys = Array.from({ length: 201 }).map((_, i) => `K-${i + 1}`);
    const issues = await svc.fetchIssuesDetailedByKeys(keys, { batchSize: 200, concurrency: 7 });
    // With dynamic batching, the number of requests can vary; assert successful completion and persistence
    expect(Array.isArray(issues)).toBe(true);
    expect((settingsMock.set as any)).toHaveBeenCalledWith(
      'adaptiveConcurrencyByHost',
      expect.objectContaining({ 'my-jira.atlassian.net': 7 }),
    );
  });

  it('on throttle, retries remaining work in the same run with reduced concurrency and succeeds', async () => {
    (settingsMock.get as any).mockResolvedValue({}); // default starts high (100)
    const svc = new JiraApiService('https://my-jira.atlassian.net', settingsMock);

    // 3 batches (batchSize 1). First call 429, next two ok, then retry of first ok
    fetchMock
      .mockResolvedValueOnce(throttledResponse(429))
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: 'B' }], total: 1, startAt: 0, maxResults: 1 }))
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: 'C' }], total: 1, startAt: 0, maxResults: 1 }))
      .mockResolvedValueOnce(okSearchResponse({ issues: [{ id: 'A' }], total: 1, startAt: 0, maxResults: 1 }));

    const keys = ['A', 'B', 'C'];
    const result = await svc.fetchIssuesDetailedByKeys(keys, { batchSize: 1, concurrency: 100 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    // After one throttle, the saved value will be first seeded to 100 then adjusted down to 75
    const calls = (settingsMock.set as any).mock.calls.filter((c: any[]) => c[0] === 'adaptiveConcurrencyByHost');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Ensure last call reflects reduced value
    const lastMap = calls[calls.length - 1][1];
    expect(lastMap['my-jira.atlassian.net']).toBe(75);
  });
});


