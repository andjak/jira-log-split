import { JiraApiService } from './JiraApiService';
import { SettingsService } from './SettingsService';
import { JiraIssue } from '../core/jira-types';

interface Period {
  start: Date;
  end: Date;
}

export class IssueProviderService {
  constructor(
    private jiraApiService: JiraApiService,
    private settingsService: SettingsService,
  ) {}

  // Utility: derive per-day active issue keys for a user in a period
  public derivePerDayActive(issues: JiraIssue[], period: { start: Date; end: Date }, userAccountId: string): Record<string, string[]> {
    const perDay: Record<string, Set<string>> = {};
    for (const issue of issues) {
      const histories = issue.changelog?.histories || [];
      for (const h of histories) {
        const when = new Date(h.created);
        if (when < period.start || when > period.end) continue;
        if (h.author.accountId !== userAccountId) continue;
        if (!h.items?.some((i) => i.field.toLowerCase() === 'status')) continue;
        const dayIso = when.toISOString().split('T')[0];
        if (!perDay[dayIso]) perDay[dayIso] = new Set<string>();
        perDay[dayIso].add(issue.key);
      }
    }
    return Object.fromEntries(Object.entries(perDay).map(([k, v]) => [k, Array.from(v)]));
  }

  public async getCurrentUserAccountId(): Promise<string> {
    const me = await this.jiraApiService.getCurrentUser();
    return me.accountId;
  }

  public async getIssues(period: Period): Promise<JiraIssue[]> {
    const issueSource = await this.settingsService.get('issueSource');

    if (issueSource === 'myProfile') {
      return this.getIssuesFromMyProfile(period);
    }
    if (issueSource === 'activity') {
      return this.getIssuesByActivity(period);
    }
    return [];
  }

  private async getIssuesByActivity(period: Period): Promise<JiraIssue[]> {
    // Phase 1: fetch minimal candidates using only the time window
    const currentUser = await this.jiraApiService.getCurrentUser();

    const jqlFilters = [
      `updated >= "${this.formatDateForJql(period.start)}"`,
      `updated <= "${this.formatDateForJql(period.end)}"`,
    ];
    // Optional user-configured project filter
    const includedProjects = await this.settingsService.get('includedProjects');
    if (Array.isArray(includedProjects) && includedProjects.length > 0) {
      // If user explicitly configured projects, use them; otherwise default to date-only JQL
      jqlFilters.push(`project in ("${includedProjects.join('", "')}")`);
    }
    const jql = `${jqlFilters.join(' AND ')} ORDER BY updated DESC`;

    const pipelined = await this.settingsService.get('pipelinedPhase2Enabled');
    let allIssues: JiraIssue[];
    if (pipelined && (this.jiraApiService as any).fetchIssuesMinimalPaged) {
      const collectedKeys: string[] = [];
      const pageDetailPromises: Promise<JiraIssue[]>[] = [];
      // Start Phase 2 calls as pages arrive; do not await until all pages scheduled
      await (this.jiraApiService as any).fetchIssuesMinimalPaged(jql, async (page: JiraIssue[], _idx: number, pageSize: number) => {
        const keys = page.map((i) => i.key).filter(Boolean);
        collectedKeys.push(...keys);
        if (keys.length > 0) {
          // Use the minimal page size as the detailed batch size for best throughput
          pageDetailPromises.push(this.jiraApiService.fetchIssuesDetailedByKeys(keys, { batchSize: pageSize }));
        }
      });
      const pageDetails = await Promise.all(pageDetailPromises);
      allIssues = pageDetails.flat();
      // If, for any reason, minimal returned issues not covered (shouldn't happen), fallback to full fetch
      if (allIssues.length === 0 && collectedKeys.length > 0) {
        allIssues = await this.jiraApiService.fetchIssuesDetailedByKeys(collectedKeys);
      }
    } else {
      const minimalIssues = await this.jiraApiService.fetchIssuesMinimal(jql);
      const candidateKeys = minimalIssues.map((i) => i.key).filter(Boolean);
      allIssues = await this.jiraApiService.fetchIssuesDetailedByKeys(candidateKeys);
    }

    // Compute user activity timestamps (updates via changelog, and comments)
    for (const issue of allIssues) {
      const lastUpdatedByMeISO = this.findLastChangeByUser(issue, currentUser.accountId, period);
      const lastCommentedByMeISO = this.findLastCommentByUser(issue, currentUser.accountId, period);
      const lastActivityAtISO = this.pickLatestISO([lastUpdatedByMeISO, lastCommentedByMeISO]);
      const activity = issue.userActivity ?? (issue.userActivity = {} as any);
      activity.lastUpdatedByMeISO = lastUpdatedByMeISO || undefined;
      activity.lastCommentedByMeISO = lastCommentedByMeISO || undefined;
      activity.lastActivityAtISO = lastActivityAtISO || undefined;
    }

    // Keep only issues where user had some activity (update or comment)
    const withActivity = allIssues.filter((i) => Boolean(i.userActivity?.lastActivityAtISO));

    // Sort by user's last activity descending
    withActivity.sort((a, b) => {
      const ta = a.userActivity?.lastActivityAtISO ? Date.parse(a.userActivity.lastActivityAtISO) : 0;
      const tb = b.userActivity?.lastActivityAtISO ? Date.parse(b.userActivity.lastActivityAtISO) : 0;
      return tb - ta;
    });

    return withActivity;
  }

