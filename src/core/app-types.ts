// src/core/app-types.ts

/**
 * Defines the shape of all user-configurable settings for the extension.
 */
export interface AppSettings {
  workdayHours: number;
  defaultPeriod: 'thisWeek' | 'prevWeek' | 'thisMonth' | 'prevMonth';
  showMeetings: boolean;
  excludedIssueTypes: string[];
  excludedProjects: string[];
  issueSource: 'myProfile' | 'activity';
  initialDistribution: 'even' | 'activity' | 'none';
  submissionStartHourUTC: number;
}

/**
 * Default values for all application settings.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  workdayHours: 8,
  defaultPeriod: 'thisMonth',
  showMeetings: true,
  excludedIssueTypes: ['Epic'],
  excludedProjects: [],
  issueSource: 'activity',
  initialDistribution: 'even',
  submissionStartHourUTC: 9,
};

/**
 * Represents the context for a single day, containing all information
 * needed to calculate available work hours.
 */
export interface DailyContext {
  vacationHours: number;
  meetingHours: number;
  existingWorklogHours: number;
  isPublicHoliday: boolean;
}

// Additional types for distribution logic
export type DayISO = string; // e.g., "2023-10-01"

export type DailyAvailability = Record<DayISO, number>; // hours available per day

export type WorklogSchedule = Record<string, Record<DayISO, number>>; // issueKey -> day -> minutes


