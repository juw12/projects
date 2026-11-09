//! Encode/decode for the specific PostgreSQL wire protocol messages we handle.
//!
//! Message type bytes:
//!   Client → Server: Q (Query), X (Terminate), p (Password/SASL)
//!   Server → Client: R (Auth), S (ParameterStatus), K (BackendKeyData),
//!                    Z (ReadyForQuery), T (RowDescription), D (DataRow),
//!                    C (CommandComplete), E (ErrorResponse)
//!
//! Spec: https://www.postgresql.org/docs/current/protocol-message-formats.html

use bytes::{Buf, BufMut, BytesMut};
use super::frame;

// ---------------------------------------------------------------------------
// Message type constants
// ---------------------------------------------------------------------------

// Client → Server
pub const MSG_QUERY: u8 = b'Q';
pub const MSG_TERMINATE: u8 = b'X';
pub const MSG_PASSWORD: u8 = b'p'; // also SASLInitialResponse / SASLResponse

// Server → Client
pub const MSG_AUTHENTICATION: u8 = b'R';
pub const MSG_PARAMETER_STATUS: u8 = b'S';
pub const MSG_BACKEND_KEY_DATA: u8 = b'K';
pub const MSG_READY_FOR_QUERY: u8 = b'Z';
pub const MSG_ROW_DESCRIPTION: u8 = b'T';
pub const MSG_DATA_ROW: u8 = b'D';
pub const MSG_COMMAND_COMPLETE: u8 = b'C';
pub const MSG_ERROR_RESPONSE: u8 = b'E';
pub const MSG_EMPTY_QUERY: u8 = b'I';

// Auth codes (Int32 in Authentication message payload)
pub const AUTH_OK: i32 = 0;
pub const AUTH_KERBEROS_V5: i32 = 2;
pub const AUTH_CLEARTEXT_PASSWORD: i32 = 3;
pub const AUTH_MD5_PASSWORD: i32 = 5;
pub const AUTH_SASL: i32 = 10;
pub const AUTH_SASL_CONTINUE: i32 = 11;
pub const AUTH_SASL_FINAL: i32 = 12;

// ReadyForQuery status
pub const RFQ_IDLE: u8 = b'I';
pub const RFQ_IN_TXN: u8 = b'T';
pub const RFQ_FAILED_TXN: u8 = b'E';

/// Authentication phase — tracks the `'p'` byte ambiguity.
///
/// The `'p'` byte means different things at different points:
///   - After AuthenticationCleartextPassword → PasswordMessage
///   - After AuthenticationSASL → SASLInitialResponse
///   - After AuthenticationSASLContinue → SASLResponse
#[derive(Debug, Clone, PartialEq)]
pub enum AuthPhase {
    /// Before any auth exchange.
    Initial,
    /// Sent AuthenticationCleartextPassword, expecting PasswordMessage.
    AwaitingPassword,
    /// Sent AuthenticationSASL, expecting SASLInitialResponse.
    AwaitingSaslInit,
    /// Sent AuthenticationSASLContinue, expecting SASLResponse.
    AwaitingSaslFinal,
    /// Auth complete.
    Authenticated,
}

// ---------------------------------------------------------------------------
// Startup message parsing
// ---------------------------------------------------------------------------

/// Parsed startup message parameters.
#[derive(Debug, Clone)]
pub struct StartupParams {
    pub protocol_version: i32,
    pub user: String,
    pub database: String,
    pub extra: Vec<(String, String)>,
}

/// Parse a startup message payload (after the 4-byte length).
///
/// Layout: `[Int32 protocol_version][key\0value\0 ... \0]`
pub fn parse_startup(payload: &BytesMut) -> anyhow::Result<StartupParams> {
    let mut buf = payload.clone();
    let protocol_version = read_i32_buf(&mut buf)?;
    if protocol_version != frame::PROTOCOL_VERSION_3 {
        anyhow::bail!(
            "unsupported protocol version: {} (expected {})",
            protocol_version,
            frame::PROTOCOL_VERSION_3
        );
    }

    let pairs = frame::parse_key_value_pairs(&buf);
    let mut user = String::from("postgres");
    let mut database = String::from("postgres");
    let mut extra = Vec::new();

    for (k, v) in pairs {
        match k.as_str() {
            "user" => user = v,
            "database" => database = v,
            _ => extra.push((k, v)),
        }
    }

    Ok(StartupParams {
        protocol_version,
        user,
        database,
        extra,
    })
}

// ---------------------------------------------------------------------------
// Server message encoders
// ---------------------------------------------------------------------------

/// AuthenticationOk: `R [Int32 len=8] [Int32 code=0]`
pub fn encode_auth_ok() -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, AUTH_OK);
    frame::build_framed(MSG_AUTHENTICATION, &p)
}

/// AuthenticationCleartextPassword: `R [Int32 len=8] [Int32 code=3]`
pub fn encode_auth_cleartext() -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, AUTH_CLEARTEXT_PASSWORD);
    frame::build_framed(MSG_AUTHENTICATION, &p)
}

/// AuthenticationSASL: `R [Int32 len] [Int32 code=10] [mechanism\0 ... \0]`
pub fn encode_auth_sasl(mechanisms: &[&str]) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, AUTH_SASL);
    for m in mechanisms {
        frame::write_cstring(&mut p, m);
    }
    frame::write_u8(&mut p, 0); // trailing null
    frame::build_framed(MSG_AUTHENTICATION, &p)
}

