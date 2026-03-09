/**
 * Auth module — standalone OAuth 2.0 for remote HTTP MCP servers.
 */

export {
  discoverAuthRequirements,
  startAuthFlow,
  waitForCallback,
  getValidToken,
  refreshToken,
  logout,
  getPendingFlows,
  shutdownCallbackServer,
  type OAuthServerConfig,
  type McpServerAuth,
} from './oauth-service.js';

export {
  loadToken,
  saveToken,
  removeToken,
  isExpired,
  needsRefresh,
  listTokens,
  clearMemoryCache,
  type StoredToken,
} from './token-store.js';

export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from './pkce.js';
