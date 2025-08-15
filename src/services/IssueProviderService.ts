import { JiraApiService } from "./JiraApiService";
import { SettingsService } from "./SettingsService";
import { JiraIssue } from "../core/jira-types";
import { ETA_INITIAL_SECONDS_PER_BATCH } from "../core/constants";

interface Period {
  start: Date;
  end: Date;
}

export class IssueProviderService {
  constructor(
    private jiraApiService: JiraApiService,
    private settingsService: SettingsService,
  ) {}

  // Tracks previously fetched date ranges, merged on each request.
  private fetchedRanges: Array<{ start: string; end: string }> = [];
  // Cache of detailed issues fetched so far (used to serve requests fully covered by fetchedRanges)
  private allFetchedIssues: JiraIssue[] = [];
  // If set, indicates we have fetched issues for all updates from this day forward (open-ended)
  private openEndedStartISO: string | null = null;

  // Fields considered as time tracking updates in Jira changelog
  private static readonly TIME_TRACKING_FIELDS = new Set<string>([
    "timespent",
    "time spent",
    "timeestimate",
    "remaining estimate",
    "timeoriginalestimate",
    "original estimate",
    "aggregatetimespent",
    "aggregate time spent",
    "aggregatetimeestimate",
    "aggregate remaining estimate",
    "aggregatetimeoriginalestimate",
    "aggregate original estimate",
    "worklog",
    "worklog id",
  ]);

  private static isTimeTrackingFieldName(
    name: string | undefined | null,
  ): boolean {
    if (!name) return false;
    const n = name.toLowerCase();
    // Explicit known fields OR heuristic tokens frequently used in Jira for time tracking
    return (
      IssueProviderService.TIME_TRACKING_FIELDS.has(n) ||
      n.includes("time") ||
      n.includes("estimate") ||
      n.includes("worklog")
    );
  }

  private static isTimeTrackingChange(
    items: Array<{ field?: string }> | undefined | null,
  ): boolean {
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((it) =>
      IssueProviderService.isTimeTrackingFieldName(it?.field),
    );
  }

