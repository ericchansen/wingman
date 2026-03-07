/**
 * ChatProvider — React context for Wingman chat state.
 *
 * Wraps the entire chat UI and provides shared state for messages,
 * tools, sessions, connection status, and streaming.
 */

import React, { createContext, useContext, useReducer, useCallback, useRef, type ReactNode } from 'react';
import type { ChatMessage, ToolExecution, UsageData } from '@wingman-chat/core';
import { ThemeProvider, type WingmanTheme, type WingmanThemeColors } from './theme-provider.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  sessionId: string | null;
  activeTools: Map<string, ToolExecution>;
  currentReasoning: string;
  isReasoningVisible: boolean;
  usage: UsageData | null;
  error: string | null;
  title: string | null;
  model: string | null;
  mode: string | null;
}

const initialState: ChatState = {
  messages: [],
  isStreaming: false,
  sessionId: null,
  activeTools: new Map(),
  currentReasoning: '',
  isReasoningVisible: false,
  usage: null,
  error: null,
  title: null,
  model: null,
  mode: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ChatAction =
  | { type: 'ADD_USER_MESSAGE'; content: string }
  | { type: 'START_STREAMING' }
  | { type: 'STOP_STREAMING' }
  | { type: 'APPEND_DELTA'; content: string }
  | { type: 'APPEND_REASONING'; content: string }
  | { type: 'SET_REASONING_VISIBLE'; visible: boolean }
  | { type: 'TOOL_START'; tool: Pick<ToolExecution, 'toolCallId' | 'toolName' | 'arguments'> }
  | { type: 'TOOL_COMPLETE'; toolCallId: string; toolName: string; result: string }
  | { type: 'SET_USAGE'; usage: UsageData }
  | { type: 'FINISH_STREAMING'; sessionId: string }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_MODE'; mode: string }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'LOAD_MESSAGES'; messages: ChatMessage[] };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            content: action.content,
            timestamp: Date.now(),
          },
        ],
        error: null,
      };

    case 'START_STREAMING':
      return {
        ...state,
        isStreaming: true,
        currentReasoning: '',
        messages: [
          ...state.messages,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            tools: [],
          },
        ],
      };

    case 'APPEND_DELTA': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.content };
      }
      return { ...state, messages: msgs };
    }

    case 'APPEND_REASONING':
      return {
        ...state,
        currentReasoning: state.currentReasoning + action.content,
        isReasoningVisible: true,
      };

    case 'SET_REASONING_VISIBLE':
      return { ...state, isReasoningVisible: action.visible };

    case 'TOOL_START': {
      const tools = new Map(state.activeTools);
      tools.set(action.tool.toolCallId, {
        toolCallId: action.tool.toolCallId,
        toolName: action.tool.toolName,
        arguments: action.tool.arguments,
        status: 'running',
        startedAt: Date.now(),
      });
      // Also add to the current assistant message's tools array
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = {
          ...last,
          tools: [
            ...(last.tools ?? []),
            {
              toolCallId: action.tool.toolCallId,
              toolName: action.tool.toolName,
              arguments: action.tool.arguments,
              status: 'running',
              startedAt: Date.now(),
            },
          ],
        };
      }
      return { ...state, activeTools: tools, messages: msgs };
    }

    case 'TOOL_COMPLETE': {
      const tools = new Map(state.activeTools);
      const existing = tools.get(action.toolCallId);
      if (existing) {
        tools.set(action.toolCallId, {
          ...existing,
          status: 'complete',
          result: action.result,
          completedAt: Date.now(),
        });
      }
      // Update in messages too
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && last.tools) {
        msgs[msgs.length - 1] = {
          ...last,
          tools: last.tools.map((t) =>
            t.toolCallId === action.toolCallId
              ? { ...t, status: 'complete' as const, result: action.result, completedAt: Date.now() }
              : t,
          ),
        };
      }
      return { ...state, activeTools: tools, messages: msgs };
    }

    case 'SET_USAGE': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, usage: action.usage };
      }
      return { ...state, usage: action.usage, messages: msgs };
    }

    case 'FINISH_STREAMING': {
      const tools = new Map(state.activeTools);
      // Mark remaining running tools as complete
      for (const [id, tool] of tools) {
        if (tool.status === 'running') {
          tools.set(id, { ...tool, status: 'complete', completedAt: Date.now() });
        }
      }
      // Attach reasoning to the assistant message
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && state.currentReasoning) {
        msgs[msgs.length - 1] = { ...last, reasoning: state.currentReasoning };
      }
      return {
        ...state,
        isStreaming: false,
        sessionId: action.sessionId,
        activeTools: tools,
        currentReasoning: '',
        isReasoningVisible: state.currentReasoning.length > 0,
        messages: msgs,
      };
    }

    case 'SET_ERROR':
      return { ...state, error: action.message, isStreaming: false };

    case 'STOP_STREAMING':
      return { ...state, isStreaming: false };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'SET_TITLE':
      return { ...state, title: action.title };

    case 'SET_MODEL':
      return { ...state, model: action.model };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.sessionId };

    case 'CLEAR_MESSAGES':
      return { ...initialState };

    case 'LOAD_MESSAGES':
      return { ...state, messages: action.messages };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ChatContextValue {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  /** Send a message to the agent via SSE. */
  sendMessage: (message: string) => void;
  /** Clear the current conversation and start fresh. */
  newChat: () => void;
  /** Switch the model for the current session. */
  switchModel: (model: string) => Promise<void>;
  /** Set the agent mode for the current session. */
  setMode: (mode: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ChatProviderProps {
  children: ReactNode;
  /** Base URL for the Wingman API. Default: '' (same origin). */
  apiUrl?: string;
  /** Color scheme: 'light', 'dark', or 'system'. Default: 'system'. */
  theme?: WingmanTheme;
  /** Override design token colors. */
  colors?: WingmanThemeColors;
  /** Additional CSS class on the theme root container. */
  className?: string;
}

export function ChatProvider({ children, apiUrl = '', theme, colors, className }: ChatProviderProps) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || state.isStreaming) return;

      // Abort any in-flight request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      dispatch({ type: 'CLEAR_ERROR' });
      dispatch({ type: 'ADD_USER_MESSAGE', content: message });
      dispatch({ type: 'START_STREAMING' });

      try {
        const response = await fetch(`${apiUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            sessionId: state.sessionId,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7);
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(currentEvent, data, dispatch);
              } catch {
                // Ignore malformed JSON
              }
              currentEvent = '';
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        dispatch({
          type: 'SET_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Always exit streaming state, even if the SSE stream ends
        // without a 'done' event (network drop, server crash, etc.)
        dispatch({ type: 'STOP_STREAMING' });
      }
    },
    [apiUrl, state.sessionId, state.isStreaming],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'CLEAR_MESSAGES' });
  }, []);

  const switchModel = useCallback(
    async (model: string) => {
      if (!state.sessionId) return;
      try {
        const res = await fetch(`${apiUrl}/api/session/${state.sessionId}/model`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        if (res.ok) {
          dispatch({ type: 'SET_MODEL', model });
        } else {
          const data = await res.json().catch(() => ({}));
          dispatch({ type: 'SET_ERROR', message: data.error ?? `Failed to switch model (${res.status})` });
        }
      } catch (err) {
        dispatch({ type: 'SET_ERROR', message: err instanceof Error ? err.message : 'Failed to switch model' });
      }
    },
    [apiUrl, state.sessionId],
  );

  const setMode = useCallback(
    async (mode: string) => {
      if (!state.sessionId) return;
      try {
        const res = await fetch(`${apiUrl}/api/session/${state.sessionId}/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        if (res.ok) {
          dispatch({ type: 'SET_MODE', mode });
        } else {
          const data = await res.json().catch(() => ({}));
          dispatch({ type: 'SET_ERROR', message: data.error ?? `Failed to set mode (${res.status})` });
        }
      } catch (err) {
        dispatch({ type: 'SET_ERROR', message: err instanceof Error ? err.message : 'Failed to set mode' });
      }
    },
    [apiUrl, state.sessionId],
  );

  return (
    <ThemeProvider theme={theme} colors={colors} className={className}>
      <ChatContext.Provider value={{ state, dispatch, sendMessage, newChat, switchModel, setMode }}>
        {children}
      </ChatContext.Provider>
    </ThemeProvider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a <ChatProvider>');
  }
  return context;
}

