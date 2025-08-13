import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from './SettingsService';
import { DEFAULT_SETTINGS } from '../core/app-types';

// Mock the chrome.storage API
const storageMock = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
};
vi.stubGlobal('chrome', { storage: storageMock });

describe('SettingsService', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    settingsService = new SettingsService();
  });

  describe('get', () => {
    it('should return the default value if none is in storage', async () => {
      // Arrange
      storageMock.local.get.mockResolvedValue({});

      // Act
      const hours = await settingsService.get('workdayHours');

      // Assert
      expect(hours).toBe(DEFAULT_SETTINGS.workdayHours);
      expect(storageMock.local.get).toHaveBeenCalledWith('workdayHours');
    });

    it('should return the stored value if it exists', async () => {
      // Arrange
      storageMock.local.get.mockResolvedValue({ workdayHours: 7.5 });

      // Act
      const hours = await settingsService.get('workdayHours');

      // Assert
      expect(hours).toBe(7.5);
    });
  });

  describe('set', () => {
    it('should correctly save a value to storage', async () => {
      // Act
      await settingsService.set('defaultPeriod', 'prevMonth');

      // Assert
      expect(storageMock.local.set).toHaveBeenCalledWith({ defaultPeriod: 'prevMonth' });
    });
  });

  describe('submissionStartHourUTC', () => {
    it('returns default 9 when unset', async () => {
      storageMock.local.get.mockResolvedValue({});
      const hour = await settingsService.get('submissionStartHourUTC');
      expect(hour).toBe(9);
    });

    it('can be set and retrieved', async () => {
      await settingsService.set('submissionStartHourUTC', 10);
      expect(storageMock.local.set).toHaveBeenCalledWith({ submissionStartHourUTC: 10 });
    });
  });

  describe('includedProjects', () => {
    it('returns default [] when unset', async () => {
      storageMock.local.get.mockResolvedValue({});
      const projects = await settingsService.get('includedProjects');
      expect(projects).toEqual([]);
      expect(storageMock.local.get).toHaveBeenCalledWith('includedProjects');
    });

    it('can be set and retrieved', async () => {
      await settingsService.set('includedProjects', ['A', 'B']);
      expect(storageMock.local.set).toHaveBeenCalledWith({ includedProjects: ['A', 'B'] });

      storageMock.local.get.mockResolvedValue({ includedProjects: ['A', 'B'] });
      const projects = await settingsService.get('includedProjects');
      expect(projects).toEqual(['A', 'B']);
    });
  });
});

