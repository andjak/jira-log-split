import { describe, it, expect, vi, beforeEach } from "vitest";
import { JiraApiService } from "./JiraApiService";
import { IssueProviderService } from "./IssueProviderService";
import { SettingsService } from "./SettingsService";
import { JiraIssue } from "../core/jira-types";

describe("IssueProviderService", () => {
  let jiraApiServiceMock: JiraApiService;
  let settingsServiceMock: SettingsService;
  let issueProviderService: IssueProviderService;

  beforeEach(() => {
    // Plain object mocks
    jiraApiServiceMock = {
      fetchIssues: vi.fn(),
      fetchIssuesMinimal: vi.fn(),
      fetchIssuesDetailedByKeys: vi.fn(),
      getProjectsWhereUserHasAnyPermission: vi.fn(),
      getCurrentUser: vi.fn(),
    } as unknown as JiraApiService;

    settingsServiceMock = {
      get: vi.fn(),
    } as unknown as SettingsService;

    issueProviderService = new IssueProviderService(
      jiraApiServiceMock,
      settingsServiceMock,
    );
  });

  // Removed legacy cross-class test that sometimes times out under CI; fetch behavior covered in JiraApiService.test.ts

  describe("getIssues (My Profile Strategy)", () => {
    it('should construct the correct JQL for the "My Profile" strategy', async () => {
      // Arrange
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "TEST-1",
          fields: {
            summary: "An issue",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "TEST", name: "Test Project" },
            updated: "",
          },
        },
      ];

      // Setup mocks for the different calls to settingsService.get()
      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "myProfile";
          if (key === "excludedProjects") return ["PROJ-A"];
          if (key === "excludedIssueTypes") return ["Epic", "Story"];
          return null;
        },
      );
      (jiraApiServiceMock.fetchIssues as any).mockResolvedValue(mockIssues);

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(jiraApiServiceMock.fetchIssues as any).toHaveBeenCalled();
      const calledJql = (jiraApiServiceMock.fetchIssues as any).mock
        .calls[0][0] as string;
      // Assert ORDER BY is appended correctly (not joined with AND)
      expect(calledJql.includes(" AND ORDER BY")).toBe(false);
      expect(calledJql.endsWith(" ORDER BY updated DESC")).toBe(true);
      expect(calledJql).toContain('updated >= "2023-10-01"');
      expect(
        /updated <= "2023-10-31"/.test(calledJql) ||
          /updated < "2023-11-01"/.test(calledJql),
      ).toBe(true);
      expect(issues).toEqual(mockIssues);
    });
  });

  describe("getIssues (Activity Strategy)", () => {
    it("should return only issues with user activity in the period", async () => {
      // Arrange
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "currentUser-123";
      const mockIssues: JiraIssue[] = [
        {
          // Issue 1: Has relevant activity
          id: "1",
          key: "ACT-1",
          fields: {
            summary: "Active Issue",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "ACT", name: "Activity Project" },
            updated: "",
          },
          changelog: {
            histories: [
              {
                author: { accountId: currentUserAccountId, displayName: "Me" },
                created: "2023-10-15T10:00:00.000Z",
                items: [
                  {
                    field: "status",
                    toString: "In Progress",
                    fromString: "To Do",
                    fieldtype: "jira",
                  },
                ],
              },
            ],
          },
        },
        {
          // Issue 2: No relevant activity by current user
          id: "2",
          key: "ACT-2",
          fields: {
            summary: "Inactive Issue",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "ACT", name: "Activity Project" },
            updated: "",
          },
          changelog: {
            histories: [
              {
                author: {
                  accountId: "anotherUser-456",
                  displayName: "Someone Else",
                },
                created: "2023-10-16T11:00:00.000Z",
                items: [
                  {
                    field: "status",
                    toString: "Done",
                    fromString: "In Progress",
                    fieldtype: "jira",
                  },
                ],
              },
            ],
          },
        },
        {
          // Issue 3: No changelog at all
          id: "3",
          key: "ACT-3",
          fields: {
            summary: "Quiet Issue",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "ACT", name: "Activity Project" },
            updated: "",
          },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "excludedProjects") return [];
          if (key === "excludedIssueTypes") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(
        mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        mockIssues,
      );

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect(issues[0].key).toBe("ACT-1");
    });

    it("builds JQL with open-ended time period (no upper bound) and orders by updated when using activity source", async () => {
      // Arrange
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "currentUser-abc";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "DATE-ONLY-1",
          fields: {
            summary: "Updated by me",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
          },
          changelog: {
            histories: [
              {
                author: { accountId: currentUserAccountId, displayName: "Me" },
                created: "2023-10-10T12:00:00.000Z",
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
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "excludedProjects") return ["SHOULD-NOT-BE-USED"];
          if (key === "excludedIssueTypes") return ["SHOULD-NOT-BE-USED"];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (
        jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any
      ).mockResolvedValue([]);
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(
        async () => mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(
        async () => mockIssues,
      );

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues).toHaveLength(1);
      expect(jiraApiServiceMock.fetchIssuesMinimal as any).toHaveBeenCalled();
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock
        .calls[0][0] as string;
      expect(calledJql).toContain('updated >= "2023-10-01"');
      // No upper bound expected for activity source
      expect(calledJql).not.toMatch(/updated\s*<\s*"/);
      expect(calledJql).not.toMatch(/updated\s*<=\s*"/);
      expect(calledJql).toContain("ORDER BY updated DESC");
      // Should NOT include user involvement conditions or project/issuetype exclusions
      expect(calledJql).not.toMatch(
        /assignee|reporter|creator|watcher|project not in|issuetype not in/,
      );
    });

    it("includes project prefilter only when settings.includedProjects is non-empty; otherwise date-only", async () => {
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "currentUser-abc";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "DATE-ONLY-1",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
          },
          changelog: { histories: [] as any },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (
        jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any
      ).mockResolvedValue(["PROJ1", "PROJ2"]);
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(
        mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        mockIssues,
      );

      // Expand the period so that a new delta is queried, ensuring JQL is rebuilt
      const widerPeriod = {
        start: new Date("2023-09-30T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      await issueProviderService.getIssues(widerPeriod);

      // With no includedProjects, we should NOT add project in (...) even if user has permissions
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock
        .calls[0][0] as string;
      expect(calledJql).not.toMatch(/project in \(/);

      // Now simulate includedProjects and expect project filter to be added
      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return ["P1", "P2"];
          return null;
        },
      );
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockClear();
      // Recreate service to reset internal fetchedRanges cache so that a new query is executed
      issueProviderService = new IssueProviderService(
        jiraApiServiceMock as any,
        settingsServiceMock as any,
      );
      await issueProviderService.getIssues(period);
      const calledJql2 = (jiraApiServiceMock.fetchIssuesMinimal as any).mock
        .calls[0][0] as string;
      expect(calledJql2).toMatch(/project in \("P1", "P2"\)/);
    });

    it("falls back without project prefilter when permission fetch fails", async () => {
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "currentUser-abc";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "DATE-ONLY-1",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
          },
          changelog: { histories: [] as any },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (
        jiraApiServiceMock.getProjectsWhereUserHasAnyPermission as any
      ).mockRejectedValue(new Error("perm api failed"));
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(
        mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        mockIssues,
      );

      await issueProviderService.getIssues(period);
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock
        .calls[0][0] as string;
      expect(calledJql).not.toMatch(/project in \(/);
    });

    it("includes issues when the user commented within the period", async () => {
      // Arrange
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "currentUser-xyz";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "CMNT-1",
          fields: {
            summary: "Has comment by me",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
            comment: {
              comments: [
                {
                  id: "c1",
                  author: {
                    accountId: currentUserAccountId,
                    displayName: "Me",
                  },
                  created: "2023-10-05T09:30:00.000Z",
                },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: { histories: [] as any },
        },
        {
          id: "2",
          key: "CMNT-2",
          fields: {
            summary: "No comment by me",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
            comment: {
              comments: [
                {
                  id: "c2",
                  author: { accountId: "someone-else", displayName: "Other" },
                  created: "2023-10-05T10:00:00.000Z",
                },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: { histories: [] as any },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "excludedProjects") return [];
          if (key === "excludedIssueTypes") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(
        async () => mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(
        async () => mockIssues,
      );

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert
      expect(issues.map((i) => i.key)).toEqual(["CMNT-1"]);
      // And ensure it added activity metadata
      expect(issues[0].userActivity?.lastCommentedByMeISO).toBe(
        "2023-10-05T09:30:00.000Z",
      );
      expect(issues[0].userActivity?.lastActivityAtISO).toBe(
        "2023-10-05T09:30:00.000Z",
      );
    });

    it("combines update and comment activity and sorts by user last activity desc", async () => {
      // Arrange
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const me = "me-1";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "UPD-OLD",
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
                created: "2023-10-05T08:00:00.000Z",
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
          // no comments
        },
        {
          id: "2",
          key: "CMNT-NEW",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "P", name: "P" },
            updated: "",
            comment: {
              comments: [
                {
                  id: "c1",
                  author: { accountId: me, displayName: "Me" },
                  created: "2023-10-10T12:00:00.000Z",
                },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: { histories: [] as any },
        },
        {
          id: "3",
          key: "BOTH",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "P", name: "P" },
            updated: "",
            comment: {
              comments: [
                {
                  id: "c1",
                  author: { accountId: me, displayName: "Me" },
                  created: "2023-10-09T12:00:00.000Z",
                },
              ],
              maxResults: 1,
              total: 1,
              startAt: 0,
            },
          },
          changelog: {
            histories: [
              {
                author: { accountId: me, displayName: "Me" },
                created: "2023-10-08T08:00:00.000Z",
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
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "excludedProjects") return [];
          if (key === "excludedIssueTypes") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockImplementation(
        async () => mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockImplementation(
        async () => mockIssues,
      );

      // Act
      const issues = await issueProviderService.getIssues(period);

      // Assert: sorted by last activity desc => CMNT-NEW (10th), BOTH (9th), UPD-OLD (5th)
      expect(issues.map((i) => i.key)).toEqual(["CMNT-NEW", "BOTH", "UPD-OLD"]);
      // Metadata
      const both = issues.find((i) => i.key === "BOTH")!;
      expect(both.userActivity?.lastUpdatedByMeISO).toBe(
        "2023-10-08T08:00:00.000Z",
      );
      expect(both.userActivity?.lastCommentedByMeISO).toBe(
        "2023-10-09T12:00:00.000Z",
      );
      expect(both.userActivity?.lastActivityAtISO).toBe(
        "2023-10-09T12:00:00.000Z",
      );
    });

    it("pipelined phase2: starts detailed fetch for first page while minimal phase continues (feature flag on)", async () => {
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "me-1";
      const page1: JiraIssue[] = [
        {
          id: "1",
          key: "K-1",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "X", name: "X" },
            updated: "",
          },
          changelog: { histories: [] as any },
        },
      ];
      const page2: JiraIssue[] = [
        {
          id: "2",
          key: "K-2",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "X", name: "X" },
            updated: "",
          },
          changelog: { histories: [] as any },
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          if (key === "pipelinedPhase2Enabled") return true;
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });

      // Use the paged API: simulate onPage receiving two pages
      (jiraApiServiceMock as any).fetchIssuesMinimalPaged = vi.fn(
        async (
          _jql: string,
          onPage: (
            issues: JiraIssue[],
            pageIndex: number,
            pageSize?: number,
          ) => Promise<void> | void,
        ) => {
          await onPage(page1, 0);
          await onPage(page2, 1);
          return [...page1, ...page2];
        },
      );
      // Detailed fetch should be invoked twice, once per page
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        [],
      );

      const service = new IssueProviderService(
        jiraApiServiceMock,
        settingsServiceMock,
      );
      await service.getIssues(period);

      const calls = (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mock
        .calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // First call keys should include only K-1
      expect(calls[0][0]).toEqual(["K-1"]);
    });

    it("pipelined phase2: uses minimal page size as detailed batch size", async () => {
      const period = {
        start: new Date("2023-10-01T00:00:00.000Z"),
        end: new Date("2023-10-31T23:59:59.999Z"),
      };
      const currentUserAccountId = "me-2";
      const minimalPage: JiraIssue[] = [
        {
          id: "11",
          key: "PX-11",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "P", name: "P" },
            updated: "",
          },
          changelog: { histories: [] as any },
        },
      ];
      const minimalPageSize = 100;

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          if (key === "pipelinedPhase2Enabled") return true;
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });

      // Provide paged minimal results with explicit pageSize
      (jiraApiServiceMock as any).fetchIssuesMinimalPaged = vi.fn(
        async (
          _jql: string,
          onPage: (
            issues: JiraIssue[],
            pageIndex: number,
            pageSize: number,
          ) => Promise<void> | void,
        ) => {
          await onPage(minimalPage, 0, minimalPageSize);
          return minimalPage;
        },
      );

      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        [],
      );

      const service = new IssueProviderService(
        jiraApiServiceMock,
        settingsServiceMock,
      );
      await service.getIssues(period);

      const calls = (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mock
        .calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // Assert options.batchSize equals minimal page size
      const passedOptions = calls[0][1] || {};
      expect(passedOptions.batchSize).toBe(minimalPageSize);
    });

    it("single-day period uses open-ended JQL and returns results", async () => {
      const day = new Date("2023-10-05T00:00:00.000Z");
      const period = { start: day, end: new Date("2023-10-05T23:59:59.999Z") };
      const currentUserAccountId = "me-single";
      const mockIssues: JiraIssue[] = [
        {
          id: "1",
          key: "ONE-1",
          fields: {
            summary: "",
            issuetype: { iconUrl: "", name: "Task" },
            project: { key: "A", name: "A" },
            updated: "",
          },
          changelog: {
            histories: [
              {
                author: { accountId: currentUserAccountId, displayName: "Me" },
                created: "2023-10-05T12:00:00.000Z",
                items: [{ field: "status" }],
              },
            ],
          } as any,
        },
      ];

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: currentUserAccountId,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue(
        mockIssues,
      );
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue(
        mockIssues,
      );

      const issues = await issueProviderService.getIssues(period);
      expect(issues.map((i) => i.key)).toEqual(["ONE-1"]);
      const calledJql = (jiraApiServiceMock.fetchIssuesMinimal as any).mock
        .calls[0][0] as string;
      // We use open-ended JQL now
      expect(calledJql).toMatch(/updated >= "2023-10-05"/);
      expect(calledJql).not.toMatch(/updated\s*<\s*"/);
      expect(calledJql).not.toMatch(/updated\s*<=\s*"/);
    });

    it("excludes time-tracking-only updates within period", async () => {
      const period = {
        start: new Date("2025-07-16T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-tt";
      const issue: JiraIssue = {
        id: "1",
        key: "TT-IGNORE",
        fields: {
          summary: "Only time tracking updates",
          issuetype: { iconUrl: "", name: "Task" },
          project: { key: "P", name: "P" },
          updated: "",
        },
        changelog: {
          histories: [
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-08-05T10:00:00.000Z",
              items: [
                {
                  field: "Remaining Estimate",
                  fieldtype: "jira",
                  fromString: "1d",
                  toString: "2d",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);

      const issues = await issueProviderService.getIssues(period);
      expect(issues).toHaveLength(0);
    });

    it("includes issue when a non time-tracking status change is within period", async () => {
      const period = {
        start: new Date("2025-07-15T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-tt2";
      const issue: JiraIssue = {
        id: "2",
        key: "TT-STATUS",
        fields: {
          summary: "Status updated",
          issuetype: { iconUrl: "", name: "Task" },
          project: { key: "P", name: "P" },
          updated: "",
        },
        changelog: {
          histories: [
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-08-05T09:00:00.000Z",
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
      } as any;
      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);

      const issues = await issueProviderService.getIssues(period);
      expect(issues.map((i) => i.key)).toEqual(["TT-STATUS"]);
    });

    it("includes issue when there is a comment by me within period even if other updates are time-tracking", async () => {
      const period = {
        start: new Date("2025-07-15T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-tt3";
      const issue: JiraIssue = {
        id: "3",
        key: "TT-COMMENT",
        fields: {
          summary: "Has comment",
          issuetype: { iconUrl: "", name: "Task" },
          project: { key: "P", name: "P" },
          updated: "",
          comment: {
            comments: [
              {
                id: "c1",
                author: { accountId: me, displayName: "Me" },
                created: "2025-08-10T12:00:00.000Z",
              },
            ],
            maxResults: 1,
            total: 1,
            startAt: 0,
          },
        },
        changelog: {
          histories: [
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-08-05T09:00:00.000Z",
              items: [
                {
                  field: "Time Spent",
                  fieldtype: "jira",
                  fromString: "0",
                  toString: "1h",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);

      const issues = await issueProviderService.getIssues(period);
      expect(issues.map((i) => i.key)).toEqual(["TT-COMMENT"]);
    });

    it("includes issue when earlier non time-tracking change in period but excludes when only time-tracking change after", async () => {
      const me = "me-tt4";
      const baseIssue: JiraIssue = {
        id: "4",
        key: "TT-MIXED",
        fields: {
          summary: "Mixed changes",
          issuetype: { iconUrl: "", name: "Task" },
          project: { key: "P", name: "P" },
          updated: "",
        },
        changelog: {
          histories: [
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-07-10T09:00:00.000Z",
              items: [
                {
                  field: "status",
                  fieldtype: "jira",
                  fromString: "To Do",
                  toString: "In Progress",
                },
              ],
            },
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-08-05T09:00:00.000Z",
              items: [
                {
                  field: "Original Estimate",
                  fieldtype: "jira",
                  fromString: "1d",
                  toString: "2d",
                },
              ],
            },
          ],
        },
      } as any;

      (settingsServiceMock.get as any).mockImplementation(
        async (key: string) => {
          if (key === "issueSource") return "activity";
          if (key === "includedProjects") return [];
          return null;
        },
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([
        baseIssue,
      ]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        baseIssue,
      ]);

      const period1 = {
        start: new Date("2025-07-10T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const issues1 = await issueProviderService.getIssues(period1);
      expect(issues1.map((i) => i.key)).toEqual(["TT-MIXED"]);

      const period2 = {
        start: new Date("2025-07-16T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const issues2 = await issueProviderService.getIssues(period2);
      // In this later period, only time-tracking update exists; should be excluded
      expect(issues2.map((i) => i.key)).toEqual([]);
    });

    it("excludes issue when only assignee change by me within period", async () => {
      const period = {
        start: new Date("2025-08-01T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-assign1";
      const issue: JiraIssue = {
        id: "a1",
        key: "ASGN-ONLY",
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
              created: "2025-08-05T10:00:00.000Z",
              items: [
                {
                  field: "assignee",
                  fieldtype: "jira",
                  fromString: "X",
                  toString: "Y",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(async (k: string) =>
        k === "issueSource" ? "activity" : k === "includedProjects" ? [] : null,
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);
      const issues = await issueProviderService.getIssues(period);
      expect(issues).toHaveLength(0);
    });

    it("excludes issue when assignee change and worklog change only", async () => {
      const period = {
        start: new Date("2025-08-01T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-assign2";
      const issue: JiraIssue = {
        id: "a2",
        key: "ASGN-TT",
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
              created: "2025-08-06T10:00:00.000Z",
              items: [
                {
                  field: "assignee",
                  fieldtype: "jira",
                  fromString: "X",
                  toString: "Y",
                },
                {
                  field: "Time Spent",
                  fieldtype: "jira",
                  fromString: "0",
                  toString: "1h",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(async (k: string) =>
        k === "issueSource" ? "activity" : k === "includedProjects" ? [] : null,
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);
      const issues = await issueProviderService.getIssues(period);
      expect(issues).toHaveLength(0);
    });

    it("includes issue when assignee change plus a non time-tracking content change (description)", async () => {
      const period = {
        start: new Date("2025-08-01T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-assign3";
      const issue: JiraIssue = {
        id: "a3",
        key: "ASGN-DESC",
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
              created: "2025-08-07T10:00:00.000Z",
              items: [
                {
                  field: "assignee",
                  fieldtype: "jira",
                  fromString: "X",
                  toString: "Y",
                },
                {
                  field: "description",
                  fieldtype: "jira",
                  fromString: "old",
                  toString: "new",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(async (k: string) =>
        k === "issueSource" ? "activity" : k === "includedProjects" ? [] : null,
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);
      const issues = await issueProviderService.getIssues(period);
      expect(issues.map((i) => i.key)).toEqual(["ASGN-DESC"]);
    });

    it("includes issue when assignee+worklog change but also my comment exists in period", async () => {
      const period = {
        start: new Date("2025-08-01T00:00:00.000Z"),
        end: new Date("2025-08-15T23:59:59.999Z"),
      };
      const me = "me-assign4";
      const issue: JiraIssue = {
        id: "a4",
        key: "ASGN-TT-COMMENT",
        fields: {
          summary: "",
          issuetype: { iconUrl: "", name: "Task" },
          project: { key: "P", name: "P" },
          updated: "",
          comment: {
            comments: [
              {
                id: "c1",
                author: { accountId: me, displayName: "Me" },
                created: "2025-08-10T09:00:00.000Z",
              },
            ],
            maxResults: 1,
            total: 1,
            startAt: 0,
          },
        },
        changelog: {
          histories: [
            {
              author: { accountId: me, displayName: "Me" },
              created: "2025-08-06T10:00:00.000Z",
              items: [
                {
                  field: "assignee",
                  fieldtype: "jira",
                  fromString: "X",
                  toString: "Y",
                },
                {
                  field: "Time Spent",
                  fieldtype: "jira",
                  fromString: "0",
                  toString: "1h",
                },
              ],
            },
          ],
        },
      } as any;
      (settingsServiceMock.get as any).mockImplementation(async (k: string) =>
        k === "issueSource" ? "activity" : k === "includedProjects" ? [] : null,
      );
      (jiraApiServiceMock.getCurrentUser as any).mockResolvedValue({
        accountId: me,
      });
      (jiraApiServiceMock.fetchIssuesMinimal as any).mockResolvedValue([issue]);
      (jiraApiServiceMock.fetchIssuesDetailedByKeys as any).mockResolvedValue([
        issue,
      ]);
      const issues = await issueProviderService.getIssues(period);
      expect(issues.map((i) => i.key)).toEqual(["ASGN-TT-COMMENT"]);
    });
  });
});
