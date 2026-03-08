import { useEffect, useRef, useCallback } from 'react';

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
 *
 * @example
 * ```tsx
 * const scrollRef = useAutoScroll([messages, streamingContent], 80);
 * return <ScrollArea ref={scrollRef}>...</ScrollArea>;
 * ```
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  deps: unknown[],
  threshold = 80,
) {
  const containerRef = useRef<T>(null);
  const isUserScrolledUp = useRef(false);

  // Resolve the actual scrollable element (handles shadcn ScrollArea wrapper)
  const getScrollEl = useCallback((): HTMLElement | null => {
    const el = containerRef.current;
    if (!el) return null;
    // shadcn ScrollArea wraps the viewport in [data-slot="scroll-area-viewport"]
    return el.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? el;
  }, []);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const scrollEl = getScrollEl();
    if (!scrollEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      isUserScrolledUp.current = distanceFromBottom > threshold;
    };

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, [getScrollEl, threshold]);

  // Auto-scroll when deps change, unless user has scrolled up
  useEffect(() => {
    if (isUserScrolledUp.current) return;

    const scrollEl = getScrollEl();
    if (!scrollEl) return;

    // Use requestAnimationFrame for smooth scroll after DOM paint
    requestAnimationFrame(() => {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return containerRef;
}
