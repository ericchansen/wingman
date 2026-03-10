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
    ? ui.theme! : 'system';

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
      display: flex; flex-direction: column;
    }

    header {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 10px;
      background: var(--bg); flex-shrink: 0;
    }
    header .logo { font-size: 24px; }
    header h1 { font-size: 18px; font-weight: 600; }

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
  <header>
    <span class="logo">🦜</span>
    <h1>${title}</h1>
  </header>

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
        busy = false;
        form.querySelector('button').disabled = false;
        input.focus();
      }
    });

    input.focus();
  </script>
</body>
</html>`;
}
