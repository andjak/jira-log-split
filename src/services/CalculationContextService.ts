// src/services/CalculationContextService.ts
import { DailyContext } from '../core/app-types';
import { SettingsService } from './SettingsService';

export class CalculationContextService {
  constructor(private settingsService: SettingsService) {}

  /**
   * Calculates the number of hours available for work on a given day.
   * This is the core calculation that subtracts all non-work time from the standard workday.
   * @param date The date to calculate available hours for.
   * @param context The day's specific deductions and flags.
   * @returns The number of available work hours.
   */
  async getAvailableHours(date: Date, context: DailyContext): Promise<number> {
    const dayOfWeek = date.getDay(); // Sunday = 0, Saturday = 6

    if (context.isPublicHoliday || dayOfWeek === 0 || dayOfWeek === 6) {
      return 0;
    }

    const workdayHours = await this.settingsService.getWorkdayHours();

    const available =
      workdayHours -
      context.vacationHours -
      context.meetingHours -
      context.existingWorklogHours;

    // Ensure available hours don't go below zero
    return Math.max(0, available);
  }
}