// ---------------------------------------------------------------------------
// SSE event handler
// ---------------------------------------------------------------------------

function handleSSEEvent(
  event: string,
  data: Record<string, unknown>,
  dispatch: React.Dispatch<ChatAction>,
) {
  switch (event) {
    case 'delta':
      dispatch({ type: 'APPEND_DELTA', content: data.content as string });
      break;
    case 'reasoning_delta':
      dispatch({ type: 'APPEND_REASONING', content: data.content as string });
      break;
    case 'tool_start':
      dispatch({
        type: 'TOOL_START',
        tool: {
          toolCallId: data.toolCallId as string,
          toolName: data.toolName as string,
          arguments: data.arguments as Record<string, unknown>,
        },
      });
      break;
    case 'tool_complete':
      dispatch({
        type: 'TOOL_COMPLETE',
        toolCallId: data.toolCallId as string,
        toolName: data.toolName as string,
        result: data.result as string,
      });
      break;
    case 'usage':
      dispatch({
        type: 'SET_USAGE',
        usage: {
          inputTokens: data.inputTokens as number,
          outputTokens: data.outputTokens as number,
          cacheReadTokens: data.cacheReadTokens as number | undefined,
          cacheWriteTokens: data.cacheWriteTokens as number | undefined,
          model: data.model as string | undefined,
        },
      });
      break;
    case 'done':
      dispatch({ type: 'FINISH_STREAMING', sessionId: data.sessionId as string });
      break;
    case 'error':
      dispatch({ type: 'SET_ERROR', message: data.message as string });
      break;
    case 'title_changed':
      dispatch({ type: 'SET_TITLE', title: data.title as string });
      break;
    case 'model_change':
      dispatch({ type: 'SET_MODEL', model: data.model as string });
      break;
    case 'mode_changed':
      dispatch({ type: 'SET_MODE', mode: data.mode as string });
      break;
    case 'heartbeat':
    case 'turn_start':
    case 'turn_end':
    case 'intent':
    case 'tool_progress':
    case 'info':
    case 'warning':
    case 'reasoning':
    case 'skill_invoked':
    case 'subagent_started':
    case 'subagent_completed':
    case 'subagent_failed':
    case 'truncation':
    case 'compaction_start':
    case 'compaction_complete':
      // These are handled but don't need state updates in Phase 0.
      // Phase 1 will add dedicated UI for each.
      break;
    default:
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[wingman] Unhandled SSE event: ${event}`, data);
      }
      break;
  }
}
