/**
 * Built-in chat UI served when no staticDir is provided.
 *
 * A self-contained HTML page with embedded CSS and JS that talks to
 * the /api/chat SSE endpoint.  Keeps the new-user experience working
 * out of the box — no React build pipeline required.
 */

export function getDefaultHtml(ui: {
  title?: string;
  welcomeMessage?: string;
  theme?: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const title = esc(ui.title ?? 'Wingman');
  const welcome = esc(ui.welcomeMessage ?? 'How can I help?');
  const validThemes = ['dark', 'light', 'system'] as const;
  const theme = validThemes.includes(ui.theme as typeof validThemes[number])
    ? ui.theme! : 'dark';

  return /* html */ `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #ffffff; --bg-secondary: #f9fafb; --text: #111827;
      --text-secondary: #6b7280; --border: #e5e7eb; --primary: #2563eb;
      --primary-hover: #1d4ed8; --user-bg: #eff6ff; --assistant-bg: #f9fafb;
      --radius: 12px; --shadow: 0 1px 3px rgba(0,0,0,.1);
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --mono: 'SF Mono', SFMono-Regular, Consolas, monospace;
    }

    @media (prefers-color-scheme: dark) {
      [data-theme="system"] {
        --bg: #0f172a; --bg-secondary: #1e293b; --text: #f1f5f9;
        --text-secondary: #94a3b8; --border: #334155; --primary: #3b82f6;
        --primary-hover: #60a5fa; --user-bg: #1e3a5f; --assistant-bg: #1e293b;
      }
    }
    [data-theme="dark"] {
      --bg: #0f172a; --bg-secondary: #1e293b; --text: #f1f5f9;
      --text-secondary: #94a3b8; --border: #334155; --primary: #3b82f6;
      --primary-hover: #60a5fa; --user-bg: #1e3a5f; --assistant-bg: #1e293b;
    }

    html, body { height: 100%; }
    body {
      font-family: var(--font); background: var(--bg); color: var(--text);
      display: flex; flex-direction: row;
    }

    /* Persistent history sidebar */
    #history-sidebar {
      width: 260px; min-width: 260px; height: 100%;
      background: var(--bg); border-right: 1px solid var(--border);
      display: flex; flex-direction: column; flex-shrink: 0;
    }

    #main-content {
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; height: 100%;
    }

    header {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 10px;
      background: var(--bg); flex-shrink: 0;
    }
    header .logo { font-size: 24px; }
    header h1 { font-size: 18px; font-weight: 600; }
    header { justify-content: flex-start; }
    .header-spacer { flex: 1; }

    @media (max-width: 640px) {
      body { flex-direction: column; }
      #history-sidebar {
        width: 100%; min-width: unset; height: auto; max-height: 40vh;
        border-right: none; border-bottom: 1px solid var(--border);
      }
    }

    /* Auth settings button */
    #auth-btn {
      position: relative; background: none; border: 1px solid var(--border);
      border-radius: 8px; padding: 6px 10px; cursor: pointer;
      font-size: 16px; color: var(--text); display: flex; align-items: center; gap: 4px;
    }
    #auth-btn:hover { background: var(--bg-secondary); }
    .auth-badge {
      position: absolute; top: -4px; right: -4px;
      background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
      min-width: 16px; height: 16px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      padding: 0 4px; line-height: 1;
    }
    .auth-badge.hidden { display: none; }

    /* Auth panel (slide-out) */
    #auth-panel {
      position: fixed; top: 0; right: -380px; width: 360px; height: 100%;
      background: var(--bg); border-left: 1px solid var(--border);
      box-shadow: -4px 0 20px rgba(0,0,0,.15); z-index: 100;
      transition: right .25s ease; display: flex; flex-direction: column;
    }
    #auth-panel.open { right: 0; }
    .panel-header {
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .panel-header h2 { font-size: 16px; font-weight: 600; }
    .panel-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: var(--text-secondary); padding: 4px 8px; border-radius: 4px;
    }
    .panel-close:hover { background: var(--bg-secondary); }
    .panel-body { flex: 1; overflow-y: auto; padding: 12px 20px; }
    .panel-empty {
      text-align: center; color: var(--text-secondary); padding: 40px 20px;
      font-size: 14px;
    }

    /* Server cards */
    .server-card {
      border: 1px solid var(--border); border-radius: 8px;
      padding: 12px 14px; margin-bottom: 10px;
    }
    .server-card-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .status-dot.authenticated { background: #22c55e; }
    .status-dot.needs_auth { background: #f59e0b; }
    .status-dot.no_auth_required { background: #94a3b8; }
    .status-dot.error { background: #ef4444; }
    .server-name {
      font-size: 14px; font-weight: 500; flex: 1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .server-status {
      font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;
    }
    .server-url {
      font-size: 11px; color: var(--text-secondary); font-family: var(--mono);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-bottom: 8px;
    }
    .server-action {
      display: inline-block; padding: 4px 12px; border-radius: 6px;
      font-size: 12px; font-weight: 500; cursor: pointer; border: none;
    }
    .server-action.sign-in {
      background: var(--primary); color: #fff;
    }
    .server-action.sign-in:hover { background: var(--primary-hover); }
    .server-action.sign-out {
      background: none; border: 1px solid var(--border); color: var(--text);
    }
    .server-action.sign-out:hover { background: var(--bg-secondary); }
    .server-action:disabled { opacity: .5; cursor: not-allowed; }

    /* Auth provider groups */
    .auth-group { margin-bottom: 16px; }
    .auth-group-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 0; margin-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .auth-group-label {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      color: var(--text-secondary); letter-spacing: 0.05em;
    }
    .sign-in-all {
      font-size: 11px; padding: 2px 10px;
    }

    /* Overlay behind panel */
    #auth-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.3);
      z-index: 99; display: none;
    }
    #auth-overlay.open { display: block; }

    /* History sidebar internals */
    .sidebar-header {
      padding: 16px 16px 12px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .sidebar-header h2 { font-size: 15px; font-weight: 600; }
    #new-chat-btn {
      margin: 10px 16px 6px; padding: 8px 12px; border-radius: 8px;
      border: 1px dashed var(--border); background: none; color: var(--primary);
      font-size: 13px; font-weight: 500; cursor: pointer; text-align: left;
    }
    #new-chat-btn:hover { background: var(--bg-secondary); border-style: solid; }
    #session-list {
      flex: 1; overflow-y: auto; padding: 6px 0;
    }
    .session-item {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 16px; cursor: pointer; font-size: 13px;
      border-left: 3px solid transparent;
    }
    .session-item:hover { background: var(--bg-secondary); }
    .session-item.active { background: var(--bg-secondary); border-left-color: var(--primary); }
    .session-item-content { flex: 1; min-width: 0; }
    .session-title {
      font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .session-date {
      font-size: 11px; color: var(--text-secondary); margin-top: 2px;
    }
    .session-delete {
      background: none; border: none; font-size: 14px; cursor: pointer;
      color: var(--text-secondary); padding: 2px 4px; border-radius: 4px;
      opacity: 0; pointer-events: none; transition: opacity .15s;
    }
    .session-item:hover .session-delete,
    .session-delete:focus-visible { opacity: 1; pointer-events: auto; }
    .session-delete:hover { color: #ef4444; background: var(--bg-secondary); }
    .sidebar-empty {
      text-align: center; color: var(--text-secondary); padding: 24px 16px;
      font-size: 13px;
    }

    #messages {
      flex: 1; overflow-y: auto; padding: 24px;
      display: flex; flex-direction: column; gap: 16px;
    }

    .welcome {
      text-align: center; margin: auto; max-width: 480px;
      color: var(--text-secondary);
    }
    .welcome h2 { font-size: 22px; color: var(--text); margin-bottom: 8px; }
    .welcome p { font-size: 15px; line-height: 1.5; }

    .msg {
      max-width: 720px; width: 100%; padding: 14px 18px;
      border-radius: var(--radius); line-height: 1.6; font-size: 15px;
      white-space: pre-wrap; word-wrap: break-word;
    }
    .msg.user {
      background: var(--user-bg); align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .msg.assistant {
      background: var(--assistant-bg); align-self: flex-start;
      border-bottom-left-radius: 4px; box-shadow: var(--shadow);
    }
    .msg.error {
      background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
      align-self: center; text-align: center;
    }
    [data-theme="dark"] .msg.error {
      background: #450a0a; color: #fca5a5; border-color: #7f1d1d;
    }
    @media (prefers-color-scheme: dark) {
      [data-theme="system"] .msg.error {
        background: #450a0a; color: #fca5a5; border-color: #7f1d1d;
      }
    }

    .msg code {
      font-family: var(--mono); font-size: 13px;
      background: var(--border); padding: 2px 5px; border-radius: 4px;
    }
    .msg pre {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px; margin: 8px 0;
      overflow-x: auto; font-family: var(--mono); font-size: 13px;
    }
    .msg pre code { background: none; padding: 0; }

    .typing::after {
      content: ''; display: inline-block; width: 6px; height: 16px;
      background: var(--primary); border-radius: 2px; margin-left: 2px;
      animation: blink .6s infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }

    form {
      padding: 16px 24px; border-top: 1px solid var(--border);
      background: var(--bg); flex-shrink: 0; display: flex; gap: 10px;
    }
    #input {
      flex: 1; padding: 12px 16px; border: 1px solid var(--border);
      border-radius: var(--radius); background: var(--bg-secondary);
      color: var(--text); font-size: 15px; font-family: var(--font);
      outline: none; resize: none; min-height: 48px; max-height: 200px;
    }
    #input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
    #input::placeholder { color: var(--text-secondary); }

    button[type="submit"] {
      padding: 12px 20px; background: var(--primary); color: #fff;
      border: none; border-radius: var(--radius); font-size: 15px;
      font-weight: 500; cursor: pointer; white-space: nowrap;
    }
    button[type="submit"]:hover { background: var(--primary-hover); }
    button[type="submit"]:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div id="history-sidebar">
    <div class="sidebar-header">
      <h2>Chat History</h2>
    </div>
    <button id="new-chat-btn" type="button">+ New chat</button>
    <div id="session-list">
      <div class="sidebar-empty">No conversations yet.</div>
    </div>
  </div>

  <div id="main-content">
  <header>
    <span class="logo">🦜</span>
    <h1>${title}</h1>
    <div class="header-spacer"></div>
    <button id="auth-btn" aria-label="Connections" aria-expanded="false" aria-controls="auth-panel">
      🔌<span class="auth-badge hidden" id="auth-badge">0</span>
    </button>
  </header>

  <div id="auth-overlay"></div>
  <div id="auth-panel">
    <div class="panel-header">
      <h2>Connections</h2>
      <button class="panel-close" id="panel-close" type="button" aria-label="Close connections panel">&times;</button>
    </div>
    <div class="panel-body" id="panel-body">
      <div class="panel-empty">Loading&hellip;</div>
    </div>
  </div>

  <div id="messages">
    <div class="welcome">
      <h2>${welcome}</h2>
      <p>Type a message below to get started.</p>
    </div>
  </div>

  <form id="chat-form">
    <textarea id="input" placeholder="Type a message..." rows="1"
      autocomplete="off"></textarea>
    <button type="submit">Send</button>
  </form>

  <script>
    const messages = document.getElementById('messages');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('input');
    let sessionId = null;
    let busy = false;

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });

    // Enter to send, Shift+Enter for newline
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });

    function addMessage(role, text) {
      // Remove welcome screen on first message
      const welcome = messages.querySelector('.welcome');
      if (welcome) welcome.remove();

      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    function renderMarkdownLite(text) {
      // Minimal markdown: code blocks, inline code, bold, italic
      let html = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      return html;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || busy) return;

      busy = true;
      form.querySelector('button').disabled = true;
      input.value = '';
      input.style.height = 'auto';

      addMessage('user', text);
      chatMessages.push({ role: 'user', text: text });

      const assistantDiv = addMessage('assistant', '');
      assistantDiv.classList.add('typing');
      let fullText = '';

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionId ? { message: text, sessionId } : { message: text }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || res.statusText);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));

                if (currentEvent === 'delta' && parsed.content) {
                  fullText += parsed.content;
                  assistantDiv.innerHTML = renderMarkdownLite(fullText);
                  messages.scrollTop = messages.scrollHeight;
                } else if (currentEvent === 'done' && parsed.sessionId) {
                  sessionId = parsed.sessionId;
                } else if (currentEvent === 'error') {
                  assistantDiv.classList.remove('typing');
                  assistantDiv.textContent = 'Error: ' + (parsed.message || 'Unknown error');
                  assistantDiv.style.color = '#e53e3e';
                }
              } catch (_) {
                // Ignore JSON parse errors on partial SSE chunks
              }
            } else if (line.trim() === '') {
              currentEvent = '';
            }
          }
        }
      } catch (err) {
        if (!fullText) {
          assistantDiv.remove();
        }
        addMessage('error', 'Error: ' + err.message);
      } finally {
        assistantDiv.classList.remove('typing');
        if (fullText) {
          chatMessages.push({ role: 'assistant', text: fullText });
        }
        try { saveCurrentSession(); } catch (_) { /* storage errors must not block UI reset */ }
        busy = false;
        form.querySelector('button').disabled = false;
        input.focus();
      }
    });

    input.focus();

    // ── Session history logic ─────────────────────────────────────
    const STORAGE_KEY = 'wingman-chat-history';
    const MAX_SESSIONS = 50;
    const newChatBtn = document.getElementById('new-chat-btn');
    const sessionListEl = document.getElementById('session-list');

    function loadSessions() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) { return []; }
    }

    function saveSessions(list) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
      } catch (_) { /* quota exceeded or storage disabled — silently ignore */ }
    }

    let activeSessionKey = null;
    let chatMessages = [];

    function deriveTitle(text) {
      const t = text.replace(/\\n/g, ' ').trim();
      return t.length > 50 ? t.slice(0, 47) + '...' : t;
    }

    function formatDate(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + 'm ago';
      const diffHrs = Math.round(diffMins / 60);
      if (diffHrs < 24) return diffHrs + 'h ago';
      const diffDays = Math.round(diffHrs / 24);
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return diffDays + 'd ago';
      return d.toLocaleDateString();
    }

    function saveCurrentSession() {
      if (!activeSessionKey || chatMessages.length === 0) return;
      const sessions = loadSessions();
      const idx = sessions.findIndex(s => s.key === activeSessionKey);
      const title = deriveTitle(
        (chatMessages.find(m => m.role === 'user') || {}).text || 'New chat'
      );
      const entry = {
        key: activeSessionKey,
        serverSessionId: sessionId,
        title: title,
        messages: chatMessages,
        updatedAt: Date.now(),
        createdAt: idx >= 0 ? sessions[idx].createdAt : Date.now(),
      };
      if (idx >= 0) sessions.splice(idx, 1);
      sessions.unshift(entry);
      saveSessions(sessions);
      renderSessionList();
    }

    function startNewChat() {
      activeSessionKey = 'wm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      sessionId = null;
      chatMessages = [];
      messages.innerHTML = '<div class="welcome"><h2>${welcome}</h2><p>Type a message below to get started.</p></div>';
      input.focus();
      renderSessionList();
    }

    function loadSession(key) {
      const sessions = loadSessions();
      const s = sessions.find(s => s.key === key);
      if (!s) return;

      activeSessionKey = s.key;
      sessionId = s.serverSessionId || null;
      chatMessages = s.messages || [];

      messages.innerHTML = '';
      for (const m of chatMessages) {
        const div = document.createElement('div');
        div.className = 'msg ' + m.role;
        if (m.role === 'assistant') {
          div.innerHTML = renderMarkdownLite(m.text);
        } else {
          div.textContent = m.text;
        }
        messages.appendChild(div);
      }
      messages.scrollTop = messages.scrollHeight;
      input.focus();
      renderSessionList();
    }

    function deleteSession(key) {
      const sessions = loadSessions().filter(s => s.key !== key);
      saveSessions(sessions);
      if (activeSessionKey === key) startNewChat();
      renderSessionList();
    }

    function renderSessionList() {
      const sessions = loadSessions();
      if (sessions.length === 0) {
        sessionListEl.innerHTML = '<div class="sidebar-empty">No conversations yet.</div>';
        return;
      }
      sessionListEl.innerHTML = '';
      sessions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'session-item' + (s.key === activeSessionKey ? ' active' : '');
        item.dataset.key = s.key;

        const content = document.createElement('div');
        content.className = 'session-item-content';
        const titleEl = document.createElement('div');
        titleEl.className = 'session-title';
        titleEl.textContent = s.title || 'New chat';
        const dateEl = document.createElement('div');
        dateEl.className = 'session-date';
        dateEl.textContent = formatDate(s.updatedAt || s.createdAt);
        content.appendChild(titleEl);
        content.appendChild(dateEl);

        const del = document.createElement('button');
        del.className = 'session-delete';
        del.setAttribute('aria-label', 'Delete session');
        del.title = 'Delete';
        del.textContent = '\\u00d7';
        del.type = 'button';

        item.appendChild(content);
        item.appendChild(del);
        sessionListEl.appendChild(item);

        item.addEventListener('click', (e) => {
          if (e.target.closest('.session-delete')) return;
          loadSession(s.key);
        });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteSession(s.key);
        });
      });
    }

    newChatBtn.addEventListener('click', () => startNewChat());

    // Initialize
    startNewChat();

    // ── Auth panel logic ──────────────────────────────────────────
    const authBtn = document.getElementById('auth-btn');
    const authBadge = document.getElementById('auth-badge');
    const authPanel = document.getElementById('auth-panel');
    const authOverlay = document.getElementById('auth-overlay');
    const panelClose = document.getElementById('panel-close');
    const panelBody = document.getElementById('panel-body');

    function showPanelError(msg) {
      let el = panelBody.querySelector('.panel-error');
      if (!el) {
        el = document.createElement('div');
        el.className = 'panel-error';
        el.style.cssText = 'color:#ef4444;font-size:13px;padding:8px 0;';
        panelBody.prepend(el);
      }
      el.textContent = msg;
      if (el._dismissTimer) clearTimeout(el._dismissTimer);
      el._dismissTimer = setTimeout(() => el.remove(), 6000);
    }

    function togglePanel(open) {
      const isOpen = open ?? !authPanel.classList.contains('open');
      authPanel.classList.toggle('open', isOpen);
      authOverlay.classList.toggle('open', isOpen);
      authBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) fetchAuthStatus();
    }
    authBtn.addEventListener('click', () => togglePanel());
    authOverlay.addEventListener('click', () => togglePanel(false));
    panelClose.addEventListener('click', () => togglePanel(false));

    function statusLabel(s) {
      if (s === 'authenticated') return '\\u2705 Connected';
      if (s === 'needs_auth') return '\\ud83d\\udd13 Sign-in required';
      if (s === 'no_auth_required') return '\\u2014 No auth needed';
      if (s === 'error') return '\\u274c Error';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function expiryLabel(ts) {
      if (!ts) return '';
      const mins = Math.round((ts * 1000 - Date.now()) / 60000);
      if (mins < 1) return 'Expires soon';
      if (mins < 60) return 'Expires in ' + mins + 'm';
      return 'Expires in ' + Math.round(mins / 60) + 'h';
    }

    function renderServers(servers, groups) {
      if (!servers || servers.length === 0) {
        panelBody.innerHTML = '<div class="panel-empty">No MCP servers configured.</div>';
        authBadge.classList.add('hidden');
        return;
      }
      const needsAuth = servers.filter(s => s.status === 'needs_auth').length;
      if (needsAuth > 0) {
        authBadge.textContent = needsAuth;
        authBadge.classList.remove('hidden');
      } else {
        authBadge.classList.add('hidden');
      }

      function renderCard(s) {
        const name = s.serverName.replace(/&/g,'&amp;').replace(/</g,'&lt;');
        const url = s.serverUrl.replace(/&/g,'&amp;').replace(/</g,'&lt;');
        const attrUrl = s.serverUrl.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        const validStatuses = ['authenticated','needs_auth','no_auth_required','error'];
        const statusClass = validStatuses.includes(s.status) ? s.status : 'error';
        const expiry = s.status === 'authenticated' ? expiryLabel(s.expiresAt) : '';
        let action = '';
        if (s.status === 'needs_auth') {
          action = '<button class="server-action sign-in" data-url="' + attrUrl + '">Sign in</button>';
        } else if (s.status === 'authenticated') {
          action = '<button class="server-action sign-out" data-url="' + attrUrl + '">Sign out</button>';
        }
        const errorLine = s.error ? '<div class="server-status" style="color:#ef4444">' + s.error.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>' : '';
        return '<div class="server-card">'
          + '<div class="server-card-header">'
          + '  <span class="status-dot ' + statusClass + '"></span>'
          + '  <span class="server-name">' + name + '</span>'
          + '</div>'
          + '<div class="server-status">' + statusLabel(s.status) + (expiry ? ' \\u00b7 ' + expiry : '') + '</div>'
          + errorLine
          + '<div class="server-url">' + url + '</div>'
          + action
          + '</div>';
      }

      // Render grouped if groups are provided, flat otherwise
      if (groups && Object.keys(groups).length > 1) {
        const html = [];
        for (const [provider, list] of Object.entries(groups)) {
          const label = provider === '__no_provider__' ? 'Other' : provider.replace(/&/g,'&amp;').replace(/</g,'&lt;');
          const groupNeeds = list.filter(s => s.status === 'needs_auth');
          html.push('<div class="auth-group">');
          html.push('<div class="auth-group-header">');
          html.push('<span class="auth-group-label">' + label + ' (' + list.length + ')</span>');
          if (groupNeeds.length > 1) {
            const urls = groupNeeds.map(s => s.serverUrl.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'));
            html.push('<button class="server-action sign-in sign-in-all" data-urls=\\'' + JSON.stringify(urls) + '\\'>Sign in to all</button>');
          }
          html.push('</div>');
          html.push(list.map(renderCard).join(''));
          html.push('</div>');
        }
        panelBody.innerHTML = html.join('');
      } else {
        panelBody.innerHTML = servers.map(renderCard).join('');
      }

      panelBody.querySelectorAll('.sign-in:not(.sign-in-all)').forEach(btn => {
        btn.addEventListener('click', () => handleSignIn(btn.dataset.url, btn));
      });
      panelBody.querySelectorAll('.sign-in-all').forEach(btn => {
        btn.addEventListener('click', async () => {
          const urls = JSON.parse(btn.dataset.urls || '[]');
          btn.disabled = true;
          btn.textContent = 'Opening\\u2026';
          for (const url of urls) {
            const serverBtn = Array.from(panelBody.querySelectorAll('.sign-in')).find(b => b.dataset.url === url);
            if (serverBtn) await handleSignIn(url, serverBtn);
          }
          btn.textContent = 'Sign in to all';
          btn.disabled = false;
        });
      });
      panelBody.querySelectorAll('.sign-out').forEach(btn => {
        btn.addEventListener('click', () => handleSignOut(btn.dataset.url, btn));
      });
    }

    async function fetchAuthStatus() {
      try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) {
          panelBody.innerHTML = '<div class="panel-empty">Could not load auth status.</div>';
          authBadge.classList.add('hidden');
          return;
        }
        const data = await res.json();
        renderServers(data.servers || [], data.groups);
      } catch (_) {
        panelBody.innerHTML = '<div class="panel-empty">Could not load auth status.</div>';
        authBadge.classList.add('hidden');
      }
    }

    async function handleSignIn(serverUrl, btn) {
      // Guard: if this button is currently showing "Cancel", skip re-entry
      if (btn.classList.contains('sign-out')) return;
      btn.disabled = true;
      btn.textContent = 'Opening\\u2026';
      const ac = new AbortController();
      let popup = null;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Login failed');
        }
        const { authUrl, state } = await res.json();
        // Open about:blank first, null opener to prevent reverse-tabnabbing,
        // then redirect — avoids a race where the target page could access window.opener
        popup = window.open('about:blank', '_blank', 'width=600,height=700');
        if (!popup) {
          btn.textContent = 'Sign in';
          btn.disabled = false;
          showPanelError('Popup blocked \\u2014 allow popups and try again.');
          return;
        }
        popup.opener = null;
        popup.location.href = authUrl;

        // Show a clickable Cancel button instead of disabled Waiting
        btn.textContent = 'Cancel';
        btn.disabled = false;
        btn.className = 'server-action sign-out'; // style as secondary
        const onCancel = () => ac.abort();
        btn.addEventListener('click', onCancel, { once: true });

        // Also poll popup.closed (may fail due to COOP — that's fine)
        const pollTimer = setInterval(() => {
          try { if (popup.closed) ac.abort(); } catch (_) { clearInterval(pollTimer); }
        }, 500);

        try {
          const waitRes = await fetch('/api/auth/wait/' + encodeURIComponent(state), { signal: ac.signal });
          if (!waitRes.ok) {
            const err = await waitRes.json().catch(() => ({}));
            throw new Error(err.error || 'Auth flow failed');
          }
          fetchAuthStatus();
        } finally {
          clearInterval(pollTimer);
          btn.removeEventListener('click', onCancel);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // User cancelled or closed popup — try to close popup and refresh status
          try { popup && !popup.closed && popup.close(); } catch (_) { /* cross-origin */ }
          btn.textContent = 'Sign in';
          btn.disabled = false;
          btn.className = 'server-action sign-in';
          fetchAuthStatus();
          return;
        }
        btn.textContent = 'Sign in';
        btn.disabled = false;
        btn.className = 'server-action sign-in';
        showPanelError('Sign-in failed: ' + err.message);
      }
    }

    async function handleSignOut(serverUrl, btn) {
      btn.disabled = true;
      btn.textContent = 'Signing out\\u2026';
      try {
        const res = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Logout failed');
        }
        fetchAuthStatus();
      } catch (err) {
        btn.textContent = 'Sign out';
        btn.disabled = false;
        showPanelError('Sign-out failed: ' + err.message);
      }
    }

    // Fetch auth status on load to show badge
    fetchAuthStatus();
  </script>
  </div><!-- /main-content -->
</body>
</html>`;
}
