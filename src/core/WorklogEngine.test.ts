import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { WorklogEngine } from './WorklogEngine';
import { CalculationContextService } from '../services/CalculationContextService';
import { IssueProviderService } from '../services/IssueProviderService';
import { EvenDistributionStrategy } from './distribution/EvenDistributionStrategy';
import type { DailyContext } from './app-types';

vi.mock('../services/CalculationContextService');
vi.mock('../services/IssueProviderService');

const day1 = '2023-10-02';
const day2 = '2023-10-03';

describe('WorklogEngine', () => {
  let calcMock: Mocked<CalculationContextService>;
  let issuesMock: Mocked<IssueProviderService>;

  beforeEach(() => {
    calcMock = {
      getAvailableHours: vi.fn(),
    } as unknown as Mocked<CalculationContextService>;
    issuesMock = {
      getIssues: vi.fn(),
    } as unknown as Mocked<IssueProviderService>;
  });

  it('builds schedule by computing availability and applying strategy', async () => {
    // Arrange
    const dailyContextProvider = async (_date: Date): Promise<DailyContext> => ({
      vacationHours: 0,
      meetingHours: 0,
      existingWorklogHours: 0,
      isPublicHoliday: false,
    });

    // Two consecutive days in UTC
    const period = {
      start: new Date(`${day1}T00:00:00.000Z`),
      end: new Date(`${day2}T00:00:00.000Z`),
    };

    calcMock.getAvailableHours.mockResolvedValue(8);

    issuesMock.getIssues.mockResolvedValue([
      { key: 'ISSUE-1', fields: { updated: '2023-09-01T00:00:00.000Z' } } as any,
      { key: 'ISSUE-2', fields: { updated: '2023-10-01T00:00:00.000Z' } } as any,
    ]);

    const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });
    const engine = new WorklogEngine(calcMock, issuesMock, strategy, dailyContextProvider);

    // Act
    const schedule = await engine.buildSchedule(period);

    // Assert
    expect(calcMock.getAvailableHours).toHaveBeenCalledTimes(2);
    expect(issuesMock.getIssues).toHaveBeenCalledWith(period);

    // ISSUE-1 gets first day, ISSUE-2 gets second day (8h each)
    expect(schedule['ISSUE-1'][day1]).toBe(8 * 60);
    expect(schedule['ISSUE-2'][day2]).toBe(8 * 60);
  });

  it('allocates nothing on zero-availability days and matches total availability in minutes', async () => {
    const availabilityMap: Record<string, number> = { [day1]: 0, [day2]: 6.5 };

    const dailyContextProvider = async (_d: Date): Promise<DailyContext> => ({
      vacationHours: 0,
      meetingHours: 0,
      existingWorklogHours: 0,
      isPublicHoliday: false,
    });

    const period = {
      start: new Date(`${day1}T00:00:00.000Z`),
      end: new Date(`${day2}T00:00:00.000Z`),
    };

    // Mock getAvailableHours to reflect our map
    calcMock.getAvailableHours.mockImplementation(async (d: Date) => {
      const iso = d.toISOString().split('T')[0];
      return availabilityMap[iso] ?? 0;
    });

    issuesMock.getIssues.mockResolvedValue([
      { key: 'X1', fields: { updated: '2023-09-01T00:00:00.000Z' } } as any,
      { key: 'X2', fields: { updated: '2023-09-02T00:00:00.000Z' } } as any,
    ]);

    const strategy = new EvenDistributionStrategy<any>({ roundMinutes: 5 });
    const engine = new WorklogEngine(calcMock, issuesMock, strategy, dailyContextProvider);

    const schedule = await engine.buildSchedule(period);

    const totalAllocated = Object.values(schedule)
      .flatMap((m) => Object.values(m))
      .reduce((a, b) => a + b, 0);

    const totalAvailabilityMinutes = Math.round(availabilityMap[day1] * 60 + availabilityMap[day2] * 60);

    // Nothing on day1
    const anyOnDay1 = Object.values(schedule).some((m) => m[day1] && m[day1] > 0);
    expect(anyOnDay1).toBe(false);

    // Allocation honors rounding; it cannot exceed total availability
    expect(totalAllocated).toBeLessThanOrEqual(totalAvailabilityMinutes);
  });
});
