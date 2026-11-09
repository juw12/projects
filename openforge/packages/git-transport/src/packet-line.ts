/**
 * Git Smart HTTP packet-line protocol.
 *
 * Each "packet line" is a length-prefixed blob:
 *
 *   "XXXX<content>"   where XXXX is the 4-byte hex length of (XXXX + content).
 *   "0000"            flush packet — end of section.
 *   "0001"            delimiter packet — section break inside a section.
 *
 * Content shorter than (length - 4) is padded with NUL bytes by git, but
 * parsers MUST tolerate either padded or unpadded input.
 *
 * `MAX_PACKET_SIZE` is 65516 — the largest data payload a single packet
 * may carry. For side-band-64k, that leaves 65520 bytes total (4 header +
 * 65516 data) inside the 65536-byte side-band channel that multiplexes
 * progress / error / data sub-streams.
 */
import { Readable } from 'node:stream'
import type { PacketLine } from './types.js'

export const MAX_PACKET_SIZE = 65516

const PACKET_MAX_LEN = 65520
const HEX_LEN = 4

export function writePacketLine(text: string | Buffer): Buffer {
  const payload = typeof text === 'string' ? Buffer.from(text, 'binary') : text
  const totalLength = payload.length + HEX_LEN
  if (totalLength > PACKET_MAX_LEN) {
    throw new RangeError(
      `packet-line payload exceeds MAX_PACKET_SIZE (${MAX_PACKET_SIZE} bytes), got ${payload.length}`,
    )
  }
  const header = Buffer.from(totalLength.toString(16).padStart(HEX_LEN, '0'), 'ascii')
  return Buffer.concat([header, payload])
}

export function writeFlushPacket(): Buffer {
  return Buffer.from('0000', 'ascii')
}

export function writeDelimiterPacket(): Buffer {
  return Buffer.from('0001', 'ascii')
}

export function writeErrorLine(text: string): Buffer {
  return writePacketLine(`ERR ${text}\n`)
}

/**
 * Async-iterate packet-lines out of a Node Readable stream. Each yielded
 * value is either {kind: 'flush'|'delim'}, or {kind: 'data'|'error', data, text}.
 *
 * The stream may produce arbitrary chunk boundaries; we accumulate bytes
 * internally until we can emit complete packets. A truncated final packet
 * (stream ended mid-packet) raises — callers should treat this as a
 * protocol violation rather than silently discarding bytes.
 */
export async function* parsePacketLines(
  stream: Readable,
): AsyncGenerator<PacketLine, void, void> {
  let buffer = Buffer.alloc(0)

  for await (const chunk of stream) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    buffer = buffer.length === 0 ? incoming : Buffer.concat([buffer, incoming])

    while (buffer.length >= HEX_LEN) {
      const headerHex = buffer.subarray(0, HEX_LEN).toString('ascii')
      const length = Number.parseInt(headerHex, 16)

      if (Number.isNaN(length) || length < 0) {
        throw new Error(`packet-line: invalid length header "${headerHex}"`)
      }

      if (length === 0) {
        yield { kind: 'flush' }
        buffer = buffer.subarray(HEX_LEN)
        continue
      }

      if (length === 1) {
        yield { kind: 'delim' }
        buffer = buffer.subarray(HEX_LEN)
        continue
      }

      if (length < HEX_LEN || length > PACKET_MAX_LEN) {
        throw new Error(`packet-line: out-of-range length ${length} (${headerHex})`)
      }

      if (buffer.length < length) {
        break
      }

      const payload = buffer.subarray(HEX_LEN, length)
      const text = payload.toString('utf8')
      if (text.startsWith('ERR ')) {
        yield { kind: 'error', data: Buffer.from(payload), text }
      } else {
        yield { kind: 'data', data: Buffer.from(payload), text }
      }
      buffer = buffer.subarray(length)
    }
  }

  if (buffer.length > 0) {
    throw new Error(
      `packet-line: stream ended with ${buffer.length} unparsed trailing byte(s)`,
    )
  }
}

/**
 * Convenience: parse packet-lines out of a Buffer synchronously by
 * delegating to the streaming parser. Used by tests and by callers that
 * already have the full byte sequence in memory.
 */
export function parsePacketLinesFromBuffer(buf: Buffer): PacketLine[] {
  const stream = Readable.from(buf)
  const out: PacketLine[] = []
  // Drain synchronously via the async iterator.
  return (() => {
    const iter = parsePacketLines(stream)
    const collect = async (): Promise<void> => {
      for await (const line of iter) out.push(line)
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    collect()
    return out
  })()
}
