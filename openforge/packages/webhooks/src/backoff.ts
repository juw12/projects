/**
 * Full-jitter exponential backoff matching GitHub's webhook retry schedule.
 *
 * Schedule (minutes): 1, 5, 10, 20, 40, 80, 160, 320, 640, then hourly for 21h.
 * Total: 30 attempts over ~24 hours.
 *
 * Full jitter: the actual delay is uniform-random in [0, base). This prevents
 * the synchronized-retry thundering herd that GitHub's Oct 2022 outage
 * (https://github.blog/news-insights/company-news/github-availability-report-october-2022/)
 * demonstrated.
 */

export const RETRY_SCHEDULE_MINUTES = [
  1, 5, 10, 20, 40, 80, 160, 320, 640,
  ...Array.from({ length: 21 }, () => 60), // 21 hourly retries
]

export const MAX_ATTEMPTS = 30

/**
 * Returns the base backoff window in milliseconds for the given attempt number.
 * `attempt` is 1-indexed (first retry = attempt 1).
 */
export function baseBackoffMs(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), RETRY_SCHEDULE_MINUTES.length - 1)
  return RETRY_SCHEDULE_MINUTES[idx] * 60 * 1000
}

/**
 * Returns the actual backoff delay for this attempt, using full-jitter.
 * Result is in [0, baseBackoffMs(attempt)).
 */
export function computeBackoffMs(attempt: number): number {
  return Math.floor(Math.random() * baseBackoffMs(attempt))
}

/**
 * Compute the next retry timestamp for a delivery, given its current attempt count.
 * Persist `nextRetryAt` so the BullMQ delayed job wakes at the right time.
 */
export function nextRetryAt(attempt: number, now: number = Date.now()): Date {
  return new Date(now + computeBackoffMs(attempt))
}
