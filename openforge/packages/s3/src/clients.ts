import { S3Client } from '@aws-sdk/client-s3'

// R2 (Cloudflare) — primary storage. Region is literally the string "auto"
// for R2; the custom endpoint is what routes traffic to Cloudflare's edge.
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
})

// AWS S3 — disaster recovery. Real AWS region, no custom endpoint.
export const s3DrClient = new S3Client({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
})

export const PRIMARY_BUCKET = process.env.R2_BUCKET ?? 'openforge-packs'
export const DR_BUCKET = process.env.S3_DR_BUCKET ?? 'openforge-packs-dr'
