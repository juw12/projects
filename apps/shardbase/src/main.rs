//! ShardBase — Minimal PostgreSQL wire protocol v3 frontend.
//!
//! Listens on 127.0.0.1:5432, accepts a single psql connection, and handles
//! a small subset of SQL (CREATE TABLE, INSERT, SELECT) against an in-memory
//! (or RocksDB) row store.
//!
//! SKELETON: single-connection, no TLS, no extended query protocol, no COPY.

mod sql;
mod storage;
mod wire;

use anyhow::Result;
use bytes::{Buf, BytesMut};
use rand::Rng;
use storage::RowStore;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tracing::{error, info, warn};
use wire::auth::Authenticator;
use wire::frame;
use wire::messages;

const LISTEN_ADDR: &str = "127.0.0.1:5432";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::FmtSubscriber::builder()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("ShardBase starting — PG wire protocol v3 skeleton");

    // Open storage (in-memory by default, RocksDB if feature enabled).
    #[cfg(feature = "rocksdb")]
    let store: Box<dyn RowStore> = {
        let rs = storage::RocksStore::open("./shardbase_data")?;
        Box::new(rs)
    };
    #[cfg(not(feature = "rocksdb"))]
    let store: Box<dyn RowStore> = Box::new(storage::MemoryStore::new());

    let listener = tokio::net::TcpListener::bind(LISTEN_ADDR).await?;
    info!("listening on {}", LISTEN_ADDR);

    // Single-connection skeleton: handle one connection at a time.
    loop {
        let (socket, addr) = listener.accept().await?;
        info!("connection from {}", addr);
        if let Err(e) = handle_connection(socket, &*store).await {
            error!("connection {} error: {}", addr, e);
        }
        info!("connection {} closed", addr);
    }
}

/// Handle a single PG client connection end-to-end.
async fn handle_connection(
    mut socket: TcpStream,
    store: &dyn RowStore,
) -> Result<()> {
    // ---- Phase 1: Read the initial startup packet (no type byte) ----
    let (len, payload) = frame::read_startup_packet(&mut socket).await?;

    // Determine what kind of startup packet this is.
    let code = {
        let mut buf = payload.clone();
        if buf.remaining() >= 4 {
            buf.get_i32()
        } else {
            0
        }
    };

    if code == frame::SSL_REQUEST_CODE {
        info!("client requested SSL — refusing with 'N' (skeleton)");
        frame::write_raw_byte(&mut socket, b'N').await?;
        // After SSL refusal, the client sends the real StartupMessage.
        let (_len2, payload2) = frame::read_startup_packet(&mut socket).await?;
        return handle_startup_and_queries(socket, payload2, store).await;
    }

    if code == frame::CANCEL_REQUEST_CODE {
        info!("cancel request received — closing");
        return Ok(());
    }

    // Regular StartupMessage.
    handle_startup_and_queries(socket, payload, store).await
}

