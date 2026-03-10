import { useCallback, useEffect, useRef, useState } from 'react';

export interface McpAuthEntry {
  serverUrl: string;
  serverName: string;
  status: 'authenticated' | 'needs_auth' | 'no_auth_required' | 'error';
  expiresAt?: number;
  error?: string;
  /** Provider label derived from the OAuth authorization endpoint (e.g., "Microsoft"). */
  provider?: string;
}

interface AuthState {
  mcpAuth: McpAuthEntry[];
  /** Servers grouped by provider (from API). */
  groups: Record<string, McpAuthEntry[]>;
  loading: boolean;
  error: string | null;
  /** Servers currently going through OAuth flow. */
  pendingLogins: Set<string>;
}

export interface UseAuthStatusOptions {
  /**
   * Custom function to open auth URLs.
   *
   * By default, the hook uses `window.open()` to launch a browser popup.
   * Desktop / Electron apps should pass `shell.openExternal` (or a wrapper)
   * so sign-in opens in the user's default system browser with their existing
   * profile, saved passwords, and SSO session.
   *
   * @example
   * ```ts
   * import { shell } from 'electron';
   * useAuthStatus(30_000, '', { openAuthUrl: (url) => shell.openExternal(url) });
   * ```
   */
  openAuthUrl?: (url: string) => void | Promise<void>;
}

