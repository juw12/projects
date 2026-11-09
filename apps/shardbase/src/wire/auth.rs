//! Authentication handling for the ShardBase PG-wire frontend.
//!
//! **SKELETON ONLY — NEVER USE IN PRODUCTION.**

use anyhow::{bail, Result};
use bytes::BytesMut;
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use super::frame;
use super::messages::{self, AuthPhase};

type HmacSha256 = Hmac<Sha256>;

const ACCEPTED_PASSWORD: &str = "postgres";
const SCRAM_SALT: &[u8] = b"shardbase-salt-01";
const SCRAM_ITERATIONS: u32 = 4096;

fn b64_encode(data: &[u8]) -> String {
    base64::engine::Engine::encode(&base64::engine::general_purpose::STANDARD, data)
}

#[derive(Debug)]
pub struct Authenticator {
    phase: AuthPhase,
    scram_combined_nonce: String,
    scram_client_first_bare: String,
    scram_server_first: String,
}

impl Authenticator {
    pub fn new() -> Self {
        Self {
            phase: AuthPhase::Initial,
            scram_combined_nonce: String::new(),
            scram_client_first_bare: String::new(),
            scram_server_first: String::new(),
        }
    }

    pub fn phase(&self) -> &AuthPhase {
        &self.phase
    }

    pub fn begin_auth(&mut self) -> BytesMut {
        self.phase = AuthPhase::AwaitingSaslInit;
        messages::encode_auth_sasl(&["SCRAM-SHA-256"])
    }

    pub async fn handle_p_message(
        &mut self,
        payload: &BytesMut,
        writer: &mut (impl tokio::io::AsyncWrite + Unpin + ?Sized),
    ) -> Result<()> {
        match self.phase.clone() {
            AuthPhase::AwaitingSaslInit => self.handle_sasl_initial(payload, writer).await,
            AuthPhase::AwaitingSaslFinal => self.handle_sasl_response(payload, writer).await,
            AuthPhase::AwaitingPassword => self.handle_cleartext(payload, writer).await,
            _ => bail!("unexpected 'p' in auth phase {:?}", self.phase),
        }
    }

    async fn handle_cleartext(
        &mut self,
        _payload: &BytesMut,
        writer: &mut (impl tokio::io::AsyncWrite + Unpin + ?Sized),
    ) -> Result<()> {
        self.phase = AuthPhase::Authenticated;
        let msg = messages::encode_auth_ok();
        writer.write_all(&msg).await?;
        writer.flush().await?;
        Ok(())
    }

    async fn handle_sasl_initial(
        &mut self,
        payload: &BytesMut,
        writer: &mut (impl tokio::io::AsyncWrite + Unpin + ?Sized),
    ) -> Result<()> {
        let mut buf = payload.clone();
        let mechanism = frame::read_cstring_from_buf(&mut buf).unwrap_or_default();
        if mechanism != "SCRAM-SHA-256" {
            bail!("unsupported SASL mechanism: {}", mechanism);
        }
        let client_first = String::from_utf8(buf.to_vec())?;
        tracing::info!("SCRAM client-first: {}", client_first);

        let client_first_bare = if client_first.starts_with("n,,") {
            client_first[3..].to_string()
        } else {
            client_first.clone()
        };

        let client_nonce = extract_field(&client_first_bare, "r=")
            .ok_or_else(|| anyhow::anyhow!("missing nonce in client-first"))?;

        let mut nonce_bytes = [0u8; 18];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let server_nonce = b64_encode(&nonce_bytes);
        let combined_nonce = format!("{}{}", client_nonce, server_nonce);

        self.scram_client_first_bare = client_first_bare;
        self.scram_combined_nonce = combined_nonce.clone();

        let server_first =
            format!("r={},s={},i={}", combined_nonce, b64_encode(SCRAM_SALT), SCRAM_ITERATIONS);
        self.scram_server_first = server_first.clone();

        self.phase = AuthPhase::AwaitingSaslFinal;
        let msg = messages::encode_auth_sasl_continue(server_first.as_bytes());
        writer.write_all(&msg).await?;
        writer.flush().await?;
        Ok(())
    }

    async fn handle_sasl_response(
        &mut self,
        payload: &BytesMut,
        writer: &mut (impl tokio::io::AsyncWrite + Unpin + ?Sized),
    ) -> Result<()> {
        let client_final = String::from_utf8(payload.to_vec())?;
        tracing::info!("SCRAM client-final: {}", client_final);

        let client_proof_b64 = extract_field(&client_final, "p=")
            .ok_or_else(|| anyhow::anyhow!("missing proof in client-final"))?;
        let proof_nonce = extract_field(&client_final, "r=")
            .ok_or_else(|| anyhow::anyhow!("missing nonce in client-final"))?;

        if proof_nonce != self.scram_combined_nonce {
            bail!("SCRAM nonce mismatch");
        }

        let mut salted_password = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            ACCEPTED_PASSWORD.as_bytes(),
            SCRAM_SALT,
            SCRAM_ITERATIONS,
            &mut salted_password,
        );

        let client_key = hmac_sha256(&salted_password, b"Client Key");
        let stored_key = Sha256::digest(&client_key);

        let client_final_without_proof =
            client_final.split(",p=").next().unwrap_or(&client_final);
        let auth_message = format!(
            "{},{},{}",
            self.scram_client_first_bare,
            self.scram_server_first,
            client_final_without_proof
        );

        let client_signature = hmac_sha256(&stored_key, auth_message.as_bytes());
        let expected_proof = xor_bytes(&client_key, &client_signature);
        let expected_proof_b64 = b64_encode(&expected_proof);

        if client_proof_b64 != expected_proof_b64 {
            bail!("SCRAM proof verification failed");
        }

        let server_key = hmac_sha256(&salted_password, b"Server Key");
        let server_signature = hmac_sha256(&server_key, auth_message.as_bytes());
        let server_final = format!("v={}", b64_encode(&server_signature));

        self.phase = AuthPhase::Authenticated;
        let msg1 = messages::encode_auth_sasl_final(server_final.as_bytes());
        writer.write_all(&msg1).await?;
        let msg2 = messages::encode_auth_ok();
        writer.write_all(&msg2).await?;
        writer.flush().await?;

        tracing::info!("SCRAM-SHA-256 authentication succeeded");
        Ok(())
    }
}

fn extract_field(msg: &str, key: &str) -> Option<String> {
    for part in msg.split(',') {
        if let Some(val) = part.strip_prefix(key) {
            return Some(val.to_string());
        }
    }
    None
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn xor_bytes(a: &[u8], b: &[u8]) -> Vec<u8> {
    a.iter().zip(b.iter()).map(|(x, y)| x ^ y).collect()
}

pub async fn send_post_auth(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin + ?Sized),
    pid: i32,
    secret: i32,
) -> Result<()> {
    let params: &[(&str, &str)] = &[
        ("server_version", "16.3"),
        ("server_encoding", "UTF8"),
        ("client_encoding", "UTF8"),
        ("DateStyle", "ISO, MDY"),
        ("IntervalStyle", "postgres"),
        ("TimeZone", "UTC"),
        ("integer_datetimes", "on"),
        ("standard_conforming_strings", "on"),
    ];

    for (name, value) in params {
        let msg = messages::encode_parameter_status(name, value);
        writer.write_all(&msg).await?;
    }

    let msg = messages::encode_backend_key_data(pid, secret);
    writer.write_all(&msg).await?;

    let msg = messages::encode_ready_for_query(messages::RFQ_IDLE);
    writer.write_all(&msg).await?;
    writer.flush().await?;
    Ok(())
}
