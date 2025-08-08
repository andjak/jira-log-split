// src/services/SettingsService.ts
import { AppSettings, DEFAULT_SETTINGS } from '../core/app-types';

type StorageKey = keyof AppSettings;

export class SettingsService {
  /**
   * Retrieves a specific setting's value.
   * If the value is not set in storage, it returns the default value.
   * @param key The setting to retrieve.
   */
  public async get<K extends StorageKey>(key: K): Promise<AppSettings[K]> {
    const data = await chrome.storage.local.get(key);
    return data[key] ?? DEFAULT_SETTINGS[key];
  }

  /**
   * Sets a new value for a specific setting.
   * @param key The setting to update.
   * @param value The new value for the setting.
   */
  public async set<K extends StorageKey>(key: K, value: AppSettings[K]): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  /**
   * A convenience method to get the configured workday hours.
   */
  public getWorkdayHours(): Promise<number> {
    return this.get('workdayHours');
  }
}