  private static mergeRanges(
    ranges: Array<{ start: string; end: string }>,
  ): Array<{ start: string; end: string }> {
    if (ranges.length === 0) return [];
    const norm = ranges
      .map((r) => ({ start: r.start, end: r.end }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const merged: Array<{ start: string; end: string }> = [];
    for (const r of norm) {
      if (merged.length === 0) {
        merged.push({ ...r });
        continue;
      }
      const last = merged[merged.length - 1];
      if (r.start <= IssueProviderService.nextDayIso(last.end)) {
        if (r.end > last.end) last.end = r.end;
      } else {
        merged.push({ ...r });
      }
    }
    return merged;
  }

  private static subtractRanges(
    universe: { start: string; end: string },
    covered: Array<{ start: string; end: string }>,
  ): Array<{ start: string; end: string }> {
    // Return parts of universe not covered by any covered ranges.
    const result: Array<{ start: string; end: string }> = [];
    let cursor = universe.start;
    const ordered = IssueProviderService.mergeRanges(covered);
    for (const r of ordered) {
      if (r.end < cursor) continue;
      if (r.start > universe.end) break;
      if (r.start > cursor) {
        result.push({
          start: cursor,
          end: IssueProviderService.prevDayIso(r.start),
        });
      }
      if (r.end >= cursor) cursor = IssueProviderService.nextDayIso(r.end);
      if (cursor > universe.end) return result;
    }
    if (cursor <= universe.end)
      result.push({ start: cursor, end: universe.end });
    return result;
  }

  private static toIsoDay(d: Date): string {
    return d.toISOString().split("T")[0];
  }
  private static prevDayIso(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split("T")[0];
  }
  private static nextDayIso(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split("T")[0];
  }

  // Utility: derive per-day active issue keys for a user in a period
  public derivePerDayActive(
    issues: JiraIssue[],
    period: { start: Date; end: Date },
    userAccountId: string,
  ): Record<string, string[]> {
    const perDay: Record<string, Set<string>> = {};
    for (const issue of issues) {
      const histories = issue.changelog?.histories || [];
      for (const h of histories) {
        const when = new Date(h.created);
        if (when < period.start || when > period.end) continue;
        if (h.author.accountId !== userAccountId) continue;
        if (!h.items?.some((i) => i.field.toLowerCase() === "status")) continue;
        const dayIso = when.toISOString().split("T")[0];
        if (!perDay[dayIso]) perDay[dayIso] = new Set<string>();
        perDay[dayIso].add(issue.key);
      }
    }
    return Object.fromEntries(
      Object.entries(perDay).map(([k, v]) => [k, Array.from(v)]),
    );
  }

  public async getCurrentUserAccountId(): Promise<string> {
    const me = await this.jiraApiService.getCurrentUser();
    return me.accountId;
  }

  public async getIssues(period: Period): Promise<JiraIssue[]> {
    const issueSource = await this.settingsService.get("issueSource");

    if (issueSource === "myProfile") {
      return this.getIssuesFromMyProfile(period);
    }
    if (issueSource === "activity") {
      return this.getIssuesByActivity(period);
    }
    return [];
  }

  private upsertIssuesIntoCache(issues: JiraIssue[]): void {
    if (!issues || issues.length === 0) return;
    const map = new Map<string, JiraIssue>();
    for (const existing of this.allFetchedIssues)
      map.set(existing.key, existing);
    for (const i of issues) {
      if (i && i.key) map.set(i.key, i);
    }
    this.allFetchedIssues = Array.from(map.values());
  }

  private computeFromCache(
    period: Period,
    currentUserAccountId: string,
  ): JiraIssue[] {
    const results: JiraIssue[] = [];
    for (const issue of this.allFetchedIssues) {
      const lastUpdatedByMeISO = this.findLastChangeByUser(
        issue,
        currentUserAccountId,
        period,
      );
      const lastCommentedByMeISO = this.findLastCommentByUser(
        issue,
        currentUserAccountId,
        period,
      );
      const lastActivityAtISO = this.pickLatestISO([
        lastUpdatedByMeISO,
        lastCommentedByMeISO,
      ]);
      if (!lastActivityAtISO) continue;
      const clone: JiraIssue = {
        ...issue,
        userActivity: {
          lastUpdatedByMeISO: lastUpdatedByMeISO || undefined,
          lastCommentedByMeISO: lastCommentedByMeISO || undefined,
          lastActivityAtISO: lastActivityAtISO || undefined,
        },
      } as JiraIssue;
      results.push(clone);
    }
    results.sort((a, b) => {
      const ta = a.userActivity?.lastActivityAtISO
        ? Date.parse(a.userActivity.lastActivityAtISO)
        : 0;
      const tb = b.userActivity?.lastActivityAtISO
        ? Date.parse(b.userActivity.lastActivityAtISO)
        : 0;
      return tb - ta;
    });
    return results;
  }

  private async getIssuesByActivity(period: Period): Promise<JiraIssue[]> {
    // Phase 1: fetch minimal candidates using only the time window; but only for delta days not yet fetched
    const currentUser = await this.jiraApiService.getCurrentUser();
    const universe = {
      start: IssueProviderService.toIsoDay(period.start),
      end: IssueProviderService.toIsoDay(period.end),
    };
    const deltas = IssueProviderService.subtractRanges(
      universe,
      this.fetchedRanges,
    );
    if (deltas.length === 0) {
      // No new fetch needed; recalc from cache for requested period
      return this.computeFromCache(period, currentUser.accountId);
    }

    const includedProjects = await this.settingsService.get("includedProjects");
    const projectClause =
      Array.isArray(includedProjects) && includedProjects.length > 0
        ? ` AND project in ("${includedProjects.join('", "')}")`
        : "";

    const pipelined = await this.settingsService.get("pipelinedPhase2Enabled");
    const newlyFetchedIssues: JiraIssue[] = [];

    for (const delta of deltas) {
      // If we already have open-ended coverage, only fetch earlier slice up to that start; skip trailing
      if (this.openEndedStartISO && delta.start >= this.openEndedStartISO) {
        continue;
      }
      const upperBoundISO = this.openEndedStartISO || null;
      const jqlParts = [`updated >= "${delta.start}"`];
      if (upperBoundISO) jqlParts.push(`updated < "${upperBoundISO}"`);
      const jql = `${jqlParts.join(" AND ")}${projectClause} ORDER BY updated DESC`;
      try {
        // eslint-disable-next-line no-console
        console.info(
          "[AC] delta-query",
          upperBoundISO
            ? {
                start: delta.start,
                end: IssueProviderService.prevDayIso(upperBoundISO),
              }
            : { start: delta.start },
        );
      } catch {
        /* no-op */
      }
      if (pipelined && (this.jiraApiService as any).fetchIssuesMinimalPaged) {
        const pageDetailPromises: Promise<JiraIssue[]>[] = [];
        await (this.jiraApiService as any).fetchIssuesMinimalPaged(
          jql,
          async (page: JiraIssue[], _idx: number, pageSize: number) => {
            const keys = page.map((i) => i.key).filter(Boolean);
            if (keys.length > 0) {
              pageDetailPromises.push(
                this.jiraApiService.fetchIssuesDetailedByKeys(keys, {
                  batchSize: pageSize,
                }),
              );
            }
          },
        );
        const pageDetails = await Promise.all(pageDetailPromises);
        newlyFetchedIssues.push(...pageDetails.flat());
      } else {
        const minimalIssues = await this.jiraApiService.fetchIssuesMinimal(jql);
        const candidateKeys = minimalIssues.map((i) => i.key).filter(Boolean);
        const detailed =
          await this.jiraApiService.fetchIssuesDetailedByKeys(candidateKeys);
        newlyFetchedIssues.push(...detailed);
      }
      // Merge fetched delta into cache
      this.fetchedRanges = IssueProviderService.mergeRanges([
        ...this.fetchedRanges,
        delta,
      ]);
    }
    // Track earliest start seen so far to represent open-ended coverage from that day forward
    if (!this.openEndedStartISO || universe.start < this.openEndedStartISO) {
      this.openEndedStartISO = universe.start;
    }

    // Upsert into cache
    this.upsertIssuesIntoCache(newlyFetchedIssues);

    // Compute user activity timestamps and filter/sort for the requested period using cache
    return this.computeFromCache(period, currentUser.accountId);
  }

  // Streaming variant for UI: emits sorted arrays on each batch insert using binary insertion
  public async getIssuesByActivityStream(
    period: Period,
    onUpdate: (issues: JiraIssue[]) => void,
    onProgress?: (info: {
      processedBatches: number;
      totalBatches: number;
      remainingBatches: number;
      etaSeconds: number | null;
    }) => void,
  ): Promise<JiraIssue[]> {
    const currentUser = await this.jiraApiService.getCurrentUser();
    const currentUserId = currentUser.accountId;

    const includedProjects = await this.settingsService.get("includedProjects");
    const universe = {
      start: IssueProviderService.toIsoDay(period.start),
      end: IssueProviderService.toIsoDay(period.end),
    };
    const deltas = IssueProviderService.subtractRanges(
      universe,
      this.fetchedRanges,
    );
    if (deltas.length === 0) {
      // Serve from cache without network; still emit one update so UI paints
      const cached = this.computeFromCache(period, currentUserId);
      onUpdate(cached.slice());
      return cached;
    }

    // Seed list with already cached, period-relevant issues so UI keeps them visible
    const initialCached = this.computeFromCache(period, currentUserId);
    const accumulator: JiraIssue[] = initialCached.slice();
    const seenKeys = new Set<string>(accumulator.map((it) => it.key));
    let totalBatches: number | null = null;
    let processedBatches = 0;
    let phase1Done = false;
    let measuredStartAt: number | null = null;
    let processedAtMeasureStart = 0;
    let avgSecondsPerBatch: number | null = null;
    let prevEtaSeconds: number | null = null;

    const insertSorted = (issue: JiraIssue) => {
      const ts = issue.userActivity?.lastActivityAtISO
        ? Date.parse(issue.userActivity.lastActivityAtISO)
        : 0;
      let lo = 0,
        hi = accumulator.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const midTs = accumulator[mid].userActivity?.lastActivityAtISO
          ? Date.parse(accumulator[mid].userActivity!.lastActivityAtISO!)
          : 0;
        if (ts > midTs) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      accumulator.splice(lo, 0, issue);
    };

    const processBatch = (batch: JiraIssue[]) => {
      for (const issue of batch) {
        const lastUpdatedByMeISO = this.findLastChangeByUser(
          issue,
          currentUserId,
          period,
        );
        const lastCommentedByMeISO = this.findLastCommentByUser(
          issue,
          currentUserId,
          period,
        );
        const lastActivityAtISO = this.pickLatestISO([
          lastUpdatedByMeISO,
          lastCommentedByMeISO,
        ]);
        if (!lastActivityAtISO) continue;
        const activity = issue.userActivity ?? (issue.userActivity = {} as any);
        activity.lastUpdatedByMeISO = lastUpdatedByMeISO || undefined;
        activity.lastCommentedByMeISO = lastCommentedByMeISO || undefined;
        activity.lastActivityAtISO = lastActivityAtISO || undefined;
        if (issue.key && seenKeys.has(issue.key)) {
          // Skip duplicates already present from cache-seeded list
          continue;
        }
        insertSorted(issue);
        if (issue.key) seenKeys.add(issue.key);
      }
      onUpdate(accumulator.slice());
      processedBatches += 1;
      if (totalBatches && totalBatches > 0) {
        const remainingBatches = Math.max(0, totalBatches - processedBatches);
        let etaSeconds: number | null;
        if (phase1Done) {
          if (measuredStartAt == null) {
            measuredStartAt = Date.now();
            processedAtMeasureStart = processedBatches;
          }
          const measuredProcessed = Math.max(
            0,
            processedBatches - processedAtMeasureStart,
          );
          const elapsedMs = Date.now() - measuredStartAt;
          const avgPerBatchMs =
            measuredProcessed > 0 ? elapsedMs / measuredProcessed : 0;
          avgSecondsPerBatch = avgPerBatchMs > 0 ? avgPerBatchMs / 1000 : null;
          const instantaneous =
            avgSecondsPerBatch != null
              ? remainingBatches * avgSecondsPerBatch
              : null;
          if (instantaneous != null) {
            if (prevEtaSeconds == null) {
              etaSeconds = instantaneous;
            } else {
              const alpha = 0.3;
              etaSeconds = alpha * instantaneous + (1 - alpha) * prevEtaSeconds;
            }
            prevEtaSeconds = etaSeconds;
          } else {
            etaSeconds = null;
          }
        } else {
          // Before Phase 1 completes, show baseline ETA so the UI keeps a numeric value visible
          etaSeconds = remainingBatches * ETA_INITIAL_SECONDS_PER_BATCH;
          prevEtaSeconds = etaSeconds;
        }
        if (onProgress) {
          try {
            onProgress({
              processedBatches,
              totalBatches,
              remainingBatches,
              etaSeconds,
            });
          } catch {
            /* no-op */
          }
        }
      }
    };

    let performedFetch = false;
    const fetchedForCache: JiraIssue[] = [];
    for (const delta of deltas) {
      // If tail is already covered by a previous open-ended fetch, skip querying and rely on cache
      if (this.openEndedStartISO && delta.start >= this.openEndedStartISO) {
        continue;
      }
      performedFetch = true;
      // If we already have open-ended coverage, only fetch earlier slice up to that start; skip trailing
      const upperBoundISO = this.openEndedStartISO || null;
      const jqlParts = [`updated >= "${delta.start}"`];
      if (upperBoundISO) jqlParts.push(`updated < "${upperBoundISO}"`);
      if (Array.isArray(includedProjects) && includedProjects.length > 0) {
        jqlParts.push(`project in ("${includedProjects.join('", "')}")`);
      }
      const jql = `${jqlParts.join(" AND ")} ORDER BY updated DESC`;
      try {
        // eslint-disable-next-line no-console
        console.info(
          "[AC] delta-query",
          upperBoundISO
            ? {
                start: delta.start,
                end: IssueProviderService.prevDayIso(upperBoundISO),
              }
            : { start: delta.start },
        );
      } catch {
        /* no-op */
      }
      await (this.jiraApiService as any).fetchIssuesMinimalPaged(
        jql,
        async (
          page: JiraIssue[],
          idx: number,
          pageSize: number,
          total: number,
        ) => {
          if (idx === 0) {
            const totalCount = total ?? page.length;
            const pages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;
            totalBatches = (totalBatches ?? 0) + pages;
            if (pages > 0 && onProgress) {
              const remainingBatches = Math.max(
                0,
                (totalBatches ?? 0) - processedBatches,
              );
              const etaSeconds =
                remainingBatches * ETA_INITIAL_SECONDS_PER_BATCH;
              try {
                onProgress({
                  processedBatches,
                  totalBatches: totalBatches ?? 0,
                  remainingBatches,
                  etaSeconds,
                });
              } catch {
                /* no-op */
              }
            }
          }
          const keys = page.map((i) => i.key).filter(Boolean);
          if (keys.length === 0) return;
          await this.jiraApiService.fetchIssuesDetailedByKeys(keys, {
            batchSize: pageSize,
            onBatch: async (issues) => {
              if (issues && issues.length) fetchedForCache.push(...issues);
              await processBatch(issues);
            },
          });
        },
      );
      // After finishing this delta, merge it into fetchedRanges
      this.fetchedRanges = IssueProviderService.mergeRanges([
        ...this.fetchedRanges,
        delta,
      ]);
    }
    // If we skipped all deltas due to open-ended coverage, still emit one update from cache
    if (!performedFetch) {
      onUpdate(initialCached.slice());
      // No network was performed; return cached result immediately
      return initialCached;
    }
    // Track earliest start seen so far to represent open-ended coverage from that day forward
    if (!this.openEndedStartISO || universe.start < this.openEndedStartISO) {
      this.openEndedStartISO = universe.start;
    }
    // Mark end of Phase 1 across all deltas; start measurement window now
    phase1Done = true;
    measuredStartAt = Date.now();
    processedAtMeasureStart = processedBatches;

    // Upsert all fetched detailed issues to cache so later covered days can be served from cache
    if (fetchedForCache.length > 0) this.upsertIssuesIntoCache(fetchedForCache);
    // Also upsert the accumulator with user-activity annotations
    this.upsertIssuesIntoCache(accumulator);

    // Emit a final progress snapshot to ensure consumers receive completion state
    if (onProgress && totalBatches != null && (totalBatches as number) > 0) {
      const remainingBatches = Math.max(
        0,
        (totalBatches as number) - processedBatches,
      );
      // If only one batch in total, when we finish it remaining becomes 0 and ETA should be 0
      const etaSeconds =
        remainingBatches === 0
          ? 0
          : avgSecondsPerBatch != null
            ? remainingBatches * avgSecondsPerBatch
            : null;
      try {
        onProgress({
          processedBatches,
          totalBatches: totalBatches as number,
          remainingBatches,
          etaSeconds,
        });
      } catch {
        /* no-op */
      }
    }

    return accumulator;
  }

  // Removed unused helper: isRelevantActivity

  private findLastChangeByUser(
    issue: JiraIssue,
    currentUserId: string,
    period: Period,
  ): string | null {
    const histories = issue.changelog?.histories ?? [];
    let last: string | null = null;
    for (const h of histories) {
      if (!h || !h.created || !h.author) continue;
      const createdMs = Date.parse(h.created);
      if (Number.isNaN(createdMs)) continue;
      const inRange =
        createdMs >= period.start.getTime() &&
        createdMs <= period.end.getTime();
      const byMe = h.author.accountId === currentUserId;
      const hasItems = Array.isArray(h.items) && h.items.length > 0;
      // Exclude changes that are only time tracking updates
      const isOnlyTimeTracking = IssueProviderService.isTimeTrackingChange(
        h.items as any,
      );
      if (inRange && byMe && hasItems && !isOnlyTimeTracking) {
        if (!last || createdMs > Date.parse(last)) last = h.created;
      }
    }
    return last;
  }

  private findLastCommentByUser(
    issue: JiraIssue,
    currentUserId: string,
    period: Period,
  ): string | null {
    const comments = issue.fields?.comment?.comments ?? [];
    let last: string | null = null;
    for (const c of comments) {
      if (!c || !c.created || !c.author) continue;
      const createdMs = Date.parse(c.created);
      if (Number.isNaN(createdMs)) continue;
      const inRange =
        createdMs >= period.start.getTime() &&
        createdMs <= period.end.getTime();
      const byMe = c.author.accountId === currentUserId;
      if (inRange && byMe) {
        if (!last || createdMs > Date.parse(last)) last = c.created;
      }
    }
    return last;
  }

  private pickLatestISO(
    candidates: Array<string | null | undefined>,
  ): string | null {
    const valid = candidates.filter((x): x is string => typeof x === "string");
    if (valid.length === 0) return null;
    return valid.reduce((acc, cur) =>
      Date.parse(cur) > Date.parse(acc) ? cur : acc,
    );
  }

  private async getIssuesFromMyProfile(period: Period): Promise<JiraIssue[]> {
    const [excludedProjects, excludedIssueTypes] = await Promise.all([
      this.settingsService.get("excludedProjects"),
      this.settingsService.get("excludedIssueTypes"),
    ]);

    const jqlFilters = [
      `updated >= "${this.formatDateForJql(period.start)}"`,
      `updated <= "${this.formatDateForJql(period.end)}"`,
      `(assignee in (currentUser()) OR reporter in (currentUser()) OR creator in (currentUser()) OR watcher in (currentUser()))`,
    ];

    if (excludedProjects.length > 0) {
      jqlFilters.push(`project not in ("${excludedProjects.join('", "')}")`);
    }

    if (excludedIssueTypes.length > 0) {
      jqlFilters.push(
        `issuetype not in ("${excludedIssueTypes.join('", "')}")`,
      );
    }

    const jql = `${jqlFilters.join(" AND ")} ORDER BY updated DESC`;
    return this.jiraApiService.fetchIssues(jql);
  }

  private formatDateForJql(date: Date): string {
    return date.toISOString().split("T")[0];
  }
}
