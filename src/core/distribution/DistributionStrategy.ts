export interface DistributionStrategy<Issue> {
  distribute(
    issues: Issue[],
    dailyAvailabilityHours: Record<string, number>,
    context?: unknown,
  ): Record<string, Record<string, number>>; // issueKey -> dayISO -> minutes
}
