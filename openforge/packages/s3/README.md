# @openforge/s3

Cloudflare R2 (primary) and AWS S3 (disaster recovery) client for Git
packfile storage. All four providers behind the OpenForge object layer
(R2, S3 DR, future GCS / Azure mirrors) are strongly consistent, so the
code path is identical except for endpoint / region / credentials.

## Quick start

### 1. Create the R2 bucket

1. Cloudflare dashboard → R2 → **Create bucket** → name `openforge-packs`
   (override with `R2_BUCKET` env var).
2. Generate an API token with **Object Read & Write** scope limited to
   this bucket. Capture the Access Key ID and Secret Access Key.
3. Set the CORS policy to allow PUT from your web origin (see
   `apps/web` for the exact policy JSON).
4. (Optional) Apply lifecycle rules per [LIFECYCLE.md](./LIFECYCLE.md) —
   note that R2 has no IA / Glacier tiers, so most tier transitions
   apply only to the DR bucket.

Docs: <https://developers.cloudflare.com/r2/buckets/create-buckets/>

### 2. Create the S3 DR bucket

```bash
aws s3api create-bucket \
  --bucket openforge-packs-dr \
  --region us-east-1 \
  --create-bucket-configuration LocationConstraint=us-east-1

aws s3api put-bucket-versioning \
  --bucket openforge-packs-dr \
  --region us-east-1 \
  --versioning-configuration Status=Enabled

# Apply the lifecycle XML from LIFECYCLE.md
aws s3api put-bucket-lifecycle-configuration \
  --bucket openforge-packs-dr \
  --region us-east-1 \
  --lifecycle-configuration file://lifecycle.xml
```

Override the default bucket name with `S3_DR_BUCKET` and the region
with `AWS_REGION`.

### 3. Environment variables

```bash
# R2 (primary)
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=openforge-packs            # optional, default shown

# S3 (DR)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_DR_BUCKET=openforge-packs-dr      # optional, default shown
```

### 4. Use the presigned URLs

```typescript
import { presignPut, presignGet } from '@openforge/s3'

const url = await presignPut(`repos/acme/widgets/objects/pack/abc.pack`)

// Browser / curl PUT:
await fetch(url, {
  method: 'PUT',
  body: packfileBuffer,
  headers: { 'Content-Type': 'application/octet-stream' },
})

const download = await presignGet(`repos/acme/widgets/objects/pack/abc.pack`)
```

Raw curl:

```bash
# Upload
curl -X PUT --upload-file abc.pack "$PRESIGNED_PUT_URL"

# Download
curl -o abc.pack "$PRESIGNED_GET_URL"
```

## Multipart threshold

The split between single PUT and multipart is **64 MiB**.

- Below 64 MiB: one `PutObjectCommand`. Simple, atomic, one round-trip.
- 64 MiB and above: `CreateMultipartUpload` → part PUTs in 64 MiB
  chunks → `CompleteMultipartUpload`. On any failure along the way,
  the multipart upload is aborted in a `finally` block to avoid
  orphan-part storage cost.

### Why 64 MiB chunks

- S3's minimum part size is 5 MiB (except the last part). We use 64
  MiB to keep part counts low: 64 MiB × 10,000 parts ≈ 640 GiB max
  object, far beyond any plausible Git packfile.
- Each part incurs an ETag round-trip. Larger parts amortise that
  overhead.
- 64 MiB is a power-of-two multiple of the 5 MiB minimum, so chunks
  align cleanly without a tiny trailing part.

## Cost

| Provider | Egress | Notes |
| --- | --- | --- |
| Cloudflare R2 | **$0** | All egress is free; storage is $0.015/GB-month. |
| AWS S3 (DR) | $0.09/GB after 100 GB/month free tier | Storage tiers (IA at 30d, Glacier IR at 180d) reduce this. |

DR reads only happen during failover or drills — the cost is dominated
by storage, not egress.

## Security

- Presigned URLs cap at 7 days on S3 (and 7 days on R2). We deliberately
  use much shorter windows:
  - **PUT: 5 minutes** — the time a client needs to start and finish
    uploading a packfile. Anything longer is a stale-URL risk.
  - **GET: 15 minutes** — covers the round trip + a CDN warm-up fetch.
- All other access goes through signed AWS-SDK requests with the
  server-side credentials. The R2 token is scoped to one bucket.
- Packfile integrity is anchored on the Git SHA-1 in the filename.
  **Never trust the S3 ETag** — for single PUT it's an MD5, for
  multipart it's `md5-of-md5s-of-parts`. Use `verifySha1` /
  `sha1Verified` for content correctness.

## API surface

| Export | Purpose |
| --- | --- |
| `r2Client`, `s3DrClient` | Pre-configured `S3Client` instances |
| `PRIMARY_BUCKET`, `DR_BUCKET` | Bucket names from env |
| `presignPut`, `presignGet` | R2 primary URLs (5 min / 15 min) |
| `presignPutDr`, `presignGetDr` | S3 DR URLs |
| `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, `abortMultipartUpload` | Low-level MPU primitives |
| `uploadLargeObject` | Orchestrator: single PUT below 64 MiB, MPU above |
| `objectKey.*` | Key construction helpers (packfile, idx, midx, lfs, webhook, job log) |
| `replicateToDr` | R2 → S3 DR manual copy |
| `verifySha1` | SHA-1 over `Buffer` or `Readable` |
| `LIFECYCLE_IA_DAYS`, etc. | Policy constants mirrored from `LIFECYCLE.md` |

## Tests

```bash
pnpm --filter @openforge/s3 test
```

Tests are hermetic — they mock the `S3Client` and never hit the
network. Integration tests that require live credentials are marked
`.skip` and gated on env var presence; flip the skip locally before
running them against a real bucket.
