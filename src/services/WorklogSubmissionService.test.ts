import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorklogSubmissionService } from './WorklogSubmissionService';
import { JiraApiService } from './JiraApiService';
import type { WorklogSchedule } from '../core/app-types';

const jiraMock = {
  logWork: vi.fn() as unknown as JiraApiService['logWork'],
} as unknown as JiraApiService;

describe('WorklogSubmissionService', () => {
  let svc: WorklogSubmissionService;

  beforeEach(() => {
    vi.resetAllMocks();
    svc = new WorklogSubmissionService(jiraMock);
  });

  it('submits each schedule entry with correct seconds and started date', async () => {
    const schedule: WorklogSchedule = {
      'A-1': { '2023-10-02': 120 }, // minutes
      'B-2': { '2023-10-03': 60 },
    };

    (jiraMock.logWork as any).mockResolvedValue(undefined);

    const result = await svc.submitSchedule(schedule, { startHourUTC: 9 });

    expect(result.successes).toBe(2);
    expect(result.failures).toBe(0);

    // Two calls
    expect((jiraMock.logWork as any)).toHaveBeenCalledTimes(2);
    // First call: 120 min => 7200 sec, date starts with 2023-10-02
    const call1 = (jiraMock.logWork as any).mock.calls[0];
    expect(call1[0]).toBe('A-1');
    expect(call1[1]).toBe(120 * 60);
    expect((call1[2] as Date).toISOString().startsWith('2023-10-02')).toBe(true);
    // Second call
    const call2 = (jiraMock.logWork as any).mock.calls[1];
    expect(call2[0]).toBe('B-2');
    expect(call2[1]).toBe(60 * 60);
    expect((call2[2] as Date).toISOString().startsWith('2023-10-03')).toBe(true);
  });

  it('queues failed items and retries them successfully', async () => {
    const schedule: WorklogSchedule = {
      'A-1': { '2023-10-02': 30 },
      'B-2': { '2023-10-02': 45 },
    };

    // First call fails, second succeeds
    (jiraMock.logWork as any)
      .mockRejectedValueOnce(new Error('Network'))
      .mockResolvedValueOnce(undefined);

    const first = await svc.submitSchedule(schedule, { startHourUTC: 9 });
    expect(first.successes).toBe(1);
    expect(first.failures).toBe(1);

    // Now make subsequent calls succeed
    (jiraMock.logWork as any).mockResolvedValue(undefined);

    const second = await svc.retryPending();
    expect(second.successes + second.failures).toBeGreaterThan(0);
    expect(second.failures).toBe(0);
  });
});
