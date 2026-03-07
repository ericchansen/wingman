/**
 * DebugPanel — Collapsible panel showing raw SSE events.
 *
 * Opt-in component for development debugging. Records all events
 * dispatched through the SSE handler and displays them as JSON.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

export interface DebugEvent {
  timestamp: number;
  event: string;
  data: Record<string, unknown>;
}

export interface DebugPanelProps {
  /** Array of debug events to display. */
  events: DebugEvent[];
  /** Maximum events to keep in view (oldest are hidden). Default: 200. */
  maxEvents?: number;
  className?: string;
}

export function DebugPanel({ events, maxEvents = 200, className = '' }: DebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleEvents = events.slice(-maxEvents);
  const filtered = filter
    ? visibleEvents.filter((e) => e.event.includes(filter))
    : visibleEvents;

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, isOpen]);

  const handleClear = useCallback(() => {
    // Events array is owned by parent — this just collapses the panel
    setIsOpen(false);
  }, []);

  return (
    <div className={`wingman-debug-panel ${isOpen ? 'wingman-debug-panel-open' : ''} ${className}`}>
      <button
        type="button"
        className="wingman-debug-panel-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        🐛 Debug ({events.length} events)
      </button>
      {isOpen && (
        <div className="wingman-debug-panel-content">
          <div className="wingman-debug-panel-toolbar">
            <input
              type="text"
              className="wingman-debug-panel-filter"
              placeholder="Filter events…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter debug events"
            />
            <button type="button" onClick={handleClear} className="wingman-debug-panel-close">
              Close
            </button>
          </div>
          <div className="wingman-debug-panel-events" ref={scrollRef}>
            {filtered.map((e, i) => (
              <div key={i} className="wingman-debug-panel-event">
                <span className="wingman-debug-panel-time">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
                <span className="wingman-debug-panel-event-name">{e.event}</span>
                <pre className="wingman-debug-panel-data">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
