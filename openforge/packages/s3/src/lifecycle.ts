/**
 * Lifecycle policy reference for the OpenForge packfile bucket.
 *
 * The actual rules are applied to the bucket out-of-band:
 *   - R2 (primary): Cloudflare dashboard or R2 API — no `mc` equivalent.
 *   - S3 DR:        `aws s3api put-bucket-lifecycle-configuration ...`
 *
 * See packages/s3/LIFECYCLE.md for the exact XML and CLI commands.
 *
 * These constants are exported so other packages (audit reports, ops
 * scripts, alerts) can reference the policy thresholds without
 * hard-coding the day counts.
 */

export const LIFECYCLE_IA_DAYS = 30
export const LIFECYCLE_GLACIER_IR_DAYS = 180
export const LIFECYCLE_ABORT_INCOMPLETE_MPU_DAYS = 3
export const LIFECYCLE_EXPIRE_NONCURRENT_DAYS = 30
