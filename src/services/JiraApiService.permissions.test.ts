import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraApiService } from './JiraApiService';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('JiraApiService permissions caching', () => {
  let storageState: Record<string, any>;

  beforeEach(() => {
    vi.resetAllMocks();
    storageState = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          async get(keys: any) {
            if (!keys) return { ...storageState };
            if (Array.isArray(keys)) {
              const out: any = {};
              for (const k of keys) out[k] = storageState[k];
              return out;
            }
            if (typeof keys === 'string') return { [keys]: storageState[keys] };
            if (typeof keys === 'object') {
              const out: any = {};
              for (const [k, defVal] of Object.entries(keys)) out[k] = storageState[k] ?? defVal;
              return out;
            }
            return {};
          },
          async set(obj: any) {
            Object.assign(storageState, obj);
          },
        },
      },
    });
    (global as any).fetch = fetchMock;
    vi.spyOn(Date, 'now').mockReturnValue(0);
  });

  it('caches project permissions for a short time window', async () => {
    const svc = new JiraApiService('https://acme.atlassian.net');

    // project/search (single page)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ values: [{ id: '1', key: 'P1' }, { id: '2', key: 'P2' }], isLast: true }) })
      // mypermissions for P1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ permissions: { ADD_COMMENTS: { havePermission: true } } }) })
      // mypermissions for P2
      .mockResolvedValueOnce({ ok: true, json: async () => ({ permissions: { ADD_COMMENTS: { havePermission: false } } }) });

    const first = await svc.getProjectsWhereUserHasAnyPermission(['ADD_COMMENTS']);
    expect(first).toEqual(['P1']);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Advance time within TTL (5 minutes)
    vi.spyOn(Date, 'now').mockReturnValue(5 * 60 * 1000);

    const second = await svc.getProjectsWhereUserHasAnyPermission(['ADD_COMMENTS']);
    expect(second).toEqual(['P1']);
    // No additional fetch calls due to cache
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refreshes cache after TTL expiry', async () => {
    const svc = new JiraApiService('https://acme.atlassian.net');

    // Seed cache manually with old timestamp
    storageState['adaptivePermissionsCache'] = {
      'acme.atlassian.net::ADD_COMMENTS': { ts: 0, keys: ['OLD'] },
    };

    // After TTL, service should re-fetch
    vi.spyOn(Date, 'now').mockReturnValue(60 * 60 * 1000); // 60 minutes

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ values: [{ id: '7', key: 'NEW' }], isLast: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ permissions: { ADD_COMMENTS: { havePermission: true } } }) });

    const res = await svc.getProjectsWhereUserHasAnyPermission(['ADD_COMMENTS']);
    expect(res).toEqual(['NEW']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