export interface UseAuthStatusReturn {
  mcpAuth: McpAuthEntry[];
  /** Servers grouped by provider (e.g., "Microsoft", "GitHub"). */
  groups: Record<string, McpAuthEntry[]>;
  loading: boolean;
  error: string | null;
  pendingLogins: Set<string>;
  needsAuth: boolean;
  login: (serverUrl: string) => Promise<void>;
  logout: (serverUrl: string) => Promise<void>;
  /** Cancel an in-progress login for a specific server. */
  cancelLogin: (serverUrl: string) => void;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing MCP server authentication state.
 *
 * Polls /api/auth/status for current state and provides
 * login/logout actions that trigger the OAuth flow.
 *
 * @param pollIntervalMs - How often to poll for auth status (default: 30000)
 * @param apiUrl - Base URL for the API (default: '')
 * @param options - Additional options (e.g. custom auth URL launcher for desktop apps)
 */
export function useAuthStatus(
  pollIntervalMs = 30_000,
  apiUrl = '',
  options?: UseAuthStatusOptions,
): UseAuthStatusReturn {
  const [state, setState] = useState<AuthState>({
    mcpAuth: [],
    groups: {},
    loading: true,
    error: null,
    pendingLogins: new Set(),
  });

  const pendingLoginsRef = useRef(new Set<string>());
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const openAuthUrlRef = useRef(options?.openAuthUrl);
  openAuthUrlRef.current = options?.openAuthUrl;

  // Abort any in-flight long-poll requests on unmount to avoid leaks
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => {
        try { controller.abort(); } catch { /* ignore */ }
      });
      abortControllersRef.current.clear();
      pendingLoginsRef.current.clear();
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/auth/status`);
      if (!res.ok) {
        throw new Error(`Auth status request failed (${res.status})`);
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        mcpAuth: data.servers ?? [],
        groups: data.groups ?? {},
        loading: false,
        error: null,
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, [apiUrl]);

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  /**
   * Start OAuth login for a specific MCP server.
   * Opens the authorization URL in a new tab and waits for callback.
   */
  const login = useCallback(async (serverUrl: string) => {
    pendingLoginsRef.current.add(serverUrl);
    setState((prev) => ({
      ...prev,
      pendingLogins: new Set(pendingLoginsRef.current),
    }));

    // Only pre-open a blank popup when using the default browser flow.
    // Desktop apps with a custom opener skip this entirely.
    // Read the ref at the last moment so hot-swapping the callback works.
    let authWindow: Window | null = null;
    if (!openAuthUrlRef.current) {
      // Avoid 'noopener' here so we retain a window reference for close detection.
      authWindow = window.open('about:blank', '_blank');
      if (authWindow) authWindow.opener = null; // prevent reverse-tabnabbing
    }

    try {
      // Request auth URL from backend
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? `Login request failed (${res.status})`);
      }

      const { authUrl, state: flowState } = await res.json();

      // Re-read the ref so we always use the latest callback
      const opener = openAuthUrlRef.current;
      if (opener) {
        // Desktop/Electron: launch in system browser
        await opener(authUrl);
      } else if (authWindow) {
        // Browser: redirect the pre-opened popup
        authWindow.location.href = authUrl;
      } else {
        // Fallback if window was blocked
        const fallback = window.open(authUrl, '_blank');
        if (fallback) {
          fallback.opener = null;
        } else {
          throw new Error(
            'Authentication popup was blocked. Please allow popups for this site and try again.',
          );
        }
      }

      // Wait for callback, but abort if the auth window is closed.
      // COOP headers on OAuth providers may block popup.closed access — handle gracefully.
      const abortController = new AbortController();
      abortControllersRef.current.set(serverUrl, abortController);
      let windowPollTimer: ReturnType<typeof setInterval> | undefined;

      if (authWindow) {
        windowPollTimer = setInterval(() => {
          try {
            if (authWindow.closed) {
              abortController.abort();
              if (windowPollTimer) clearInterval(windowPollTimer);
            }
          } catch {
            // COOP blocks cross-origin popup.closed — stop polling
            if (windowPollTimer) clearInterval(windowPollTimer);
          }
        }, 500);
      }

      try {
        const waitRes = await fetch(`${apiUrl}/api/auth/wait/${flowState}`, {
          signal: abortController.signal,
        });
        if (!waitRes.ok) {
          const errData = await waitRes.json();
          throw new Error(errData.error ?? 'Authentication failed');
        }
        // Refresh status
        await fetchStatus();
      } finally {
        if (windowPollTimer) clearInterval(windowPollTimer);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        // User closed the auth window — not a real error
        console.info('[Auth] Login cancelled — auth window was closed');
      } else {
        console.error('[Auth] Login failed:', e);
        setState((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    } finally {
      abortControllersRef.current.delete(serverUrl);
      pendingLoginsRef.current.delete(serverUrl);
      setState((prev) => ({
        ...prev,
        pendingLogins: new Set(pendingLoginsRef.current),
      }));
    }
  }, [apiUrl, fetchStatus]);

  /**
   * Logout from a specific MCP server (remove cached token).
   */
  const logout = useCallback(async (serverUrl: string) => {
    try {
      await fetch(`${apiUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl }),
      });
      await fetchStatus();
    } catch (e: unknown) {
      console.error('[Auth] Logout failed:', e);
    }
  }, [apiUrl, fetchStatus]);

  /**
   * Cancel an in-progress login for a specific server URL.
   */
  const cancelLogin = useCallback((serverUrl: string) => {
    const ac = abortControllersRef.current.get(serverUrl);
    if (ac) {
      ac.abort();
      abortControllersRef.current.delete(serverUrl);
    }

    // Clear pending state even if no AbortController exists yet
    pendingLoginsRef.current.delete(serverUrl);
    setState((prev) => {
      if (!prev.pendingLogins.has(serverUrl)) return prev;
      const nextPending = new Set(prev.pendingLogins);
      nextPending.delete(serverUrl);
      return { ...prev, pendingLogins: nextPending };
    });
  }, []);

  const needsAuth = state.mcpAuth.some((s) => s.status === 'needs_auth');

  return {
    mcpAuth: state.mcpAuth,
    groups: state.groups,
    loading: state.loading,
    error: state.error,
    pendingLogins: state.pendingLogins,
    needsAuth,
    login,
    logout,
    cancelLogin,
    refresh: fetchStatus,
  };
}
