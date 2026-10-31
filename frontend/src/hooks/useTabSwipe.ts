import { useEffect, useRef } from "react";

export interface TabSwipeOptions {
  /** Порядок вкладок слева направо. */
  tabs: readonly string[];
  current: string;
  onChange: (next: string) => void;
  /** Минимальный горизонтальный сдвиг, px. */
  threshold?: number;
  /** Максимальный вертикальный сдвиг, px. */
  maxDy?: number;
  /** Максимальное время жеста, мс. */
  maxMs?: number;
}

const HORIZONTAL_SCROLL_SELECTORS = [".chips-scroll", ".occ-ribbon"];

function isBlocked(target: EventTarget | null): boolean {
  let el: Element | null = target instanceof Element ? target : null;
  while (el) {
    if (el.hasAttribute("data-no-swipe")) return true;
    if (el instanceof HTMLElement) {
      const tag = el.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      ) {
        return true;
      }
      for (const sel of HORIZONTAL_SCROLL_SELECTORS) {
        if (el.matches(sel)) return true;
      }
      const style = window.getComputedStyle(el);
      const ox = style.overflowX;
      if (
        (ox === "auto" || ox === "scroll") &&
        el.scrollWidth > el.clientWidth + 2
      ) {
        return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

export function useTabSwipe({
  tabs,
  current,
  onChange,
  threshold = 60,
  maxDy = 50,
  maxMs = 800,
}: TabSwipeOptions): void {
  const startRef = useRef<{
    x: number;
    y: number;
    t: number;
    blocked: boolean;
  } | null>(null);

  const latest = useRef({ tabs, current, onChange });
  latest.current = { tabs, current, onChange };

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        startRef.current = null;
        return;
      }
      const t = e.touches[0];
      startRef.current = {
        x: t.clientX,
        y: t.clientY,
        t: performance.now(),
        blocked: isBlocked(e.target),
      };
    };

    const onEnd = (e: TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start || start.blocked) return;
      if (e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const dt = performance.now() - start.t;
      if (dt > maxMs) return;
      if (Math.abs(dy) > maxDy) return;
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;

      const { tabs, current, onChange } = latest.current;
      const idx = tabs.indexOf(current);
      if (idx < 0) return;
      const nextIdx = dx < 0 ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= tabs.length) return;
      onChange(tabs[nextIdx]);
    };

    const onCancel = () => {
      startRef.current = null;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [threshold, maxDy, maxMs]);
}
