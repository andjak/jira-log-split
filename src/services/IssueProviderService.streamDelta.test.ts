import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueProviderService } from "./IssueProviderService";
import { JiraApiService } from "./JiraApiService";
import { SettingsService } from "./SettingsService";

type AnyIssue = any;

function makeIssue(key: string, iso: string): AnyIssue {
  return {
    key,
    fields: {
      summary: key,
      issuetype: { name: "Story" },
      updated: iso,
      comment: { comments: [] },
    },
    changelog: {
      histories: [
        {
          author: { accountId: "me" },
          created: iso,
          items: [{ field: "status" }],
        },
      ],
    },
  };
}

describe("IssueProviderService streaming period changes", () => {
  let jira: JiraApiService;
  let settings: SettingsService;
  let svc: IssueProviderService;

  beforeEach(() => {
    settings = new SettingsService();
    jira = new JiraApiService("https://example.atlassian.net", settings);
    svc = new IssueProviderService(jira, settings);
    vi.spyOn(jira, "getCurrentUser").mockResolvedValue({
      accountId: "me",
    } as any);
    // Avoid accessing chrome storage in tests
    vi.spyOn(settings as any, "get").mockImplementation(
      async (...args: any[]) => {
        const key = args[0] as string;
        if (key === "includedProjects") return [] as any;
        if (key === "pipelinedPhase2Enabled") return true as any;
        return undefined as any;
      },
    );
  });

  it("shrinking period keeps still-covered items and removes out-of-range without network", async () => {
    // Seed cache with two issues: one inside new period, one outside
    (svc as any).allFetchedIssues = [
      makeIssue("OLD-IN", "2025-08-10T10:00:00.000Z"),
      makeIssue("OLD-OUT", "2025-08-20T10:00:00.000Z"),
    ];
    // fetched previously covered the whole month
    (svc as any).fetchedRanges = [{ start: "2025-08-01", end: "2025-08-31" }];

    const updates: AnyIssue[][] = [];
    const minimalPaged = vi
      .spyOn(jira as any, "fetchIssuesMinimalPaged")
      .mockResolvedValue([]);

    const result = await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-08-01T00:00:00Z"),
        end: new Date("2025-08-15T23:59:59Z"),
      },
      (iss) => updates.push(iss),
    );

    // No network calls for minimal phase
    expect(minimalPaged).not.toHaveBeenCalled();
    // Streaming should serve from cache with only OLD-IN
    expect(result.map((i: AnyIssue) => i.key)).toEqual(["OLD-IN"]);
    expect(updates.length).toBe(1);
    expect(updates[0].map((i) => i.key)).toEqual(["OLD-IN"]);
  });

  it("expanding period adds newly found items while keeping previous and avoiding duplicates", async () => {
    // Pre-existing cache
    (svc as any).allFetchedIssues = [
      makeIssue("OLD-1", "2025-08-10T10:00:00.000Z"),
    ];
    (svc as any).fetchedRanges = [{ start: "2025-08-01", end: "2025-08-13" }];

    // New delta will be 2025-07-24..2025-07-31
    const minimalPaged = vi
      .spyOn(jira as any, "fetchIssuesMinimalPaged")
      .mockImplementation(async (...args: any[]) => {
        const onPage = args[1];
        await onPage(
          [{ key: "NEW-1" }, { key: "OLD-1" }] as AnyIssue[],
          0,
          100,
          2,
        );
        return [];
      });
    vi.spyOn(jira, "fetchIssuesDetailedByKeys").mockImplementation(
      async (keys: string[], opts?: any) => {
        const details = keys.map((k) =>
          k === "NEW-1"
            ? makeIssue("NEW-1", "2025-07-28T09:00:00.000Z")
            : makeIssue("OLD-1", "2025-08-10T10:00:00.000Z"),
        );
        if (opts?.onBatch) await opts.onBatch(details);
        return details as any;
      },
    );

    const updates: AnyIssue[][] = [];
    const result = await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-07-24T00:00:00Z"),
        end: new Date("2025-08-13T23:59:59Z"),
      },
      (iss) => updates.push(iss),
    );

    expect(minimalPaged).toHaveBeenCalled();
    // Final set should include OLD-1 (from cache) and NEW-1 (from delta), without duplicate OLD-1
    const keys = result.map((i: AnyIssue) => i.key);
    expect(keys.sort()).toEqual(["NEW-1", "OLD-1"]);
    // At least one update should include both
    const anyBoth = updates.some(
      (u) =>
        u
          .map((i) => i.key)
          .sort()
          .join(",") === "NEW-1,OLD-1",
    );
    expect(anyBoth).toBe(true);
  });

  it("single-day streaming period yields results (end-exclusive JQL)", async () => {
    // Arrange: 2025-08-05 only
    const minimalPaged = vi
      .spyOn(jira as any, "fetchIssuesMinimalPaged")
      .mockImplementation(async (...args: any[]) => {
        const onPage = args[1];
        // Simulate Jira returning 1 minimal issue for that day
        await onPage([{ key: "D1" }], 0, 100, 1);
        return [];
      });
    vi.spyOn(jira, "fetchIssuesDetailedByKeys").mockImplementation(
      async (keys: string[], opts?: any) => {
        const details = keys.map(() =>
          makeIssue("D1", "2025-08-05T12:00:00.000Z"),
        ) as AnyIssue[];
        if (opts?.onBatch) await opts.onBatch(details);
        return details as any;
      },
    );

    const updates: AnyIssue[][] = [];
    const result = await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-08-05T00:00:00Z"),
        end: new Date("2025-08-05T23:59:59Z"),
      },
      (iss) => updates.push(iss),
    );

    expect(minimalPaged).toHaveBeenCalled();
    expect(result.map((i: AnyIssue) => i.key)).toEqual(["D1"]);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("single-day after wider fetch is still served correctly from cache", async () => {
    // 1) Initial: 2025-08-01 only — minimal returns empty on purpose (simulating the user’s earlier repro)
    vi.spyOn(jira as any, "fetchIssuesMinimalPaged").mockImplementationOnce(
      async (...args: any[]) => {
        const onPage = args[1];
        await onPage([], 0, 100, 0);
        return [];
      },
    );
    vi.spyOn(jira, "fetchIssuesDetailedByKeys").mockResolvedValue([] as any);

    await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-08-01T00:00:00Z"),
        end: new Date("2025-08-01T23:59:59Z"),
      },
      () => {},
    );

    // 2) Next: 2025-08-01..2025-08-05 — now minimal returns one issue for 2025-08-01 in one of the pages
    (jira as any).fetchIssuesMinimalPaged.mockImplementationOnce(
      async (...args: any[]) => {
        const onPage = args[1];
        await onPage([{ key: "K-1" }], 0, 100, 1);
        return [];
      },
    );
    vi.spyOn(jira, "fetchIssuesDetailedByKeys").mockImplementationOnce(
      async (_keys: string[], opts?: any) => {
        const det = [makeIssue("K-1", "2025-08-01T08:00:00.000Z")];
        if (opts?.onBatch) await opts.onBatch(det);
        return det as any;
      },
    );

    await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-08-01T00:00:00Z"),
        end: new Date("2025-08-05T23:59:59Z"),
      },
      () => {},
    );

    // 3) Finally: 2025-08-01 again — should be served from cache and include K-1
    const updates: AnyIssue[][] = [];
    (jira as any).fetchIssuesMinimalPaged.mockClear();
    const res = await svc.getIssuesByActivityStream(
      {
        start: new Date("2025-08-01T00:00:00Z"),
        end: new Date("2025-08-01T23:59:59Z"),
      },
      (iss) => updates.push(iss),
    );

    expect((jira as any).fetchIssuesMinimalPaged).not.toHaveBeenCalled();
    const keys = res.map((i: AnyIssue) => i.key);
    expect(keys).toEqual(["K-1"]);
    expect(updates.length).toBe(1);
    expect(updates[0].map((i) => i.key)).toEqual(["K-1"]);
  });
});
