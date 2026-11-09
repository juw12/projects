// WebAuthn / passkey ceremony helpers, built on @simplewebauthn/server v13+.
//
// `userID` MUST be a Uint8Array in v13 — passing a string throws (the lib
// dropped implicit UTF-8 → base64url conversion). We pull the raw UUID bytes
// out of the user's `id` column here.
//
// The `rpID` is derived from BETTER_AUTH_URL's hostname. WebAuthn requires
// the RP ID to be a registrable domain; in dev, that's `localhost` over HTTPS
// (use mkcert or set BETTER_AUTH_URL=https://localhost).

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';

const rpName = 'OpenForge';
const rpOrigin = (() => {
  const u = process.env['BETTER_AUTH_URL'];
  if (!u) {
    throw new Error('BETTER_AUTH_URL must be set to derive the WebAuthn RP origin');
  }
  return u;
})();
const rpID = new URL(rpOrigin).hostname;

export interface WebAuthnUser {
  id: string; // uuid string
  email: string;
  displayName: string;
}

function uuidToBytes(id: string): Uint8Array {
  // RFC 4122 canonical hyphenated UUID → 16 raw bytes.
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid uuid for WebAuthn userID: ${id}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function registrationOptions(
  user: WebAuthnUser,
  existingCredentials: { id: string }[] = [],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: uuidToBytes(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: existingCredentials.map((c) => ({ id: c.id, type: 'public-key' })),
  });
}

export async function verifyRegistration(
  response: Parameters<typeof verifyRegistrationResponse>[0]['response'],
  expectedChallenge: string,
): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpID,
  });
}

export async function authenticationOptions(
  allowedCredentials: { id: string }[] = [],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: allowedCredentials.map((c) => ({ id: c.id, type: 'public-key' })),
  });
}

export async function verifyAuthentication(
  response: Parameters<typeof verifyAuthenticationResponse>[0]['response'],
  expectedChallenge: string,
): Promise<VerifiedAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpID,
  });
}
