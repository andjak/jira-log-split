import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __testUtils, detectJiraBaseUrl } from './JiraUrlDetector';

describe('JiraUrlDetector', () => {
  describe('normalizeBaseUrl', () => {
    it('extracts origin', () => {
      expect(__testUtils.normalizeBaseUrl('https://foo.atlassian.net/browse/ABC-1'))
        .toBe('https://foo.atlassian.net');
    });
    it('returns null for invalid', () => {
      expect(__testUtils.normalizeBaseUrl('not-a-url')).toBeNull();
    });
  });

  describe('extractFromQuery', () => {
    it('returns baseUrl from query', () => {
      expect(__testUtils.extractFromQuery('?baseUrl=https://acme.atlassian.net/'))
        .toBe('https://acme.atlassian.net');
    });
    it('returns null when not present', () => {
      expect(__testUtils.extractFromQuery('?x=1')).toBeNull();
    });
  });

  describe('detectJiraBaseUrl', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      vi.stubGlobal('chrome', {
        cookies: {
          getAll: vi.fn().mockResolvedValue([]),
        },
        tabs: {
          query: vi.fn().mockResolvedValue([]),
        },
      });
    });

    it('prefers query string when provided', async () => {
      const url = await detectJiraBaseUrl({ queryString: '?baseUrl=https://zeta.atlassian.net' });
      expect(url).toBe('https://zeta.atlassian.net');
    });

    it('ignores invalid query origins (marketing apex) and falls back', async () => {
      (global as any).chrome.cookies.getAll.mockResolvedValue([]);
      (global as any).chrome.tabs.query.mockResolvedValue([]);
      const url = await detectJiraBaseUrl({ queryString: '?baseUrl=https://atlassian.net' });
      expect(url).toBe('https://example.atlassian.net');
    });

    it('picks a tenant host from cookies, ignoring apex and api/id subdomains', async () => {
      (global as any).chrome.cookies.getAll
        .mockResolvedValueOnce([
          { domain: '.atlassian.net' },
          { domain: '.api.atlassian.net' },
          { domain: '.foo.atlassian.net' },
          { domain: '.foo.atlassian.net' },
        ])
        .mockResolvedValueOnce([]);
      const url = await detectJiraBaseUrl();
      expect(url).toBe('https://foo.atlassian.net');
    });

    it('falls back to cookies then tabs then default', async () => {
      // No query, cookies, or tabs
      const url = await detectJiraBaseUrl();
      expect(url).toBe('https://example.atlassian.net');
    });

    it('picks host from cookies list, preferring tenant host over api/id or apex', async () => {
      (global as any).chrome.cookies.getAll.mockImplementation(async ({ domain }: any) => {
        if (domain === 'atlassian.net') {
          return [
            { domain: '.atlassian.net' },
            { domain: '.api.atlassian.net' },
            { domain: '.foo.atlassian.net' },
            { domain: '.foo.atlassian.net' },
          ];
        }
        return [];
      });
      const url = await detectJiraBaseUrl();
      expect(url).toBe('https://foo.atlassian.net');
    });

    it('picks host from tabs when cookies are empty', async () => {
      (global as any).chrome.cookies.getAll.mockResolvedValue([]);
      (global as any).chrome.tabs.query.mockResolvedValue([
        { url: 'https://bar.atlassian.net/browse/XYZ-1' },
      ]);
      const url = await detectJiraBaseUrl();
      expect(url).toBe('https://bar.atlassian.net');
    });
  });
});


