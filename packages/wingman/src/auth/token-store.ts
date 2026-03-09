/**
 * Token Store — persistent cache for OAuth tokens.
 *
 * Stores tokens per MCP server URL on disk (~/.wingman/tokens/)
 * and in memory. Handles expiry tracking with configurable buffer.
 */

import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp (seconds)
  scope: string;
  serverUrl: string;
  clientId: string;
  storedAt: number;
}

const TOKEN_DIR = join(homedir(), '.wingman', 'tokens');
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function tokenPath(serverUrl: string): string {
  return join(TOKEN_DIR, `${urlHash(serverUrl)}.json`);
}

const memoryCache = new Map<string, StoredToken>();

async function ensureDir(): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });
}

export async function loadToken(serverUrl: string): Promise<StoredToken | null> {
  const cached = memoryCache.get(serverUrl);
  if (cached && !isExpired(cached)) return cached;

  try {
    const raw = await readFile(tokenPath(serverUrl), 'utf-8');
    const token: StoredToken = JSON.parse(raw);
    if (!isExpired(token)) {
      memoryCache.set(serverUrl, token);
      return token;
    }
    // Expired but has refresh token — return it so caller can attempt refresh
    if (token.refreshToken) {
      memoryCache.set(serverUrl, token);
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveToken(token: StoredToken): Promise<void> {
  memoryCache.set(token.serverUrl, token);
  await ensureDir();
  await writeFile(tokenPath(token.serverUrl), JSON.stringify(token, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function removeToken(serverUrl: string): Promise<void> {
  memoryCache.delete(serverUrl);
  try {
    await unlink(tokenPath(serverUrl));
  } catch {
    // File didn't exist
  }
}

export function isExpired(token: StoredToken): boolean {
  return token.expiresAt * 1000 - Date.now() < EXPIRY_BUFFER_MS;
}

export function needsRefresh(token: StoredToken): boolean {
  const timeLeft = token.expiresAt * 1000 - Date.now();
  return timeLeft > 0 && timeLeft < EXPIRY_BUFFER_MS;
}

export async function listTokens(): Promise<StoredToken[]> {
  try {
    await ensureDir();
    const files = await readdir(TOKEN_DIR);
    const tokens: StoredToken[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(TOKEN_DIR, file), 'utf-8');
        tokens.push(JSON.parse(raw));
      } catch { /* skip corrupt files */ }
    }
    return tokens;
  } catch {
    return [];
  }
}

/** Invalidate in-memory cache (force reload from disk on next read). */
export function clearMemoryCache(): void {
  memoryCache.clear();
}
