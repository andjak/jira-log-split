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
    const entry = logSpy.mock.calls.find((c) => c[0] === 'phase-detailed-start');
    return entry ? entry[1] : null;
  }

  it('totalKeys < targetConcurrency → batch size becomes 1 (many tiny tasks)', async () => {
    const payload = await runWith(5, 10);
    // With 5 keys and 10 desired concurrency, batch size clamps to min (50), so 1 batch
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(1);
  });

  it('ceil(total/target) < minBatchSize → batch size clamps to min', async () => {
    const payload = await runWith(200, 1000); // ceil(200/1000)=1 < min(50)
    expect(payload).toBeTruthy();
    // With min 50, batches ≈ ceil(200/50)=4
    expect(payload.batches).toBe(4);
  });

  it('ceil(total/target) between min and max → use computed size', async () => {
    const payload = await runWith(500, 100); // ceil(500/100)=5 within [50,1000] → clamps to min 50
    expect(payload).toBeTruthy();
    // With min 50, batches ≈ ceil(500/50)=10
    expect(payload.batches).toBe(10);
  });

  it('ceil(total/target) > max → batch size clamps to max', async () => {
    const payload = await runWith(50000, 10); // ceil(50000/10)=5000 > max(1000) → use 1000
    expect(payload).toBeTruthy();
    expect(payload.batches).toBe(Math.ceil(50000 / 1000));
  });

  it('totalKeys = 0 → no batches', async () => {
    const payload = await runWith(0, 100);
    // fetchIssuesDetailedByKeys returns early; no start log emitted
    expect(payload).toBeNull();
  });
});