/// AuthenticationSASLContinue: `R [Int32 len] [Int32 code=11] [data]`
pub fn encode_auth_sasl_continue(data: &[u8]) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, AUTH_SASL_CONTINUE);
    frame::write_bytes(&mut p, data);
    frame::build_framed(MSG_AUTHENTICATION, &p)
}

/// AuthenticationSASLFinal: `R [Int32 len] [Int32 code=12] [data]`
pub fn encode_auth_sasl_final(data: &[u8]) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, AUTH_SASL_FINAL);
    frame::write_bytes(&mut p, data);
    frame::build_framed(MSG_AUTHENTICATION, &p)
}

/// ParameterStatus: `S [Int32 len] [name\0][value\0]`
pub fn encode_parameter_status(name: &str, value: &str) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_cstring(&mut p, name);
    frame::write_cstring(&mut p, value);
    frame::build_framed(MSG_PARAMETER_STATUS, &p)
}

/// BackendKeyData: `K [Int32 len=12] [Int32 pid] [Int32 secret]`
pub fn encode_backend_key_data(pid: i32, secret: i32) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i32(&mut p, pid);
    frame::write_i32(&mut p, secret);
    frame::build_framed(MSG_BACKEND_KEY_DATA, &p)
}

/// ReadyForQuery: `Z [Int32 len=5] [status_byte]`
pub fn encode_ready_for_query(status: u8) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_u8(&mut p, status);
    frame::build_framed(MSG_READY_FOR_QUERY, &p)
}

/// RowDescription: `T [Int32 len] [Int16 nfields] [field ...]`
///
/// Each field:
///   `[name\0][Int32 table_oid][Int16 attr_num][Int32 type_oid]
///    [Int16 type_size][Int32 type_mod][Int16 format_code]`
pub struct ColumnInfo {
    pub name: String,
    pub type_oid: i32,
    pub type_size: i16,
}

pub fn encode_row_description(columns: &[ColumnInfo]) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i16(&mut p, columns.len() as i16);
    for (i, col) in columns.iter().enumerate() {
        frame::write_cstring(&mut p, &col.name);
        frame::write_i32(&mut p, 0);            // table_oid (unknown)
        frame::write_i16(&mut p, (i + 1) as i16); // attribute_number (1-based)
        frame::write_i32(&mut p, col.type_oid);
        frame::write_i16(&mut p, col.type_size);
        frame::write_i32(&mut p, -1);           // type_modifier (default)
        frame::write_i16(&mut p, 0);            // format_code: 0 = text
    }
    frame::build_framed(MSG_ROW_DESCRIPTION, &p)
}

/// DataRow: `D [Int32 len] [Int16 ncol] [Int32 len + bytes] ...`
///
/// Each column: `[Int32 value_len (-1 for NULL)][value_bytes]`
pub fn encode_data_row(values: &[Option<&str>]) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_i16(&mut p, values.len() as i16);
    for v in values {
        match v {
            Some(s) => {
                frame::write_i32(&mut p, s.len() as i32);
                frame::write_bytes(&mut p, s.as_bytes());
            }
            None => {
                frame::write_i32(&mut p, -1); // NULL
            }
        }
    }
    frame::build_framed(MSG_DATA_ROW, &p)
}

/// CommandComplete: `C [Int32 len] [tag\0]`
pub fn encode_command_complete(tag: &str) -> BytesMut {
    let mut p = BytesMut::new();
    frame::write_cstring(&mut p, tag);
    frame::build_framed(MSG_COMMAND_COMPLETE, &p)
}

/// ErrorResponse: `E [Int32 len] [(field_code, value\0) ... \0]`
///
/// Field codes: S=Severity, V=SeverityUnlocalized, C=SQLSTATE,
///              M=Message, D=Detail, H=Hint
pub fn encode_error_response(severity: &str, sqlstate: &str, message: &str) -> BytesMut {
    let mut p = BytesMut::new();
    // S = Severity
    p.put_u8(b'S');
    frame::write_cstring(&mut p, severity);
    // V = Severity (unlocalized)
    p.put_u8(b'V');
    frame::write_cstring(&mut p, severity);
    // C = SQLSTATE code
    p.put_u8(b'C');
    frame::write_cstring(&mut p, sqlstate);
    // M = Message
    p.put_u8(b'M');
    frame::write_cstring(&mut p, message);
    // Terminator
    p.put_u8(0);
    frame::build_framed(MSG_ERROR_RESPONSE, &p)
}

/// EmptyQueryResponse: `I [Int32 len=4]`
pub fn encode_empty_query() -> BytesMut {
    frame::build_framed(MSG_EMPTY_QUERY, &BytesMut::new())
}

// ---------------------------------------------------------------------------
// Client message payload parsers
// ---------------------------------------------------------------------------

/// Parse a Query message payload: null-terminated SQL string.
pub fn parse_query(payload: &BytesMut) -> String {
    let mut buf = payload.clone();
    frame::read_cstring_from_buf(&mut buf).unwrap_or_default()
}

/// Parse a PasswordMessage payload: null-terminated password string.
pub fn parse_password(payload: &BytesMut) -> String {
    let mut buf = payload.clone();
    frame::read_cstring_from_buf(&mut buf).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Helper: read i32 from a BytesMut buffer
// ---------------------------------------------------------------------------
fn read_i32_buf(buf: &mut BytesMut) -> anyhow::Result<i32> {
    if buf.remaining() < 4 {
        anyhow::bail!("not enough bytes for i32");
    }
    Ok(buf.get_i32())
}
