import crypto from 'node:crypto'

export async function verifySha1(body: Buffer | Readable, expected: string): Promise<boolean> {
  const hash = crypto.createHash('sha1')
  if (Buffer.isBuffer(body)) {
    hash.update(body)
  } else {
    for await (const chunk of body) hash.update(chunk)
  }
  return hash.digest('hex') === expected.toLowerCase()
}
