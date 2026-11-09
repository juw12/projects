//! PostgreSQL wire protocol message framing primitives.
//!
//! PG wire protocol v3 uses two framing modes:
//!
//! **Startup messages** (before the first Query): no type byte.
//! `[Int32 length][payload]` — length includes the 4 bytes of the length field.
//!
//! **Regular messages** (after startup): 1-byte type + length.
//! `[type: 1][Int32 length][payload]` — length includes the 4 bytes of length,
//! but NOT the type byte.
//!
//! Spec: https://www.postgresql.org/docs/current/protocol-message-formats.html

use anyhow::{bail, Result};
use bytes::{Buf, BufMut, BytesMut};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Maximum startup packet length per PG spec.
pub const MAX_STARTUP_PACKET_LENGTH: i32 = 10_000;

/// Protocol version code for v3.0.
pub const PROTOCOL_VERSION_3: i32 = 196_608;

/// SSL request code.
pub const SSL_REQUEST_CODE: i32 = 808_771_03;

/// Cancel request code.
pub const CANCEL_REQUEST_CODE: i32 = 808_771_02;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/// Read exactly `n` bytes from `reader` into a fresh `BytesMut`.
pub async fn read_bytes<R: AsyncRead + Unpin + ?Sized>(reader: &mut R, n: usize) -> Result<BytesMut> {
    let mut buf = vec![0u8; n];
    reader.read_exact(&mut buf).await.map_err(|e| anyhow::anyhow!("read_exact({}): {}", n, e))?;
    let mut bm = BytesMut::with_capacity(n);
    bm.put_slice(&buf);
    Ok(bm)
}

/// Read a big-endian `Int32`.
pub async fn read_i32<R: AsyncRead + Unpin + ?Sized>(reader: &mut R) -> Result<i32> {
    let b = read_bytes(reader, 4).await?;
    Ok(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// Read a big-endian `Int16`.
pub async fn read_i16<R: AsyncRead + Unpin + ?Sized>(reader: &mut R) -> Result<i16> {
    let b = read_bytes(reader, 2).await?;
    Ok(i16::from_be_bytes([b[0], b[1]]))
}

/// Read a single byte.
pub async fn read_u8<R: AsyncRead + Unpin + ?Sized>(reader: &mut R) -> Result<u8> {
    let b = read_bytes(reader, 1).await?;
    Ok(b[0])
}

/// Read a null-terminated C string from the stream.
pub async fn read_cstring<R: AsyncRead + Unpin + ?Sized>(reader: &mut R) -> Result<String> {
    let mut buf = BytesMut::with_capacity(256);
    let mut byte = [0u8; 1];
    loop {
        reader.read_exact(&mut byte).await.map_err(|e| anyhow::anyhow!("read_cstring: {}", e))?;
        if byte[0] == 0 {
            break;
        }
        buf.put_u8(byte[0]);
    }
    String::from_utf8(buf.to_vec()).map_err(|e| anyhow::anyhow!("invalid UTF-8 in cstring: {}", e))
}

/// Read the initial startup packet (no type byte).
///
/// Returns `(length, payload)` where `payload` is the bytes after the 4-byte length.
/// Rejects packets larger than `MAX_STARTUP_PACKET_LENGTH`.
pub async fn read_startup_packet<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
) -> Result<(i32, BytesMut)> {
    let length = read_i32(reader).await?;
    if length < 4 {
        bail!("startup packet too short: length={}", length);
    }
    if length > MAX_STARTUP_PACKET_LENGTH {
        bail!(
            "startup packet too large: {} > {}",
            length,
            MAX_STARTUP_PACKET_LENGTH
        );
    }
    let payload_len = (length - 4) as usize;
    let payload = read_bytes(reader, payload_len).await?;
    Ok((length, payload))
}

/// Read a regular (type-tagged) message header: type byte + Int32 length.
/// Returns `(type_byte, payload_length)` where `payload_length = length - 4`.
pub async fn read_message_header<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
) -> Result<(u8, usize)> {
    let msg_type = read_u8(reader).await?;
    let length = read_i32(reader).await?;
    if length < 4 {
        bail!("message '{}' too short: length={}", msg_type as char, length);
    }
    let payload_len = (length - 4) as usize;
    Ok((msg_type, payload_len))
}

