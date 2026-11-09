# Bucket lifecycle — OpenForge packfile storage

This document is the source of truth for the lifecycle policy on the
`openforge-packs` (R2 primary) and `openforge-packs-dr` (S3 DR) buckets.
The rules are applied out-of-band; the matching constants live in
[`src/lifecycle.ts`](./src/lifecycle.ts) for code-level reference.

## Policy summary

| Rule | Threshold | Applies to R2? | Applies to S3 DR? |
| --- | --- | --- | --- |
| Transition to Infrequent Access | 30 days | **No** (R2 has no IA tier) | Yes |
| Transition to Glacier Instant Retrieval | 180 days | **No** (R2 has no Glacier tier) | Yes |
| Abort incomplete multipart uploads | 3 days | Yes (R2 supports this) | Yes |
| Expire noncurrent versions | 30 days | Yes (if versioning enabled) | Yes (if versioning enabled) |

R2 is a single-tier object store: every object is on the hot tier until
deleted. Cost optimisation on R2 comes from object count, not storage
class. The IA / Glacier transitions therefore apply only to the DR
bucket, where the storage-class savings are worth the retrieval latency.

## S3 DR lifecycle XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Rule>
    <ID>openforge-tier-transitions</ID>
    <Status>Enabled</Status>
    <Filter><Prefix></Prefix></Filter>
    <Transition>
      <Days>30</Days>
      <StorageClass>STANDARD_IA</StorageClass>
    </Transition>
    <Transition>
      <Days>180</Days>
      <StorageClass>GLACIER_IR</StorageClass>
    </Transition>
    <AbortIncompleteMultipartUpload>
      <DaysAfterInitiation>3</DaysAfterInitiation>
    </AbortIncompleteMultipartUpload>
    <NoncurrentVersionExpiration>
      <NoncurrentDays>30</NoncurrentDays>
    </NoncurrentVersionExpiration>
  </Rule>
</LifecycleConfiguration>
```

Save the above as `lifecycle.xml`, then apply:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket openforge-packs-dr \
  --region us-east-1 \
  --lifecycle-configuration file://lifecycle.xml
```

Verify:

```bash
aws s3api get-bucket-lifecycle-configuration \
  --bucket openforge-packs-dr \
  --region us-east-1
```

## R2 lifecycle

R2 does not expose a public lifecycle-configuration API comparable to
S3. The two equivalent controls are configured in the Cloudflare
dashboard:

1. **Object lifecycle rules** (Dashboard → R2 → bucket → Settings →
   Object Lifecycle). Enable rules to:
   - Delete objects older than N days if you want hard expiry (we do not
     enable this — packfiles must persist).
   - Abort incomplete multipart uploads after 3 days.

2. **Versioning + noncurrent expiration** (Settings → Object
   Lifecycle → Versioning). If versioning is enabled, expire noncurrent
   versions after 30 days to bound storage growth from overwrites.

For automation, use the [R2 API](https://developers.cloudflare.com/api/operations/r2-put-bucket-lifecycle)
(`PUT /accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle`) with the
same `<Days>` semantics. R2's accepted subset of the S3 schema is
documented under [R2 lifecycle
rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Rationale — 30 / 180 / 3 / 30

- **30 days → IA**: packfiles accessed in the first month after upload
  (recent clones, CI cache hits) stay hot. After 30 days, traffic
  drops off sharply; IA is the cheapest tier that still allows
  millisecond retrieval.
- **180 days → Glacier IR**: by six months, the packfile is almost
  never read except during disaster recovery drills. Glacier IR
  (~millisecond retrieval) keeps DR viable while cutting storage cost
  by ~80% vs IA.
- **3 days → abort MPU**: orphan parts from failed uploads cost real
  money. Three days gives any retry logic enough headroom while
  preventing runaway accumulation.
- **30 days → expire noncurrent**: bounds storage growth from versioned
  overwrites (e.g. force-push of a corrected packfile) at one month.

## Updating the policy

1. Edit this file with the new thresholds.
2. Update the matching constants in `src/lifecycle.ts`.
3. Re-apply via the CLI / API commands above.
4. Commit the change with a clear message referencing the bucket name.
