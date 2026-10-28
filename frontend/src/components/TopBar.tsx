import { useEffect, useState } from "react";

function formatClock(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TopBar({ title = "Каталог" }: { title?: string } = {}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const msToNextMinute = 60_000 - (Date.now() % 60_000) + 50;
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 30_000);
    }, msToNextMinute);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  // Сворачивание при прокрутке вниз, показ при прокрутке вверх.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (y <= 8) setHidden(false);
        else if (dy > 6 && y > 64) setHidden(true);
        else if (dy < -6) setHidden(false);
        if (Math.abs(dy) > 6 || y <= 8) lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const clock = formatClock(now);

  return (
    <header className={`top-bar${hidden ? " is-hidden" : ""}`}>
      <div className="top-bar__inner">
        <h1 className="top-bar__title">{title}</h1>
        <span className="top-bar__brand" aria-hidden="true">
          MediaHub
        </span>
        <time
          className="top-bar__clock"
          dateTime={now.toISOString()}
          aria-label={`Сейчас ${clock}`}
        >
          {clock}
        </time>
      </div>
    </header>
  );
}