  // Streaming variant for UI: emits sorted arrays on each batch insert using binary insertion
  public async getIssuesByActivityStream(
    period: Period,
    onUpdate: (issues: JiraIssue[]) => void,
  ): Promise<JiraIssue[]> {
    const currentUser = await this.jiraApiService.getCurrentUser();
    const currentUserId = currentUser.accountId;

    const jqlFilters = [
      `updated >= "${this.formatDateForJql(period.start)}"`,
      `updated <= "${this.formatDateForJql(period.end)}"`,
    ];
    const includedProjects = await this.settingsService.get('includedProjects');
    if (Array.isArray(includedProjects) && includedProjects.length > 0) {
      jqlFilters.push(`project in ("${includedProjects.join('", "')}")`);
    }
    const jql = `${jqlFilters.join(' AND ')} ORDER BY updated DESC`;

    const accumulator: JiraIssue[] = [];

    const insertSorted = (issue: JiraIssue) => {
      const ts = issue.userActivity?.lastActivityAtISO ? Date.parse(issue.userActivity.lastActivityAtISO) : 0;
      let lo = 0, hi = accumulator.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const midTs = accumulator[mid].userActivity?.lastActivityAtISO ? Date.parse(accumulator[mid].userActivity!.lastActivityAtISO!) : 0;
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
        const lastUpdatedByMeISO = this.findLastChangeByUser(issue, currentUserId, period);
        const lastCommentedByMeISO = this.findLastCommentByUser(issue, currentUserId, period);
        const lastActivityAtISO = this.pickLatestISO([lastUpdatedByMeISO, lastCommentedByMeISO]);
        if (!lastActivityAtISO) continue;
        const activity = issue.userActivity ?? (issue.userActivity = {} as any);
        activity.lastUpdatedByMeISO = lastUpdatedByMeISO || undefined;
        activity.lastCommentedByMeISO = lastCommentedByMeISO || undefined;
        activity.lastActivityAtISO = lastActivityAtISO || undefined;
        insertSorted(issue);
      }
      onUpdate(accumulator.slice());
    };

    await (this.jiraApiService as any).fetchIssuesMinimalPaged(jql, async (page: JiraIssue[], _idx: number, pageSize: number) => {
      const keys = page.map((i) => i.key).filter(Boolean);
      if (keys.length === 0) return;
      await this.jiraApiService.fetchIssuesDetailedByKeys(keys, {
        batchSize: pageSize,
        onBatch: async (issues) => processBatch(issues),
      });
    });

    return accumulator;
  }

  // Removed unused helper: isRelevantActivity

  private findLastChangeByUser(issue: JiraIssue, currentUserId: string, period: Period): string | null {
    const histories = issue.changelog?.histories ?? [];
    let last: string | null = null;
    for (const h of histories) {
      if (!h || !h.created || !h.author) continue;
      const createdMs = Date.parse(h.created);
      if (Number.isNaN(createdMs)) continue;
      const inRange = createdMs >= period.start.getTime() && createdMs <= period.end.getTime();
      const byMe = h.author.accountId === currentUserId;
      const hasItems = Array.isArray(h.items) && h.items.length > 0;
      if (inRange && byMe && hasItems) {
        if (!last || createdMs > Date.parse(last)) last = h.created;
      }
    }
    return last;
  }

  private findLastCommentByUser(issue: JiraIssue, currentUserId: string, period: Period): string | null {
    const comments = issue.fields?.comment?.comments ?? [];
    let last: string | null = null;
    for (const c of comments) {
      if (!c || !c.created || !c.author) continue;
      const createdMs = Date.parse(c.created);
      if (Number.isNaN(createdMs)) continue;
      const inRange = createdMs >= period.start.getTime() && createdMs <= period.end.getTime();
      const byMe = c.author.accountId === currentUserId;
      if (inRange && byMe) {
        if (!last || createdMs > Date.parse(last)) last = c.created;
      }
    }
    return last;
  }

  private pickLatestISO(candidates: Array<string | null | undefined>): string | null {
    const valid = candidates.filter((x): x is string => typeof x === 'string');
    if (valid.length === 0) return null;
    return valid.reduce((acc, cur) => (Date.parse(cur) > Date.parse(acc) ? cur : acc));
  }

  private async getIssuesFromMyProfile(period: Period): Promise<JiraIssue[]> {
    const [excludedProjects, excludedIssueTypes] = await Promise.all([
      this.settingsService.get('excludedProjects'),
      this.settingsService.get('excludedIssueTypes'),
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
      jqlFilters.push(`issuetype not in ("${excludedIssueTypes.join('", "')}")`);
    }

    const jql = `${jqlFilters.join(' AND ')} ORDER BY updated DESC`;
    return this.jiraApiService.fetchIssues(jql);
  }

  private formatDateForJql(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

