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
    // JQL with ONLY date range, ordered by updated; comments fetched via fields.
    const currentUser = await this.jiraApiService.getCurrentUser();

    const jqlFilters = [
      `updated >= "${this.formatDateForJql(period.start)}"`,
      `updated <= "${this.formatDateForJql(period.end)}"`,
    ];
    const jql = `${jqlFilters.join(' AND ')} ORDER BY updated DESC`;

    const allIssues = await this.jiraApiService.fetchIssues(jql);

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

  /**
   * Checks if a single changelog history item constitutes relevant activity
   * by the user within the given period.
   *
   * @param history The changelog history item.
   * @param currentUserId The ID of the current user.
   * @param period The date range to check against.
   * @returns True if the activity is relevant, false otherwise.
   */
  private isRelevantActivity(history: any, currentUserId: string, period: Period): boolean {
    const activityDate = new Date(history.created);
    const isAuthor = history.author.accountId === currentUserId;
    const isWithinPeriod = activityDate >= period.start && activityDate <= period.end;
    const hasAnyChange = Array.isArray(history.items) && history.items.length > 0;
    return isAuthor && isWithinPeriod && hasAnyChange;
  }

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

