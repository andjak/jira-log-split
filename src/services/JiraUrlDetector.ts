/**
 * Utilities to detect Jira base URL similarly to Jira Assistant.
 * Tries, in order: query string → cookies → open tabs → fallback.
 */

function normalizeBaseUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function isValidTenantHost(host: string): boolean {
  // Accept e.g. foo.atlassian.net or foo.jira.com (must have a non-empty subdomain)
  return (/^[a-z0-9-]+\.atlassian\.net$/i.test(host) || /^[a-z0-9-]+\.jira\.com$/i.test(host));
}

function extractFromQuery(queryString: string | null | undefined): string | null {
  if (!queryString) return null;
  try {
    const params = new URLSearchParams(queryString.startsWith('?') ? queryString : `?${queryString}`);
    const value = params.get('baseUrl');
    if (!value) return null;
    const origin = normalizeBaseUrl(value.replace(/\/$/, ''));
    if (!origin) return null;
    const host = new URL(origin).host;
    return isValidTenantHost(host) ? origin : null;
  } catch {
    return null;
  }
}

async function inferFromCookies(): Promise<string | null> {
  try {
    const allAtlassian: chrome.cookies.Cookie[] = [];
    for (const domain of ['atlassian.net', 'jira.com']) {
      const cookies = await chrome.cookies.getAll({ domain });
      if (cookies && cookies.length > 0) allAtlassian.push(...cookies);
    }

    if (allAtlassian.length === 0) return null;

    // Rank hosts: prefer <tenant>.atlassian.net, avoid api/id hosts, ignore bare apex domains
    const candidates = new Map<string, number>();
    for (const c of allAtlassian) {
      const host = (c.domain || '').replace(/^\./, '');
      if (!host) continue;
      if (!/(?:^|\.)((atlassian\.net)|(jira\.com))$/i.test(host) && !/(atlassian\.net|jira\.com)$/i.test(host)) {
        // For safety, only consider those two domains
      }
      if (!isValidTenantHost(host)) continue;
      if (/^(api\.|id\.)/i.test(host)) continue;
      candidates.set(host, (candidates.get(host) || 0) + 1);
    }

    if (candidates.size === 0) return null;

    // Pick the host with most cookies as a simple signal of the active site
    let bestHost = '';
    let bestCount = -1;
    for (const [host, count] of candidates.entries()) {
      if (count > bestCount) {
        bestHost = host;
        bestCount = count;
      }
    }
    return bestHost ? `https://${bestHost}` : null;
  } catch {
    return null;
  }
}

async function inferFromTabs(): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const url = tab.url || '';
      if (!url) continue;
      if (/^https?:\/\/[^/]+\.(atlassian\.net|jira\.com)\//i.test(url)) {
        const base = normalizeBaseUrl(url);
        if (base) {
          const host = new URL(base).host;
          if (isValidTenantHost(host)) return base;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function detectJiraBaseUrl(options?: { queryString?: string }): Promise<string> {
  const fromQuery = extractFromQuery(options?.queryString);
  if (fromQuery) return fromQuery;

  const fromCookies = await inferFromCookies();
  if (fromCookies) return fromCookies;

  const fromTabs = await inferFromTabs();
  if (fromTabs) return fromTabs;

  return 'https://example.atlassian.net';
}

export const __testUtils = {
  normalizeBaseUrl,
  extractFromQuery,
  isValidTenantHost,
};


