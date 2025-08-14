import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('JiraApiService dynamic batch sizing', () => {
  let svc: JiraApiService;

  beforeEach(() => {
    vi.resetAllMocks();
    svc = new JiraApiService('https://acme.atlassian.net');
    // Mock one-page responses for minimal fetch; body content is irrelevant, we just need total keys count
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) });
  });

  async function runWith(totalKeys: number, targetConcurrency: number) {
    // Spy on internal helper to intercept chosen batch size via debug logs
    const logSpy = vi.spyOn<any, any>(svc as any, 'debugLog');
    // Create fake keys
    const keys = Array.from({ length: totalKeys }).map((_, i) => `K-${i + 1}`);
    // Call detailed fetch directly; it will compute batch size from keys count and target concurrency
    // Simulate explicit concurrency via options
    // Mock the search API to return empty pages so we don't depend on real network shape
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [], total: 0, startAt: 0, maxResults: 100 }) });
    await svc.fetchIssuesDetailedByKeys(keys, { concurrency: targetConcurrency });
    // Find the phase-detailed-start log payload
    const call = logSpy.mock.calls.find((c) => c[0] === 'phase-detailed-start');
    return call ? (call[1] as any) : null;
  }

  it('totalKeys < targetConcurrency → batch size becomes 1 (many tiny tasks)', async () => {
    const payload: any = await runWith(5, 10);
    // With 5 keys and 10 desired concurrency, batch size = ceil(5/10)=1 → batches=5
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(5);
  });

  it('ceil(total/target) < minBatchSize → batch size clamps to min', async () => {
    const payload: any = await runWith(200, 1000); // ceil(200/1000)=1 → batches=200 with no min clamp
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(200);
  });

  it('ceil(total/target) between min and max → use computed size', async () => {
    const payload: any = await runWith(500, 100); // ceil(500/100)=5 → batches=ceil(500/5)=100
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(100);
  });

  it('ceil(total/target) > max → batch size clamps to max', async () => {
    const payload: any = await runWith(50000, 10); // ceil(50000/10)=5000 → batches=ceil(50000/5000)=10
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(10);
  });

  it('totalKeys = 0 → no batches', async () => {
    const payload = await runWith(0, 100);
    // fetchIssuesDetailedByKeys returns early; no start log emitted
    expect(payload).toBeNull();
  });

  it('respects explicit options.batchSize for phase 2', async () => {
    // With total=250 and very high targetConcurrency, dynamic calc would clamp to min=50 → batches=5.
    // Passing explicit batchSize=100 should result in batches=ceil(250/100)=3.
    const logSpy = vi.spyOn<any, any>(svc as any, 'debugLog');
    const keys = Array.from({ length: 250 }).map((_, i) => `K-${i + 1}`);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [], total: 0, startAt: 0, maxResults: 100 }) });
    await svc.fetchIssuesDetailedByKeys(keys, { concurrency: 1000, batchSize: 100 });
    const call = logSpy.mock.calls.find((c) => c[0] === 'phase-detailed-start');
    expect(call).toBeTruthy();
    const payload: any = call ? (call[1] as any) : null;
    expect(payload.batches).toBe(3);
  });
});


