import { useCallback, useEffect, useRef, useState } from "react"

export interface McpAuthEntry {
  serverUrl: string
  serverName: string
  status: "authenticated" | "needs_auth" | "no_auth_required" | "error"
  expiresAt?: number
  error?: string
}

interface AuthState {
  mcpAuth: McpAuthEntry[]
  loading: boolean
  error: string | null
  /** Servers currently going through OAuth flow. */
  pendingLogins: Set<string>
}

export interface UseAuthStatusReturn {
  mcpAuth: McpAuthEntry[]
  loading: boolean
  error: string | null
  pendingLogins: Set<string>
  needsAuth: boolean
  login: (serverUrl: string) => Promise<void>
  logout: (serverUrl: string) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Hook for managing MCP server authentication state.
 *
 * Polls /api/auth/status for current state and provides
 * login/logout actions that trigger the OAuth flow.
 *
 * @param pollIntervalMs - How often to poll for auth status (default: 30000)
 * @param apiUrl - Base URL for the API (default: '')
 */
export function useAuthStatus(pollIntervalMs = 30_000, apiUrl = ''): UseAuthStatusReturn {
  const [state, setState] = useState<AuthState>({
    mcpAuth: [],
    loading: true,
    error: null,
    pendingLogins: new Set(),
  })

  const pendingLoginsRef = useRef(new Set<string>())

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/auth/status`)
      if (!res.ok) {
        throw new Error(`Auth status request failed (${res.status})`)
      }
      const data = await res.json()
      setState((prev) => ({
        ...prev,
        mcpAuth: data.servers ?? [],
        loading: false,
        error: null,
      }))
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [apiUrl])

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, pollIntervalMs)
    return () => clearInterval(interval)
  }, [fetchStatus, pollIntervalMs])

  /**
   * Start OAuth login for a specific MCP server.
   * Opens the authorization URL in a new tab and waits for callback.
   */
  const login = useCallback(async (serverUrl: string) => {
    pendingLoginsRef.current.add(serverUrl)
    setState((prev) => ({
      ...prev,
      pendingLogins: new Set(pendingLoginsRef.current),
    }))

    // Open a blank window immediately (synchronous with user gesture)
    // to avoid popup blockers, then redirect once we have the auth URL
    const authWindow = window.open("about:blank", "_blank", "noopener")

    try {
      // Request auth URL from backend
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl }),
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error ?? `Login request failed (${res.status})`)
      }

      const { authUrl, state: flowState } = await res.json()

      // Redirect the pre-opened window to the auth URL
      if (authWindow) {
        authWindow.location.href = authUrl
      } else {
        // Fallback if window was blocked
        window.open(authUrl, "_blank", "noopener,noreferrer")
      }

      // Wait for the callback (long poll)
      const waitRes = await fetch(`${apiUrl}/api/auth/wait/${flowState}`)
      if (!waitRes.ok) {
        const errData = await waitRes.json()
        throw new Error(errData.error ?? "Authentication failed")
      }

      // Refresh status
      await fetchStatus()
    } catch (e: unknown) {
      console.error("[Auth] Login failed:", e)
      setState((prev) => ({
        ...prev,
        error: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      pendingLoginsRef.current.delete(serverUrl)
      setState((prev) => ({
        ...prev,
        pendingLogins: new Set(pendingLoginsRef.current),
      }))
    }
  }, [apiUrl, fetchStatus])

  /**
   * Logout from a specific MCP server (remove cached token).
   */
  const logout = useCallback(async (serverUrl: string) => {
    try {
      await fetch(`${apiUrl}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl }),
      })
      await fetchStatus()
    } catch (e: unknown) {
      console.error("[Auth] Logout failed:", e)
    }
  }, [apiUrl, fetchStatus])

  const needsAuth = state.mcpAuth.some((s) => s.status === "needs_auth")

  return {
    mcpAuth: state.mcpAuth,
    loading: state.loading,
    error: state.error,
    pendingLogins: state.pendingLogins,
    needsAuth,
    login,
    logout,
    refresh: fetchStatus,
  }
}
