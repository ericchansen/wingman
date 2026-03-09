import { useEffect, useRef } from 'react';

/**
 * Hook that auto-scrolls a container to the bottom as new content streams in.
 *
 * Works with both shadcn ScrollArea (data-slot="scroll-area-viewport") and
 * plain scrollable divs. Respects the user's scroll position — if they've
 * scrolled up to read history, auto-scroll pauses until they scroll back
 * near the bottom.
 *
 * @param deps - Reactive values that trigger a scroll check (e.g., messages, streaming content)
 * @param threshold - Pixels from bottom to consider "at bottom" (default: 80)
 * @returns ref to attach to the scroll container (or its wrapper)
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  deps: unknown[],
  threshold = 80,
) {
  const containerRef = useRef<T>(null);
  const isUserScrolledUp = useRef(false);
  const scrollListenerRef = useRef<{ el: HTMLElement; handler: () => void } | null>(null);

  // Resolve the actual scrollable element (handles shadcn ScrollArea wrapper)
  function getScrollEl(): HTMLElement | null {
    const el = containerRef.current;
    if (!el) return null;
    return el.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? el;
  }

  // Auto-scroll and attach/reattach scroll listener on every deps change
  useEffect(() => {
    const scrollEl = getScrollEl();
    if (!scrollEl) return;

    // Attach scroll listener if not already on this element
    if (scrollListenerRef.current?.el !== scrollEl) {
      // Clean up old listener
      if (scrollListenerRef.current) {
        scrollListenerRef.current.el.removeEventListener('scroll', scrollListenerRef.current.handler);
      }
      const handler = () => {
        const { scrollTop, scrollHeight, clientHeight } = scrollEl;
        isUserScrolledUp.current = scrollHeight - scrollTop - clientHeight > threshold;
      };
      scrollEl.addEventListener('scroll', handler, { passive: true });
      scrollListenerRef.current = { el: scrollEl, handler };
    }

    // Scroll to bottom unless user scrolled up
    if (!isUserScrolledUp.current) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollListenerRef.current) {
        scrollListenerRef.current.el.removeEventListener('scroll', scrollListenerRef.current.handler);
        scrollListenerRef.current = null;
      }
    };
  }, []);

  return containerRef;
}
