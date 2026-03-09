import { useState, useCallback, useEffect } from 'react';
import type { ChatMessage } from '@wingmanjs/core';

const DEFAULT_STORAGE_KEY = 'wingman-chat-history';
const DEFAULT_MAX_SESSIONS = 20;

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

function loadFromStorage(storageKey: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(sessions: ChatSession[], storageKey: string, maxSessions: number) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(sessions.slice(0, maxSessions)));
  } catch {
    /* quota exceeded */
  }
}

function generateId(): string {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 50 ? clean.slice(0, 47) + '...' : clean;
}

export function formatRelativeDate(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface UseChatHistoryReturn {
  sessions: ChatSession[];
  activeSessionId: string | null;
  createSession: () => ChatSession;
  saveSession: (session: ChatSession) => void;
  deleteSession: (id: string) => void;
  clearAllSessions: () => void;
  selectSession: (id: string) => ChatSession | undefined;
  updateSessionMessages: (id: string, messages: ChatMessage[]) => void;
}

export function useChatHistory(
  storageKey = DEFAULT_STORAGE_KEY,
  maxSessions = DEFAULT_MAX_SESSIONS,
): UseChatHistoryReturn {
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadFromStorage(storageKey));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Sync with localStorage on mount
  useEffect(() => {
    setSessions(loadFromStorage(storageKey));
  }, [storageKey]);

  const createSession = useCallback((): ChatSession => {
    const session: ChatSession = {
      id: generateId(),
      title: 'New chat',
      messages: [],
      createdAt: new Date().toISOString(),
    };
    setActiveSessionId(session.id);
    setSessions((prev) => {
      const next = [session, ...prev].slice(0, maxSessions);
      saveToStorage(next, storageKey, maxSessions);
      return next;
    });
    return session;
  }, [storageKey, maxSessions]);

  const saveSession = useCallback((session: ChatSession) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === session.id);
      let next: ChatSession[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = session;
      } else {
        next = [session, ...prev].slice(0, maxSessions);
      }
      saveToStorage(next, storageKey, maxSessions);
      return next;
    });
  }, [storageKey, maxSessions]);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveToStorage(next, storageKey, maxSessions);
      return next;
    });
    setActiveSessionId((prev) => (prev === id ? null : prev));
  }, [storageKey, maxSessions]);

  const clearAllSessions = useCallback(() => {
    setSessions([]);
    saveToStorage([], storageKey, maxSessions);
    setActiveSessionId(null);
  }, [storageKey, maxSessions]);

  const selectSession = useCallback(
    (id: string): ChatSession | undefined => {
      setActiveSessionId(id);
      const found = sessions.find((s) => s.id === id);
      return found;
    },
    [sessions],
  );

  const updateSessionMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return prev;

        const session = { ...prev[idx] };
        session.messages = messages;

        // Derive title from first user message
        if (session.title === 'New chat') {
          const firstUser = messages.find((m) => m.role === 'user');
          if (firstUser) {
            session.title = deriveTitle(firstUser.content);
          }
        }

        const next = [...prev];
        next[idx] = session;
        saveToStorage(next, storageKey, maxSessions);
        return next;
      });
    },
    [storageKey, maxSessions],
  );

  return {
    sessions,
    activeSessionId,
    createSession,
    saveSession,
    deleteSession,
    clearAllSessions,
    selectSession,
    updateSessionMessages,
  };
}
