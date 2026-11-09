import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import {
  MAX_PACKET_SIZE,
  parsePacketLines,
  writeDelimiterPacket,
  writeErrorLine,
  writeFlushPacket,
  writePacketLine,
} from '../src/packet-line.js'

describe('packet-line writer', () => {
  it('writePacketLine prefixes with 4-byte hex length', () => {
    const buf = writePacketLine('hello')
    expect(buf.toString('ascii')).toBe('0009hello')
  })

  it('writePacketLine handles binary payloads', () => {
    const payload = Buffer.from([0x00, 0x01, 0x02, 0xff])
    const buf = writePacketLine(payload)
    expect(buf.subarray(0, 4).toString('ascii')).toBe('0008')
    expect(buf.subarray(4)).toEqual(payload)
  })

  it('writeFlushPacket is exactly 0000', () => {
    expect(writeFlushPacket().toString('ascii')).toBe('0000')
  })

  it('writeDelimiterPacket is exactly 0001', () => {
    expect(writeDelimiterPacket().toString('ascii')).toBe('0001')
  })

  it('writeErrorLine produces an ERR pkt-line', () => {
    const buf = writeErrorLine('boom')
    // 4 (header) + 4 (ERR ) + 4 (boom) + 1 (\n) = 13
    expect(buf.toString('ascii')).toBe('000dERR boom\n')
  })

  it('rejects payloads larger than MAX_PACKET_SIZE', () => {
    expect(() => writePacketLine('x'.repeat(MAX_PACKET_SIZE + 1))).toThrow(RangeError)
  })
})

describe('packet-line parser', () => {
  it('roundtrips a single data packet', async () => {
    const buf = writePacketLine('hello')
    const stream = Readable.from(buf)
    const out: Array<{ kind: string; text?: string | undefined }> = []
    for await (const line of parsePacketLines(stream)) {
      out.push({ kind: line.kind, text: line.text })
    }
    expect(out).toEqual([{ kind: 'data', text: 'hello' }])
  })

  it('parses a flush packet as {kind: flush}', async () => {
    const stream = Readable.from(Buffer.concat([writePacketLine('a'), writeFlushPacket()]))
    const out: Array<{ kind: string; text?: string | undefined }> = []
    for await (const line of parsePacketLines(stream)) {
      out.push({ kind: line.kind, text: line.text })
    }
    expect(out).toEqual([
      { kind: 'data', text: 'a' },
      { kind: 'flush' },
    ])
  })

  it('parses a delim packet as {kind: delim}', async () => {
    const stream = Readable.from(
      Buffer.concat([writePacketLine('a'), writeDelimiterPacket(), writeFlushPacket()]),
    )
    const out: Array<{ kind: string; text?: string | undefined }> = []
    for await (const line of parsePacketLines(stream)) {
      out.push({ kind: line.kind, text: line.text })
    }
    expect(out).toEqual([
      { kind: 'data', text: 'a' },
      { kind: 'delim' },
      { kind: 'flush' },
    ])
  })

  it('parses a multi-packet stream across chunk boundaries', async () => {
    const composed = Buffer.concat([
      writePacketLine('first'),
      writePacketLine('second'),
      writeFlushPacket(),
    ])
    // Split the buffer mid-packet to force the parser to accumulate.
    const chunkA = composed.subarray(0, 9)
    const chunkB = composed.subarray(9)
    const stream = Readable.from([chunkA, chunkB])
    const out: Array<{ kind: string; text?: string | undefined }> = []
    for await (const line of parsePacketLines(stream)) {
      out.push({ kind: line.kind, text: line.text })
    }
    expect(out).toEqual([
      { kind: 'data', text: 'first' },
      { kind: 'data', text: 'second' },
      { kind: 'flush' },
    ])
  })

  it('classifies ERR-prefixed data as {kind: error}', async () => {
    const buf = writeErrorLine('nope')
    const stream = Readable.from(buf)
    const out: Array<{ kind: string; text?: string }> = []
    for await (const line of parsePacketLines(stream)) out.push(line)
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('error')
    expect(out[0]?.text).toBe('ERR nope\n')
  })

  it('roundtrips write→parse back to identical data', async () => {
    const original = ['hello', 'world', 'packfile-bytes']
    const composed = Buffer.concat(original.map(writePacketLine).concat([writeFlushPacket()]))
    const stream = Readable.from(composed)
    const recovered: string[] = []
    for await (const line of parsePacketLines(stream)) {
      if (line.kind === 'data') recovered.push(line.text ?? '')
    }
    expect(recovered).toEqual(original)
  })

  it('rejects an invalid hex length header', async () => {
    const stream = Readable.from(Buffer.from('zzzz', 'ascii'))
    await expect(async () => {
      for await (const _ of parsePacketLines(stream)) {
        // drain
      }
    }).rejects.toThrow(/invalid length header/)
  })

  it('rejects a truncated trailing packet', async () => {
    // '0009' says "9 bytes follow" but we only provide 3 bytes of payload.
    const stream = Readable.from(Buffer.from('0009abc', 'ascii'))
    await expect(async () => {
      for await (const _ of parsePacketLines(stream)) {
        // drain
      }
    }).rejects.toThrow(/trailing byte/)
  })
})
