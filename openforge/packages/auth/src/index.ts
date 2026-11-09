// @openforge/auth — public surface.
//
// Better Auth instance lives in `./config.ts`. The other modules are protocol
// helpers (TOTP, WebAuthn, SSH keys, PATs, password hashing, secret-at-rest
// encryption) — exposed so that apps/api can wire them into routes that are
// NOT covered by Better Auth's built-in endpoints.

export { auth } from './config.js';
export type { Auth } from './config.js';

export { hashPassword, verifyPassword } from './password.js';
export { generateTotpSecret, verifyTotp, encryptedTotpSecret, decryptTotpSecret } from './totp.js';
export type { TotpSecret } from './totp.js';

export {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
} from './webauthn.js';

export { parseSshKey } from './ssh-keys.js';
export type { ParsedSshKey } from './ssh-keys.js';

export { issuePat, hashPat } from './pat.js';
export type { IssuedPat } from './pat.js';

export { encrypt, decrypt } from './crypto.js';

export { sessionMiddleware } from './middleware.js';
export { authRouter } from './router.js';
