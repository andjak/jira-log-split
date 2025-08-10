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
    // Build a JQL that restricts ONLY by the time period, then filter client-side
    // to issues that the user updated or commented on within that period.
    const [user] = await Promise.all([
      this.jiraApiService.getCurrentUser(),
    ]);

    const jqlFilters = [
      `updated >= "${this.formatDateForJql(period.start)}"`,
      `updated <= "${this.formatDateForJql(period.end)}"`,
    ];
    const jql = `${jqlFilters.join(' AND ')} ORDER BY updated DESC`;

    const allIssues = await this.jiraApiService.fetchIssues(jql);

    return allIssues.filter((issue) => {
      if (!issue.changelog) return false;
      return issue.changelog.histories.some((history) =>
        this.isRelevantActivity(history, user.accountId, period),
      );
    });
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

    // Consider any user-authored change (including comments) as relevant activity.
    const hasAnyChange = Array.isArray(history.items) && history.items.length > 0;

    return isAuthor && isWithinPeriod && hasAnyChange;
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

