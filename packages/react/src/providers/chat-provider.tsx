/**
 * ChatProvider — React context for Wingman chat state.
 *
 * Wraps the entire chat UI and provides shared state for messages,
 * tools, sessions, connection status, and streaming.
 */

import React, { createContext, useContext, useReducer, useCallback, useRef, type ReactNode } from 'react';
import type { ChatMessage, ToolExecution, UsageData } from '@wingmanjs/core';
import type { DebugEvent } from '../components/debug-panel.js';
import { ThemeProvider, type WingmanTheme, type WingmanThemeColors } from './theme-provider.js';
import { useAutoScroll } from '../hooks/use-auto-scroll.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a short human-readable summary from a tool result string. */
function extractToolSummary(result: string): string {
  if (!result) return '';
  const text = result.slice(0, 200);

  const countMatch = text.match(
    /(\d+)\s+(opportunit|deal|account|result|record|item|team member)/i,
  );
  if (countMatch) return `Found ${countMatch[1]} ${countMatch[2]}s`;

  const nameMatch = text.match(/(?:Account|Name|Company):\s*([^\n,]+)/i);
  if (nameMatch) return nameMatch[1].trim().slice(0, 40);

  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 0 && firstLine.length < 60) return firstLine;

  return '';
}

/** Fetch with exponential-backoff retry (aborts bypass retry). */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response;
    } catch (err) {
      lastError = err as Error;
      if ((err as Error).name === 'AbortError') throw err;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}

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
  debugEvents: DebugEvent[];
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
  debugEvents: [],
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ChatAction =
  | { type: 'ADD_USER_MESSAGE'; content: string }
  | { type: 'START_STREAMING' }
  | { type: 'STOP_STREAMING' }
  | { type: 'APPEND_DELTA'; content: string }
  | { type: 'APPEND_REASONING'; content: string; reasoningId?: string }
  | { type: 'SET_REASONING_VISIBLE'; visible: boolean }
  | { type: 'REASONING'; content: string; reasoningId?: string }
  | { type: 'TOOL_START'; tool: Pick<ToolExecution, 'toolCallId' | 'toolName' | 'arguments'> & { displayName?: string; mcpServerName?: string; mcpToolName?: string } }
  | { type: 'TOOL_COMPLETE'; toolCallId: string; toolName: string; result: string; isError?: boolean }
  | { type: 'TOOL_PROGRESS'; toolCallId: string; message: string }
  | { type: 'SKILL_INVOKED'; name: string; pluginName?: string; path?: string }
  | { type: 'SUBAGENT_STARTED'; toolCallId: string; name: string; displayName: string; description: string }
  | { type: 'SUBAGENT_COMPLETED'; toolCallId: string }
  | { type: 'SUBAGENT_FAILED'; toolCallId: string; error?: string }
  | { type: 'INTENT'; intent: string }
  | { type: 'INFO'; infoType: string; message: string }
  | { type: 'WARNING'; infoType: string; message: string }
  | { type: 'SET_USAGE'; usage: UsageData }
  | { type: 'FINISH_STREAMING'; sessionId: string }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_MODE'; mode: string }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'LOAD_MESSAGES'; messages: ChatMessage[] }
  | { type: 'ADD_DEBUG_EVENTS'; events: DebugEvent[] };

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
            segments: [],
          },
        ],
      };

    case 'APPEND_DELTA': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        const lastSeg = segments[segments.length - 1];
        if (lastSeg?.type === 'content') {
          segments[segments.length - 1] = { ...lastSeg, content: lastSeg.content + action.content };
        } else {
          segments.push({ type: 'content', id: generateId(), content: action.content });
        }
        msgs[msgs.length - 1] = { ...last, content: last.content + action.content, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'APPEND_REASONING': {
      const rid = action.reasoningId ?? 'default';
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        const lastSeg = segments[segments.length - 1];
        if (lastSeg?.type === 'thinking' && lastSeg.reasoningId === rid) {
          segments[segments.length - 1] = { ...lastSeg, content: lastSeg.content + action.content };
        } else {
          segments.push({ type: 'thinking', id: generateId(), content: action.content, reasoningId: rid });
        }
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return {
        ...state,
        currentReasoning: state.currentReasoning + action.content,
        isReasoningVisible: true,
        messages: msgs,
      };
    }

    case 'SET_REASONING_VISIBLE':
      return { ...state, isReasoningVisible: action.visible };

    case 'REASONING': {
      const rid = action.reasoningId ?? `complete-${generateId()}`;
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        segments.push({ type: 'thinking', id: generateId(), content: action.content, reasoningId: rid });
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return {
        ...state,
        currentReasoning: state.currentReasoning + action.content,
        isReasoningVisible: true,
        messages: msgs,
      };
    }

    case 'TOOL_START': {
      const tools = new Map(state.activeTools);
      const toolExec: ToolExecution = {
        toolCallId: action.tool.toolCallId,
        toolName: action.tool.toolName,
        displayName: action.tool.displayName,
        arguments: action.tool.arguments,
        mcpServerName: action.tool.mcpServerName,
        mcpToolName: action.tool.mcpToolName,
        status: 'running',
        startedAt: Date.now(),
      };
      tools.set(toolExec.toolCallId, toolExec);
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segId = generateId();
        const segments = [...(last.segments ?? [])];
        segments.push({ type: 'tool', id: segId, tool: toolExec });
        msgs[msgs.length - 1] = {
          ...last,
          tools: [...(last.tools ?? []), toolExec],
          segments,
        };
      }
      return { ...state, activeTools: tools, messages: msgs };
    }

    case 'TOOL_COMPLETE': {
      const tools = new Map(state.activeTools);
      const existing = tools.get(action.toolCallId);
      const summary = extractToolSummary(action.result);
      const isError = action.isError === true;
      const completedStatus: ToolExecution['status'] = isError ? 'error' : 'complete';
      const toolUpdate = { status: completedStatus, result: action.result, summary: summary || undefined, isError, completedAt: Date.now() };
      if (existing) {
        tools.set(action.toolCallId, { ...existing, ...toolUpdate });
      }
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && last.tools) {
        const updatedTools = last.tools.map((t) =>
          t.toolCallId === action.toolCallId
            ? { ...t, ...toolUpdate }
            : t,
        );
        const segments = (last.segments ?? []).map((s) =>
          s.type === 'tool' && s.tool.toolCallId === action.toolCallId
            ? { ...s, tool: { ...s.tool, ...toolUpdate } }
            : s,
        );
        msgs[msgs.length - 1] = { ...last, tools: updatedTools, segments };
      }
      return { ...state, activeTools: tools, messages: msgs };
    }

    case 'TOOL_PROGRESS': {
      const tools = new Map(state.activeTools);
      const existing = tools.get(action.toolCallId);
      if (existing) {
        tools.set(action.toolCallId, { ...existing, progress: action.message });
      }
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const updatedTools = (last.tools ?? []).map((t) =>
          t.toolCallId === action.toolCallId ? { ...t, progress: action.message } : t,
        );
        const segments = (last.segments ?? []).map((s) =>
          s.type === 'tool' && s.tool.toolCallId === action.toolCallId
            ? { ...s, tool: { ...s.tool, progress: action.message } }
            : s,
        );
        msgs[msgs.length - 1] = { ...last, tools: updatedTools, segments };
      }
      return { ...state, activeTools: tools, messages: msgs };
    }

    case 'SKILL_INVOKED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        segments.push({
          type: 'skill',
          id: generateId(),
          name: action.name,
          pluginName: action.pluginName,
          path: action.path,
        });
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'SUBAGENT_STARTED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        segments.push({
          type: 'subagent',
          id: generateId(),
          toolCallId: action.toolCallId,
          name: action.name,
          displayName: action.displayName,
          description: action.description,
          status: 'running',
        });
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'SUBAGENT_COMPLETED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = (last.segments ?? []).map((s) =>
          s.type === 'subagent' && s.toolCallId === action.toolCallId
            ? { ...s, status: 'complete' as const }
            : s,
        );
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'SUBAGENT_FAILED': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = (last.segments ?? []).map((s) =>
          s.type === 'subagent' && s.toolCallId === action.toolCallId
            ? { ...s, status: 'failed' as const, error: action.error }
            : s,
        );
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'INTENT': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        const lastSeg = segments[segments.length - 1];
        if (lastSeg?.type === 'intent') {
          segments[segments.length - 1] = { ...lastSeg, intent: action.intent };
        } else {
          segments.push({ type: 'intent', id: generateId(), intent: action.intent });
        }
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
    }

    case 'INFO':
    case 'WARNING': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const segments = [...(last.segments ?? [])];
        segments.push({
          type: 'info',
          id: generateId(),
          infoType: action.infoType,
          message: action.message,
        });
        msgs[msgs.length - 1] = { ...last, segments };
      }
      return { ...state, messages: msgs };
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
      for (const [id, tool] of tools) {
        if (tool.status === 'running') {
          tools.set(id, { ...tool, status: 'complete', completedAt: Date.now() });
        }
      }
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        const updatedTools = (last.tools ?? []).map((t) =>
          t.status === 'running' ? { ...t, status: 'complete' as const, completedAt: Date.now() } : t,
        );
        const segments = (last.segments ?? []).map((s) => {
          if (s.type === 'tool' && s.tool.status === 'running') {
            return { ...s, tool: { ...s.tool, status: 'complete' as const, completedAt: Date.now() } };
          }
          if (s.type === 'subagent' && s.status === 'running') {
            return { ...s, status: 'complete' as const };
          }
          return s;
        });
        msgs[msgs.length - 1] = {
          ...last,
          reasoning: state.currentReasoning || last.reasoning,
          tools: updatedTools,
          segments,
        };
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

    case 'ADD_DEBUG_EVENTS':
      return { ...state, debugEvents: action.events };

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
  /** Replace the current message list (e.g. when restoring history). */
  loadMessages: (messages: ChatMessage[]) => void;
  /** Debug events captured during SSE streaming. */
  debugEvents: DebugEvent[];
  /** Enable/disable debug event buffering. */
  setDebugEnabled: (enabled: boolean) => void;
  /** Ref to attach to a scroll container for auto-scrolling during streaming. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
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
  /** Map of toolName → human-readable display name (e.g. "get_my_deals" → "Searching Deals"). */
  toolDisplayNames?: Record<string, string>;
}

