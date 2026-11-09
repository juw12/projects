import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client, s3DrClient, PRIMARY_BUCKET, DR_BUCKET } from './clients.js'

const PUT_EXPIRES_SECONDS = 300 // 5 min — packfile upload window
const GET_EXPIRES_SECONDS = 900 // 15 min — fetch + CDN warm

export async function presignPut(key: string, contentType = 'application/octet-stream'): Promise<string> {
  return getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: PRIMARY_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: PUT_EXPIRES_SECONDS },
  )
}

export async function presignGet(key: string): Promise<string> {
  return getSignedUrl(
    r2Client,
    new GetObjectCommand({ Bucket: PRIMARY_BUCKET, Key: key }),
    { expiresIn: GET_EXPIRES_SECONDS },
  )
}

// DR variants — same keys, different bucket. Used by the replicator and by
// the DR read path when R2 is unavailable.
export async function presignPutDr(key: string, contentType = 'application/octet-stream'): Promise<string> {
  return getSignedUrl(
    s3DrClient,
    new PutObjectCommand({ Bucket: DR_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: PUT_EXPIRES_SECONDS },
  )
}

export async function presignGetDr(key: string): Promise<string> {
  return getSignedUrl(
    s3DrClient,
    new GetObjectCommand({ Bucket: DR_BUCKET, Key: key }),
    { expiresIn: GET_EXPIRES_SECONDS },
  )
}