/// Read the payload of a regular message (given the payload length from the header).
pub async fn read_payload<R: AsyncRead + Unpin + ?Sized>(
    reader: &mut R,
    len: usize,
) -> Result<BytesMut> {
    read_bytes(reader, len).await
}

// ---------------------------------------------------------------------------
// Writers (into a BytesMut buffer)
// ---------------------------------------------------------------------------

/// Append a big-endian `Int32`.
pub fn write_i32(buf: &mut BytesMut, val: i32) {
    buf.put_i32(val);
}

/// Append a big-endian `Int16`.
pub fn write_i16(buf: &mut BytesMut, val: i16) {
    buf.put_i16(val);
}

/// Append a single byte.
pub fn write_u8(buf: &mut BytesMut, val: u8) {
    buf.put_u8(val);
}

/// Append a null-terminated C string.
pub fn write_cstring(buf: &mut BytesMut, s: &str) {
    buf.extend_from_slice(s.as_bytes());
    buf.put_u8(0);
}

/// Append raw bytes.
pub fn write_bytes(buf: &mut BytesMut, data: &[u8]) {
    buf.extend_from_slice(data);
}

// ---------------------------------------------------------------------------
// Framed message builders
// ---------------------------------------------------------------------------

/// Build a regular (type-tagged) framed message: `[type][Int32 len][payload]`.
///
/// `length` = 4 + payload_len (includes the 4 length bytes, excludes the type byte).
pub fn build_framed(msg_type: u8, payload: &BytesMut) -> BytesMut {
    let len = (4 + payload.len()) as i32;
    let mut buf = BytesMut::with_capacity(5 + payload.len());
    buf.put_u8(msg_type);
    buf.put_i32(len);
    buf.extend_from_slice(payload);
    buf
}

/// Build a startup message (no type byte): `[Int32 len][payload]`.
///
/// `length` = 4 + payload_len (includes the 4 length bytes).
pub fn build_startup(payload: &BytesMut) -> BytesMut {
    let len = (4 + payload.len()) as i32;
    let mut buf = BytesMut::with_capacity(4 + payload.len());
    buf.put_i32(len);
    buf.extend_from_slice(payload);
    buf
}

/// Write a complete message to the stream.
pub async fn write_message<W: AsyncWrite + Unpin + ?Sized>(
    writer: &mut W,
    msg_type: u8,
    payload: &BytesMut,
) -> Result<()> {
    let framed = build_framed(msg_type, payload);
    writer.write_all(&framed).await.map_err(|e| anyhow::anyhow!("write_message: {}", e))?;
    writer.flush().await.map_err(|e| anyhow::anyhow!("flush: {}", e))?;
    Ok(())
}

/// Write a raw byte (used for the SSL response 'N'/'S').
pub async fn write_raw_byte<W: AsyncWrite + Unpin + ?Sized>(writer: &mut W, b: u8) -> Result<()> {
    writer.write_all(&[b]).await.map_err(|e| anyhow::anyhow!("write_raw_byte: {}", e))?;
    writer.flush().await.map_err(|e| anyhow::anyhow!("flush: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Parse helpers for payload bytes
// ---------------------------------------------------------------------------

/// Parse a `BytesMut` as a sequence of null-terminated key-value pairs
/// (used for StartupMessage parameters).
pub fn parse_key_value_pairs(buf: &BytesMut) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut bytes = buf.clone();
    while bytes.has_remaining() {
        let key = read_cstring_buf(&mut bytes);
        if key.is_empty() {
            break;
        }
        let val = read_cstring_buf(&mut bytes);
        pairs.push((key, val));
    }
    pairs
}

fn read_cstring_buf(buf: &mut BytesMut) -> String {
    let mut bytes = Vec::new();
    while buf.has_remaining() {
        let b = buf.get_u8();
        if b == 0 {
            break;
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Read a null-terminated string from a `BytesMut` (consuming bytes).
pub fn read_cstring_from_buf(buf: &mut BytesMut) -> Option<String> {
    let mut bytes = Vec::new();
    while buf.has_remaining() {
        let b = buf.get_u8();
        if b == 0 {
            return Some(String::from_utf8_lossy(&bytes).into_owned());
        }
        bytes.push(b);
    }
    None
}
