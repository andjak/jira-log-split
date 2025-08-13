// Global constants for adaptive concurrency and batching

// When there is no saved per-host value, start here
export const ADAPTIVE_DEFAULT_START_CONCURRENCY = 200;

// Fallback when settings are unavailable (e.g., tests) or unreadable
export const ADAPTIVE_FALLBACK_CONCURRENCY = 12;

// Upper bound for adaptive ramp-up
export const ADAPTIVE_MAX_CONCURRENCY = 1000;

// Backoff multiplier applied when throttling (429/503) is detected
export const ADAPTIVE_THROTTLE_BACKOFF_RATIO = 0.75;

// Ramp-up multiplier applied after a successful run without throttling
export const ADAPTIVE_RAMP_UP_RATIO = 1.1;

// Minimum absolute increment during ramp-up to ensure progress
export const ADAPTIVE_RAMP_UP_MIN_STEP = 1;

// Desired page size when requesting issues from Jira (server may cap)
export const JIRA_SEARCH_DESIRED_PAGE_SIZE = 1000;

// Default parallel workers for legacy paginated search (non-adaptive path)
export const JIRA_DEFAULT_PAGINATION_CONCURRENCY = 8;

// Dynamic batching limits for detailed Phase 2 fetch (keys -> changelog/comments)
export const DETAILED_BATCH_MIN_KEYS = 50;
export const DETAILED_BATCH_MAX_KEYS = 1000;

// TTL for caching permission-derived project filters (milliseconds)
export const PERMISSIONS_CACHE_TTL_MS = 60 * 60 * 1000; // 10 minutes


