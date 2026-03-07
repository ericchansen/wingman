/**
 * @wingman/react — Public API surface.
 *
 * React hooks and components for building chat UIs
 * on top of the GitHub Copilot SDK via Wingman.
 */

// Provider + hook
export { ChatProvider, useChat } from './providers/chat-provider.js';
export type { ChatProviderProps, ChatState, ChatContextValue } from './providers/chat-provider.js';

// Components
export { ChatMessage } from './components/chat-message.js';
export type { ChatMessageProps } from './components/chat-message.js';

export { ChatInput } from './components/chat-input.js';
export type { ChatInputProps } from './components/chat-input.js';

export { ToolStatus } from './components/tool-status.js';
export type { ToolStatusProps } from './components/tool-status.js';

export { ThinkingBlock } from './components/thinking-block.js';
export type { ThinkingBlockProps } from './components/thinking-block.js';

export { MarkdownRenderer } from './components/markdown-renderer.js';
export type { MarkdownRendererProps } from './components/markdown-renderer.js';

export { WelcomeScreen } from './components/welcome-screen.js';
export type { WelcomeScreenProps } from './components/welcome-screen.js';

// Phase 1 components (placeholders)
// export { ModelPicker } from './components/model-picker.js';
// export { ModeSwitcher } from './components/mode-switcher.js';
// export { TokenUsage } from './components/token-usage.js';
// export { ContextHealth } from './components/context-health.js';
// export { QuotaBar } from './components/quota-bar.js';
// export { MCPStatus } from './components/mcp-status.js';
// export { DebugPanel } from './components/debug-panel.js';
// export { PermissionDialog } from './components/permission-dialog.js';

export const VERSION = '0.1.0';
