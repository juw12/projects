# `@openforge/auth`

Authentication for OpenForge: Better Auth v1.6+ bound to the `users` /
`sessions` / `personal_access_tokens` / `ssh_keys` tables in `@openforge/db`,
plus protocol helpers for TOTP, WebAuthn / passkeys, OpenSSH public keys, and
PAT issuance.

## Quick start

1. **Generate secrets.**

   ```bash
   # 32 random bytes, base64 — Better Auth session signing
   openssl rand -base64 32

   # 32 random bytes, hex — AES-256-GCM key for TOTP secret encryption
   openssl rand -hex 32
   ```

2. **Wire them into `.env`.**

   ```env
   BETTER_AUTH_SECRET=<openssl rand -base64 32 output>
   BETTER_AUTH_URL=http://localhost:3000
   TRUSTED_ORIGINS=http://localhost:3000,http://localhost:8787

   # AES-256-GCM key for encrypting TOTP seeds in users.totp_secret_enc.
   # Generate with: openssl rand -hex 32
   SECRET_ENCRYPTION_KEY=<openssl rand -hex 32 output>
   ```

3. **Mount the Better Auth handler.** In `apps/api`:

   ```ts
   import { Hono } from 'hono';
   import { authRouter, sessionMiddleware } from '@openforge/auth';

   const app = new Hono();
   app.route('/api/auth', authRouter);  // Better Auth's built-in routes
   app.use('*', sessionMiddleware);     // resolves user/session on every req
   ```

## Adding custom user fields

The `users` table has server-owned columns that Better Auth doesn't know
about: `role`, `is_admin`, `totp_enabled`, `webauthn_credential_id`,
`totp_secret_enc`. They're declared under `user.additionalFields` in
`src/config.ts` with `input: false, returned: false` so:

- Clients can never set them via the Better Auth API surface.
- They're never leaked back to clients (no surprise disclosure of admin
  status or TOTP state).
- Our own routes can still read them via Drizzle.

`totp_secret_enc` (bytea) is intentionally **not** in `additionalFields` —
its type isn't representable in Better Auth's `additionalFields` type union,
and we manage it entirely via `src/totp.ts`.

To add a new column to `users`:

1. Add it to the Drizzle schema in `@openforge/db/src/schema/users.ts`.
2. Run `pnpm --filter @openforge/db generate && pnpm --filter @openforge/db migrate`.
3. Add it to `user.additionalFields` (or `user.fields` for renames) in
   `src/config.ts`.
4. Add a read/write route in `apps/api` if clients need to mutate it.

## Test passkey registration locally

WebAuthn requires the RP origin to be a **secure context** (HTTPS), even
on `localhost`. Two options:

- **`localhost` over HTTPS with mkcert** — closest to prod, recommended.

  ```bash
  brew install mkcert nss  # macOS; pick your platform's package
  mkcert -install
  mkcert localhost
  # Produces localhost.pem + localhost-key.pem — point your dev server at them.
  ```

  Then set `BETTER_AUTH_URL=https://localhost` in `.env`.

- **Plain HTTP with `useSecureCookies: false`** — disables Secure on cookies
  for dev only. The passkey prompt itself still needs a secure context, so
  this only solves cookies, not WebAuthn. Keep HTTPS for passkey work.

The WebAuthn RP ID is derived from `new URL(BETTER_AUTH_URL).hostname`, so
`https://localhost` → RP ID `localhost`.

## Security notes

- **Cookie posture.** `openforge_session` is `HttpOnly` + `Secure` +
  `SameSite=Lax`. `Secure` is forced via `advanced.useSecureCookies: true`,
  so dev must run over HTTPS or you'll be locked out. `SameSite=Lax` blocks
  cross-site POST credential leakage; `Strict` would break OAuth callbacks.
- **TOTP secrets at rest.** Stored in `users.totp_secret_enc` (bytea),
  encrypted with AES-256-GCM. The key is in `SECRET_ENCRYPTION_KEY` and never
  leaves the process — DB backups alone can't recover TOTP seeds. `totp.ts`
  is the only path that touches plaintext seeds.
- **PATs at rest.** `issuePat()` returns the raw token exactly once; only
  `hash` (`sha256`) and `prefix` (first 12 chars) are persisted in
  `personal_access_tokens`. Authentication is a SHA-256 compare on the
  inbound token.
- **SSH key parsing.** Malformed keys throw from `ssh2.utils.parseKey()` —
  no silent accept. The fingerprint stored in `ssh_keys.fingerprint_sha256`
  matches what `ssh-keygen -lf` prints, so users can verify visually.
- **Timing-safe comparisons.** Every secret comparison in this package is a
  hash-compare (PATs, TOTP). Direct comparisons happen nowhere here. If a
  future contributor needs one (e.g. API key prefix lookup), use
  `crypto.timingSafeEqual` on equal-length buffers — never `===` /
  `Buffer.equals` on a secret.

## Schema column mapping

Better Auth's defaults (`name`, `image`, `emailVerified`, `password`) don't
match the `@openforge/db` column names. The `user.fields` block in
`src/config.ts` maps them:

| Better Auth field | `users` column    |
| ----------------- | ----------------- |
| `name`            | `display_name`    |
| `image`           | `avatar_url`      |
| `emailVerified`   | `email_verified_at` |
| `password`        | `password_hash`   |

## Adding a plugin

Better Auth has first-party plugins (`twoFactor` in `better-auth/plugins`,
`passkey` in `@better-auth/passkey`). They ship their own DB tables that
don't match `@openforge/db`, so this package implements the protocols
itself. If you ever want to swap one in:

1. Add the plugin's table to `@openforge/db/src/schema/`.
2. Run `pnpm --filter @openforge/db generate && migrate`.
3. Install the plugin package and register it under `plugins:` in
   `src/config.ts`.
4. Delete the corresponding helper module here.
