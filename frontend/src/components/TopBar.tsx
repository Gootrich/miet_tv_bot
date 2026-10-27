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

  const clock = formatClock(now);

  return (
    <header className="top-bar">
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
