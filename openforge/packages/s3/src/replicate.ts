import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { r2Client, s3DrClient, PRIMARY_BUCKET, DR_BUCKET } from './clients.js'

/**
 * Phase 0: single-shot R2 → S3 DR copy via GetObject → PutObject.
 *
 * Why manual copy (not S3 Cross-Region Replication):
 *   - R2 and AWS S3 are different providers; S3 CRR cannot replicate from R2.
 *   - Manual copy emits an explicit audit log row in our app. CRR is
 *     invisible to us, and we want a per-org replication history.
 *   - Manual copy lets us add per-org rate limits and dead-letter handling
 *     in Phase 1 without fighting S3 replication rules.
 *
 * Caveat: for packfiles approaching 5 GB, this streams the entire object
 * through the API client. Phase 1: switch to multipart UploadPartCopy so
 * we can parallelise part fetches and stay under the 5 GB single-PUT cap.
 */
export async function replicateToDr(sourceKey: string): Promise<{ drKey: string }> {
  const getResult = await r2Client.send(
    new GetObjectCommand({ Bucket: PRIMARY_BUCKET, Key: sourceKey }),
  )
  if (!getResult.Body) {
    throw new Error(`replicateToDr: empty body for ${sourceKey}`)
  }

  // In the Node runtime, Body is a Readable. The SDK types it as a union
  // that includes Blob / ReadableStream — narrow here for streaming PUT.
  const body = getResult.Body as Readable

  await s3DrClient.send(
    new PutObjectCommand({
      Bucket: DR_BUCKET,
      Key: sourceKey, // same key on DR — identical addressing scheme
      Body: body,
      ContentType: getResult.ContentType ?? 'application/octet-stream',
    }),
  )

  return { drKey: sourceKey }
}
