import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueProviderService } from "./IssueProviderService";
import { JiraApiService } from "./JiraApiService";
import { SettingsService } from "./SettingsService";
import { JiraIssue } from "../core/jira-types";

function iso(d: string) {
  return new Date(`${d}T00:00:00.000Z`);
}
function dateFromJql(jql: string) {
  const m1 = jql.match(/updated >= "(\d{4}-\d{2}-\d{2})"/);
  // With open-ended activity JQL, there is no upper bound; keep parser tolerant
  return { start: m1?.[1], end: undefined };
}

describe("IssueProviderService period delta querying", () => {
  let jiraApiServiceMock: any;
  let settingsServiceMock: any;
  let service: IssueProviderService;

  beforeEach(() => {
    jiraApiServiceMock = {
      fetchIssuesMinimal: vi.fn(),
      fetchIssuesDetailedByKeys: vi.fn(),
      getCurrentUser: vi.fn().mockResolvedValue({ accountId: "me" }),
    } as unknown as JiraApiService;
    jiraApiServiceMock.fetchIssuesMinimalPaged = vi.fn(
      async (
        _jql: string,
        onPage: (issues: JiraIssue[], idx: number, pageSize: number) => any,
      ) => {
        await onPage([], 0, 100);
        return [];
      },
    );
    (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([]);

    settingsServiceMock = {
      get: vi.fn(async (k: string) =>
        k === "pipelinedPhase2Enabled"
          ? true
          : k === "includedProjects"
            ? []
            : k === "issueSource"
              ? "activity"
              : null,
      ),
    } as unknown as SettingsService;

    service = new IssueProviderService(jiraApiServiceMock, settingsServiceMock);
  });

  it("expanding last week -> last month queries only earlier start (open-ended to today)", async () => {
    // First: last week (2023-06-24 .. 2023-06-30)
    await service.getIssues({
      start: iso("2023-06-24"),
      end: iso("2023-06-30"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    const jql1 = jiraApiServiceMock.fetchIssuesMinimalPaged.mock
      .calls[0][0] as string;
    const d1 = dateFromJql(jql1);
    expect(d1.start).toBe("2023-06-24");
    expect(d1.end).toBeUndefined();

    // Expand to last month (2023-06-01 .. 2023-06-30). Should query only 2023-06-01 .. 2023-06-23
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    const jql2 = jiraApiServiceMock.fetchIssuesMinimalPaged.mock
      .calls[0][0] as string;
    const d2 = dateFromJql(jql2);
    expect(d2.start).toBe("2023-06-01");
    expect(d2.end).toBeUndefined();
  });

  it("shrinking last month -> last week requires no additional query", async () => {
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    await service.getIssues({
      start: iso("2023-06-24"),
      end: iso("2023-06-30"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).not.toHaveBeenCalled();
  });

  it("non-overlapping switch queries new start open-ended", async () => {
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    await service.getIssues({
      start: iso("2023-05-01"),
      end: iso("2023-05-31"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    const jql = jiraApiServiceMock.fetchIssuesMinimalPaged.mock
      .calls[0][0] as string;
    const d = dateFromJql(jql);
    expect(d.start).toBe("2023-05-01");
    expect(d.end).toBeUndefined();
  });

  it("remembers earlier periods and only queries earlier start; trailing already covered by first open-ended fetch", async () => {
    // 01 Jun - 30 Jun, then 01 May - 31 May
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    await service.getIssues({
      start: iso("2023-05-01"),
      end: iso("2023-05-31"),
    });
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    // Now 15 Jun - 15 Jul => only 01 Jul - 15 Jul should be queried
    await service.getIssues({
      start: iso("2023-06-15"),
      end: iso("2023-07-15"),
    });
    // With first fetch being open-ended from 2023-06-01, 2023-07-01..2023-07-15 is already covered
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).not.toHaveBeenCalled();
  });

  it("extending period end does not trigger new fetch (open-ended first fetch covers tail)", async () => {
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    await service.getIssues({
      start: iso("2023-06-15"),
      end: iso("2023-07-31"),
    });
    // No new fetch needed; tail is already covered by initial open-ended query
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).not.toHaveBeenCalled();
  });

  it("expansion around previous period queries only the leading earlier delta (open-ended covers trailing)", async () => {
    // First baseline: 01 Jun - 30 Jun
    await service.getIssues({
      start: iso("2023-06-01"),
      end: iso("2023-06-30"),
    });
    jiraApiServiceMock.fetchIssuesMinimalPaged.mockClear();
    // Expand to 01 May - 31 Jul: expect two calls, 01 May - 31 May and 01 Jul - 31 Jul
    await service.getIssues({
      start: iso("2023-05-01"),
      end: iso("2023-07-31"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).toHaveBeenCalledTimes(1);
    const call = dateFromJql(
      jiraApiServiceMock.fetchIssuesMinimalPaged.mock.calls[0][0] as string,
    );
    expect(call.start).toBe("2023-05-01");
  });

  it("shrinking to an already covered period returns computed results from cache without new queries", async () => {
    const me = "me-cache";
    const julyIssue: JiraIssue = {
      id: "1",
      key: "JUL-1",
      fields: {
        summary: "",
        issuetype: { iconUrl: "", name: "Task" },
        project: { key: "P", name: "P" },
        updated: "",
      },
      changelog: {
        histories: [
          {
            author: { accountId: me, displayName: "Me" },
            created: "2025-07-15T10:00:00.000Z",
            items: [
              {
                field: "status",
                fieldtype: "jira",
                fromString: "To Do",
                toString: "In Progress",
              },
            ],
          },
        ],
      },
    } as JiraIssue;

    // First build on a longer range that includes July and August, fetching issues
    (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
      accountId: me,
    });
    (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
      julyIssue,
    ]);
    (jiraApiServiceMock as any).fetchIssuesMinimalPaged.mockImplementationOnce(
      async (
        _jql: string,
        onPage: (issues: JiraIssue[], idx: number, pageSize: number) => any,
      ) => {
        await onPage(
          [
            {
              id: "1",
              key: "JUL-1",
              fields: {
                summary: "",
                issuetype: { iconUrl: "", name: "Task" },
                project: { key: "P", name: "P" },
                updated: "",
              },
            } as any,
          ],
          0,
          100,
        );
        return [];
      },
    );

    await service.getIssues({
      start: iso("2025-07-01"),
      end: iso("2025-08-13"),
    });

    // Now shrink to July only; expect no new minimal fetches, but still non-empty results
    (jiraApiServiceMock.fetchIssuesMinimalPaged as any).mockClear();

    const res = await service.getIssues({
      start: iso("2025-07-01"),
      end: iso("2025-07-31"),
    });
    expect(jiraApiServiceMock.fetchIssuesMinimalPaged).not.toHaveBeenCalled();
    // The cached JUL-1 has activity in July, so it should be returned
    expect(res.map((i) => i.key)).toContain("JUL-1");
  });
});
