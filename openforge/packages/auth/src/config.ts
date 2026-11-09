// @openforge/auth — Better Auth instance.
//
// Schema column mapping for the `users` table is non-default (the @openforge/db
// schema uses `displayName` / `avatarUrl` / `emailVerifiedAt` / `passwordHash`)
// — declared under `user.fields` so Better Auth reads/writes the right columns.
//
// Sessions are stateless (JWT in the cookie, no Better Auth `session` table);
// the `sessions` table in @openforge/db stores refresh-token hashes only.
//
// Plugins left empty on purpose:
//   - `twoFactor` lives in better-auth/plugins but creates its own `twoFactor`
//     table with `twoFactorSecret` (XChaCha20-Poly1305, app-secret-encrypted).
//     Our schema stores `totpSecretEnc` directly on `users` (bytea) — same
//     shape, different location. We implement TOTP via `./totp.ts`.
//   - `passkey` lives in @better-auth/passkey and creates a `passkey` table.
//     Our schema has only `users.webauthnCredentialId`. We implement WebAuthn
//     via `./webauthn.ts` and store credentials in a future migration.
//
// `advanced.cookies.session_token` controls the Better Auth session cookie;
// `useSecureCookies: true` forces Secure even on http://localhost so the dev
// cookie matches prod — flip back to `false` (or omit) if you ever run dev
// without HTTPS.

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from '@openforge/db';
import { hashPassword, verifyPassword } from './password.js';

const trustedOrigins = (process.env['TRUSTED_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),

  baseURL: process.env['BETTER_AUTH_URL'],
  secret: process.env['BETTER_AUTH_SECRET'],
  trustedOrigins,

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    // argon2id — see src/password.ts. OWASP 2024 params (19 MiB / t=2 / p=1).
    password: {
      hash: (password) => hashPassword(password),
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // sliding-window refresh, once per day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes — hot path skips the DB
    },
  },

  // Map Better Auth's default field names onto @openforge/db's column names.
  // The `users` table in @openforge/db doesn't use `name` / `image` /
  // `emailVerified` / `password`; it uses `displayName` / `avatarUrl` /
  // `emailVerifiedAt` / `passwordHash`.
  user: {
    fields: {
      name: 'displayName',
      image: 'avatarUrl',
      emailVerified: 'emailVerifiedAt',
      password: 'passwordHash',
    },
    additionalFields: {
      // Server-owned — never accepted from client input, never returned.
      role: { type: 'string', required: false, input: false, returned: false },
      isAdmin: { type: 'boolean', required: false, input: false, returned: false },
      totpEnabled: { type: 'boolean', required: false, input: false, returned: false },
      webauthnCredentialId: { type: 'string', required: false, input: false, returned: false },
      // totpSecretEnc is bytea — not representable in Better Auth's
      // additionalFields type union, so it's left out of this map and
      // managed exclusively via the totp.ts endpoints.
    },
  },

  advanced: {
    // Let Postgres generate UUIDs via `defaultRandom()` on the column.
    database: { generateId: false },
    // Force `Secure` on the cookie even in dev so local dev matches prod.
    // Set to `false` or remove this if you run dev on plain http://.
    useSecureCookies: true,
    cookies: {
      session_token: {
        name: 'openforge_session',
        attributes: {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        },
      },
    },
    // CSRF + origin checks stay on (defaults); the comment is here so future
    // contributors know these are load-bearing and shouldn't be disabled.
  },

  plugins: [],
});

export type Auth = typeof auth;