/// After identifying the startup packet, run auth + query loop.
async fn handle_startup_and_queries(
    mut socket: TcpStream,
    startup_payload: BytesMut,
    store: &dyn RowStore,
) -> Result<()> {
    let params = messages::parse_startup(&startup_payload)?;
    info!(
        "startup: user={} db={} params={:?}",
        params.user, params.database, params.extra
    );

    // ---- Phase 2: Authentication ----
    let mut auth = Authenticator::new();
    let auth_msg = auth.begin_auth();
    socket.write_all(&auth_msg).await?;
    socket.flush().await?;

    // Read auth response messages until authenticated.
    loop {
        match auth.phase().clone() {
            wire::messages::AuthPhase::Authenticated => break,
            _ => {}
        }

        let (msg_type, payload_len) = frame::read_message_header(&mut socket).await?;
        let payload = frame::read_payload(&mut socket, payload_len).await?;

        match msg_type {
            messages::MSG_PASSWORD => {
                auth.handle_p_message(&payload, &mut socket).await?;
            }
            messages::MSG_TERMINATE => {
                info!("terminate during auth");
                return Ok(());
            }
            _ => {
                warn!("unexpected message '{}' during auth", msg_type as char);
                let err = messages::encode_error_response(
                    "FATAL",
                    "08000",
                    "unexpected message during authentication",
                );
                socket.write_all(&err).await?;
                socket.flush().await?;
                return Ok(());
            }
        }
    }

    // ---- Phase 3: Post-auth handshake ----
    let pid: i32 = std::process::id() as i32;
    let secret: i32 = rand::thread_rng().gen();
    info!("sending post-auth handshake: pid={} secret={:x}", pid, secret);
    wire::auth::send_post_auth(&mut socket, pid, secret).await?;

    // ---- Phase 4: Main query loop ----
    loop {
        let (msg_type, payload_len) = match frame::read_message_header(&mut socket).await {
            Ok(v) => v,
            Err(e) => {
                // Connection closed or read error — exit cleanly.
                if e.to_string().contains("unexpected end of file")
                    || e.to_string().contains("Broken pipe")
                {
                    info!("client disconnected");
                    return Ok(());
                }
                return Err(e);
            }
        };
        let payload = frame::read_payload(&mut socket, payload_len).await?;

        match msg_type {
            messages::MSG_QUERY => {
                let sql = messages::parse_query(&payload);
                info!(sql = %sql, "query");
                handle_query(&mut socket, &sql, store).await?;
            }
            messages::MSG_TERMINATE => {
                info!("terminate received");
                return Ok(());
            }
            // Extended query protocol messages — not implemented in skeleton.
            b'P' => send_error(&mut socket, "0A000", "Parse: extended query not implemented in skeleton").await?,
            b'B' => send_error(&mut socket, "0A000", "Bind: extended query not implemented in skeleton").await?,
            b'D' => send_error(&mut socket, "0A000", "Describe: extended query not implemented in skeleton").await?,
            b'E' => send_error(&mut socket, "0A000", "Execute: extended query not implemented in skeleton").await?,
            b'S' => {
                // Sync — just send ReadyForQuery.
                let msg = messages::encode_ready_for_query(messages::RFQ_IDLE);
                socket.write_all(&msg).await?;
                socket.flush().await?;
            }
            b'C' => {
                // Close — ignore.
            }
            other => {
                warn!("unknown message type: '{}'", other as char);
                send_error(&mut socket, "0A000", &format!("unknown message type: '{}'", other as char)).await?;
            }
        }
    }
}

/// Handle a single Query message: parse, execute, send results.
async fn handle_query(
    socket: &mut TcpStream,
    sql: &str,
    store: &dyn RowStore,
) -> Result<()> {
    let trimmed = sql.trim().trim_end_matches(';');
    if trimmed.is_empty() {
        let msg = messages::encode_empty_query();
        socket.write_all(&msg).await?;
        let rfq = messages::encode_ready_for_query(messages::RFQ_IDLE);
        socket.write_all(&rfq).await?;
        socket.flush().await?;
        return Ok(());
    }

    match sql::exec::execute(trimmed, store) {
        Ok(result) => {
            match result {
                sql::exec::QueryResult::Rows { columns, rows, tag } => {
                    // RowDescription
                    let rd = messages::encode_row_description(&columns);
                    socket.write_all(&rd).await?;
                    // DataRows
                    for row in &rows {
                        let str_row: Vec<Option<&str>> = row.iter().map(|v| v.as_deref()).collect();
                        let dr = messages::encode_data_row(&str_row);
                        socket.write_all(&dr).await?;
                    }
                    // CommandComplete
                    let cc = messages::encode_command_complete(&tag);
                    socket.write_all(&cc).await?;
                    // ReadyForQuery
                    let rfq = messages::encode_ready_for_query(messages::RFQ_IDLE);
                    socket.write_all(&rfq).await?;
                }
                sql::exec::QueryResult::Command { tag } => {
                    let cc = messages::encode_command_complete(&tag);
                    socket.write_all(&cc).await?;
                    let rfq = messages::encode_ready_for_query(messages::RFQ_IDLE);
                    socket.write_all(&rfq).await?;
                }
            }
            socket.flush().await?;
        }
        Err(e) => {
            error!(err = %e, "query execution failed");
            send_error(socket, "42601", &e.to_string()).await?;
        }
    }
    Ok(())
}

/// Send an ErrorResponse + ReadyForQuery('E').
async fn send_error(socket: &mut TcpStream, sqlstate: &str, message: &str) -> Result<()> {
    let err = messages::encode_error_response("ERROR", sqlstate, message);
    socket.write_all(&err).await?;
    let rfq = messages::encode_ready_for_query(messages::RFQ_FAILED_TXN);
    socket.write_all(&rfq).await?;
    socket.flush().await?;
    Ok(())
}
