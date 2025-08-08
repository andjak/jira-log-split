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
});

