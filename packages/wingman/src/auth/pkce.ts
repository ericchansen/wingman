/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0.
 * Implements RFC 7636 for public client auth flows.
 */

import { randomBytes, createHash } from 'node:crypto';

/** Generate a cryptographically random code verifier (43–128 chars, URL-safe). */
export function generateCodeVerifier(length = 64): string {
  return randomBytes(length).toString('base64url').slice(0, 128);
}

/** Compute S256 code challenge from a code verifier. */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Generate a cryptographically random state parameter (CSRF protection). */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}
