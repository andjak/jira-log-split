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
  };
  changelog?: {
    histories: JiraChangelog[];
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

