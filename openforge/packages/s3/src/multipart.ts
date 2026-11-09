import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'
import { r2Client, PRIMARY_BUCKET } from './clients.js'
import { verifySha1 } from './integrity.js'

// S3 enforces a 5 MiB minimum per part (except the last). We use 64 MiB
// to keep part counts low: 64 MiB × 10,000 parts ≈ 640 GiB max object,
// which exceeds any plausible Git packfile, while keeping the per-part
// overhead (ETag round-trip) amortized over a large payload.
export const MULTIPART_THRESHOLD = 64 * 1024 * 1024
export const MULTIPART_CHUNK_SIZE = 64 * 1024 * 1024

export async function createMultipartUpload(
  key: string,
  contentType: string = 'application/octet-stream',
): Promise<{ uploadId: string; key: string }> {
  const result = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: PRIMARY_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
  )
  if (!result.UploadId) {
    throw new Error(`createMultipartUpload: missing UploadId for key ${key}`)
  }
  return { uploadId: result.UploadId, key }
}

export async function uploadPart(
  uploadId: string,
  key: string,
  partNumber: number,
  body: Buffer | Readable,
): Promise<{ etag: string; partNumber: number }> {
  const result = await r2Client.send(
    new UploadPartCommand({
      Bucket: PRIMARY_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    }),
  )
  if (!result.ETag) {
    throw new Error(`uploadPart ${partNumber}: missing ETag for key ${key}`)
  }
  return { etag: result.ETag, partNumber }
}

export async function completeMultipartUpload(
  uploadId: string,
  key: string,
  parts: { etag: string; partNumber: number }[],
): Promise<void> {
  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: PRIMARY_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
      },
    }),
  )
}

export async function abortMultipartUpload(uploadId: string, key: string): Promise<void> {
  await r2Client.send(
    new AbortMultipartUploadCommand({
      Bucket: PRIMARY_BUCKET,
      Key: key,
      UploadId: uploadId,
    }),
  )
}

// Orchestrates a full upload, choosing single PUT vs multipart based on size,
// and ALWAYS aborts the MPU on any failure to avoid orphan-part storage cost.
//
// SHA-1 verification: S3 ETag is NOT a content hash. For single PUT it's an
// MD5 of the body, but for multipart it's `md5-of-md5s-of-parts`. Git
// integrity is anchored on the SHA-1 in the object's filename, so we
// compute SHA-1 locally and return sha1Verified — the caller MUST trust
// that boolean, not the ETag, for content correctness.
export async function uploadLargeObject(
  key: string,
  body: Buffer,
  expectedSha1: string,
): Promise<{ etag: string; sha1Verified: boolean }> {
  const sha1Ok = await verifySha1(body, expectedSha1)

  // Single PUT path — below the multipart threshold.
  if (body.length < MULTIPART_THRESHOLD) {
    const result = await r2Client.send(
      new PutObjectCommand({
        Bucket: PRIMARY_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    )
    return { etag: result.ETag ?? '', sha1Verified: sha1Ok }
  }

  // Multipart path. Track uploadId + completed flag so the finally block
  // can abort on any error path (including the create call) without
  // aborting after a successful completion.
  let uploadId: string | undefined
  let completed = false
  try {
    const created = await createMultipartUpload(key)
    uploadId = created.uploadId

    const parts: { etag: string; partNumber: number }[] = []
    const partCount = Math.ceil(body.length / MULTIPART_CHUNK_SIZE)
    for (let i = 0; i < partCount; i++) {
      const partNumber = i + 1
      const start = i * MULTIPART_CHUNK_SIZE
      const end = Math.min(start + MULTIPART_CHUNK_SIZE, body.length)
      const chunk = body.subarray(start, end)
      const part = await uploadPart(uploadId, key, partNumber, chunk)
      parts.push(part)
    }

    await completeMultipartUpload(uploadId, key, parts)
    completed = true
    // For multipart, the assembled object's ETag is `md5-of-md5s` — not a
    // content hash. Report the last part's ETag as informational only.
    const lastEtag = parts.length > 0 ? (parts[parts.length - 1]?.etag ?? '') : ''
    return { etag: lastEtag, sha1Verified: sha1Ok }
  } finally {
    if (uploadId !== undefined && !completed) {
      // Abort errors must not mask the original failure.
      try {
        await abortMultipartUpload(uploadId, key)
      } catch {
        // Intentional: best-effort cleanup. Surface the original error.
      }
    }
  }
}
