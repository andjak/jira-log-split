import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { CalculationContextService } from './CalculationContextService';
import { SettingsService } from './SettingsService';
import { DailyContext } from '../core/app-types';

vi.mock('./SettingsService');

describe('CalculationContextService', () => {
  let settingsServiceMock: Mocked<SettingsService>;
  let calculationContextService: CalculationContextService;

  beforeEach(() => {
    settingsServiceMock = new (vi.mocked(SettingsService))() as Mocked<SettingsService>;
    calculationContextService = new CalculationContextService(settingsServiceMock);
    // Default mock for a standard 8-hour day
    settingsServiceMock.getWorkdayHours.mockResolvedValue(8);
  });

  it('should return the full workday hours for a standard day', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 0, meetingHours: 0, existingWorklogHours: 0, isPublicHoliday: false };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(8);
  });

  it('should return 0 hours for a public holiday', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 0, meetingHours: 0, existingWorklogHours: 0, isPublicHoliday: true };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(0);
  });

  it('should deduct vacation hours from the workday', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 3, meetingHours: 0, existingWorklogHours: 0, isPublicHoliday: false };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(5); // 8 - 3
  });

  it('should deduct meeting hours from the workday', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 0, meetingHours: 1.5, existingWorklogHours: 0, isPublicHoliday: false };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(6.5); // 8 - 1.5
  });

  it('should deduct all non-work hours from the workday', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 2, meetingHours: 1, existingWorklogHours: 2.5, isPublicHoliday: false };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(2.5); // 8 - 2 - 1 - 2.5
  });

  it('should not return negative hours', async () => {
    // Arrange
    const context: DailyContext = { vacationHours: 5, meetingHours: 4, existingWorklogHours: 0, isPublicHoliday: false };

    // Act
    const availableHours = await calculationContextService.getAvailableHours(new Date(), context);

    // Assert
    expect(availableHours).toBe(0);
  });

  it('should return 0 hours for a weekend day', async () => {
    // Arrange
    const saturday = new Date('2023-10-28T00:00:00.000Z');
    const sunday = new Date('2023-10-29T00:00:00.000Z');
    const context: DailyContext = { vacationHours: 0, meetingHours: 0, existingWorklogHours: 0, isPublicHoliday: false };

    // Act
    const saturdayHours = await calculationContextService.getAvailableHours(saturday, context);
    const sundayHours = await calculationContextService.getAvailableHours(sunday, context);

    // Assert
    expect(saturdayHours).toBe(0);
    expect(sundayHours).toBe(0);
  });
});