export function ChatProvider({ children, apiUrl = '', theme, colors, className, toolDisplayNames }: ChatProviderProps) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const debugEnabledRef = useRef(false);
  const debugBufferRef = useRef<DebugEvent[]>([]);
  const toolDisplayNamesRef = useRef<Record<string, string>>(toolDisplayNames ?? {});
  toolDisplayNamesRef.current = toolDisplayNames ?? {};

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || state.isStreaming) return;

      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      dispatch({ type: 'CLEAR_ERROR' });
      dispatch({ type: 'ADD_USER_MESSAGE', content: message });
      dispatch({ type: 'START_STREAMING' });
      debugBufferRef.current = [];

      try {
        const response = await fetchWithRetry(
          `${apiUrl}/api/chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message,
              ...(state.sessionId ? { sessionId: state.sessionId } : {}),
            }),
            signal: controller.signal,
          },
        );

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
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));

                // Buffer debug events during streaming
                if (debugEnabledRef.current) {
                  debugBufferRef.current.push({ timestamp: Date.now(), event: currentEvent, data });
                  if (debugBufferRef.current.length > 200) {
                    debugBufferRef.current = debugBufferRef.current.slice(-200);
                  }
                }

                handleSSEEvent(currentEvent, data, dispatch, toolDisplayNamesRef.current);
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
        // Only stop streaming if this request is still the active one.
        // A newer sendMessage() call aborts the old controller and replaces
        // abortRef.current — so if they differ, a newer request owns the UI.
        if (abortRef.current === controller) {
          dispatch({ type: 'STOP_STREAMING' });

          // Flush debug buffer to state after streaming completes
          if (debugBufferRef.current.length > 0) {
            dispatch({ type: 'ADD_DEBUG_EVENTS', events: [...debugBufferRef.current] });
          }
        }
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

  const loadMessages = useCallback((messages: ChatMessage[]) => {
    dispatch({ type: 'LOAD_MESSAGES', messages });
  }, []);

  const setDebugEnabled = useCallback((enabled: boolean) => {
    debugEnabledRef.current = enabled;
    if (!enabled) {
      debugBufferRef.current = [];
      dispatch({ type: 'ADD_DEBUG_EVENTS', events: [] });
    }
  }, []);

  // Auto-scroll: track message count, content length, tool count, and streaming state
  const lastMsg = state.messages[state.messages.length - 1];
  const scrollRef = useAutoScroll<HTMLDivElement>([
    state.messages.length,
    lastMsg?.content?.length ?? 0,
    lastMsg?.segments?.length ?? 0,
    lastMsg?.tools?.length ?? 0,
    state.isStreaming,
  ]);

  return (
    <ThemeProvider theme={theme} colors={colors} className={className}>
      <ChatContext.Provider
        value={{
          state,
          dispatch,
          sendMessage,
          newChat,
          switchModel,
          setMode,
          loadMessages,
          debugEvents: state.debugEvents,
          setDebugEnabled,
          scrollRef,
        }}
      >
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
  toolDisplayNames: Record<string, string>,
) {
  switch (event) {
    case 'delta':
      if (data.content) {
        dispatch({ type: 'APPEND_DELTA', content: data.content as string });
      }
      break;
    case 'reasoning_delta':
      dispatch({
        type: 'APPEND_REASONING',
        content: data.content as string,
        reasoningId: data.reasoningId as string | undefined,
      });
      break;
    case 'reasoning':
      if (data.content) {
        dispatch({
          type: 'REASONING',
          content: data.content as string,
          reasoningId: data.reasoningId as string | undefined,
        });
      }
      break;
    case 'tool_start': {
      const toolName = (data.name ?? data.toolName) as string;
      dispatch({
        type: 'TOOL_START',
        tool: {
          toolCallId: data.toolCallId as string,
          toolName,
          arguments: data.arguments as Record<string, unknown>,
          displayName: toolDisplayNames[toolName] ?? formatToolName(toolName),
          mcpServerName: data.mcpServerName as string | undefined,
          mcpToolName: data.mcpToolName as string | undefined,
        },
      });
      break;
    }
    case 'tool_complete':
      dispatch({
        type: 'TOOL_COMPLETE',
        toolCallId: data.toolCallId as string,
        toolName: (data.name ?? data.toolName) as string,
        result: data.result as string,
        isError: data.isError as boolean | undefined,
      });
      break;
    case 'tool_progress':
      if (data.toolCallId && data.message) {
        dispatch({
          type: 'TOOL_PROGRESS',
          toolCallId: data.toolCallId as string,
          message: data.message as string,
        });
      }
      break;
    case 'skill_invoked':
      if (data.name) {
        dispatch({
          type: 'SKILL_INVOKED',
          name: data.name as string,
          pluginName: data.pluginName as string | undefined,
          path: data.path as string | undefined,
        });
      }
      break;
    case 'subagent_started':
      if (data.toolCallId) {
        dispatch({
          type: 'SUBAGENT_STARTED',
          toolCallId: data.toolCallId as string,
          name: (data.name ?? '') as string,
          displayName: (data.displayName ?? '') as string,
          description: (data.description ?? '') as string,
        });
      }
      break;
    case 'subagent_completed':
      if (data.toolCallId) {
        dispatch({ type: 'SUBAGENT_COMPLETED', toolCallId: data.toolCallId as string });
      }
      break;
    case 'subagent_failed':
      if (data.toolCallId) {
        dispatch({
          type: 'SUBAGENT_FAILED',
          toolCallId: data.toolCallId as string,
          error: data.error as string | undefined,
        });
      }
      break;
    case 'intent':
      if (data.intent) {
        dispatch({ type: 'INTENT', intent: data.intent as string });
      }
      break;
    case 'info':
      if (data.message) {
        dispatch({
          type: 'INFO',
          infoType: (data.infoType ?? 'info') as string,
          message: data.message as string,
        });
      }
      break;
    case 'warning':
      if (data.message) {
        dispatch({
          type: 'WARNING',
          infoType: (data.warningType ?? 'warning') as string,
          message: data.message as string,
        });
      }
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
    case 'truncation':
    case 'compaction_start':
    case 'compaction_complete':
      // Informational events — no UI state updates needed.
      break;
    default:
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[wingman] Unhandled SSE event: ${event}`, data);
      }
      break;
  }
}
