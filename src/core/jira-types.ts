// src/core/jira-types.ts

/**
 * Represents a simplified Jira Issue object.
 */
export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    issuetype: {
      iconUrl: string;
      name: string;
    };
    project: {
      key: string;
      name: string;
    };
    updated: string; // ISO 8601 date string
    comment?: {
      comments: JiraComment[];
      maxResults: number;
      total: number;
      startAt: number;
    };
  };
  changelog?: {
    histories: JiraChangelog[];
  };
  /**
   * Derived metadata about the current user's activity on this issue within the selected period.
   */
  userActivity?: {
    lastUpdatedByMeISO?: string; // ISO timestamp of last change authored by me
    lastCommentedByMeISO?: string; // ISO timestamp of last comment authored by me
    lastActivityAtISO?: string; // max of the above
  };
}

/**
 * Represents a single history record in a Jira issue's changelog.
 */
export interface JiraChangelog {
  author: {
    accountId: string;
    displayName: string;
  };
  created: string; // ISO 8601 date string
  items: Array<{
    field: string;
    fieldtype: string;
    fromString: string | null;
    toString: string | null;
  }>;
}

export interface JiraComment {
  id: string;
  author: {
    accountId: string;
    displayName: string;
  };
  created: string; // ISO 8601 date string
  updated?: string; // ISO 8601 date string
  body?: unknown;
}

/**
 * Represents a worklog entry in Jira.
 */
export interface JiraWorklog {
  author: {
    accountId: string;
  };
  timeSpentSeconds: number;
  started: string; // ISO 8601 date string
}

/**
 * Represents the current user's details from Jira.
 */
export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

