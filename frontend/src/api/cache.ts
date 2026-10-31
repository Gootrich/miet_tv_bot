// Мини-кэш stale-while-revalidate: без зависимостей.
type Entry = { data: unknown; at: number; inflight?: Promise<unknown> };
const store = new Map<string, Entry>();
const versions = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

export function versionOf(key: string): number {
  return versions.get(key) ?? 0;
}

export function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    const cur = listeners.get(key);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) listeners.delete(key);
  };
}

/** Возвращает данные; если кэш старше ttl, обновляет (дедуплицируя запросы). */
export function load<T>(key: string, fetcher: () => Promise<T>, ttlMs = 45_000): Promise<T> {
  const e = store.get(key);
  if (e && Date.now() - e.at < ttlMs) return Promise.resolve(e.data as T);
  if (e?.inflight) return e.inflight as Promise<T>;
  const p = fetcher()
    .then((data) => {
      store.set(key, { data, at: Date.now() });
      notify(key);
      return data;
    })
    .catch((err) => {
      const cur = store.get(key);
      if (cur) delete cur.inflight;
      throw err;
    });
  store.set(key, { data: e?.data, at: e?.at ?? 0, inflight: p });
  return p;
}

/**
 * Помечает записи устаревшими, не удаляя данные (SWR без «мигания»).
 * Подписчики через useCachedData получат сигнал и перезапросят данные,
 * но текущее значение останется видимым до прихода нового.
 */
export function invalidate(prefix = ""): void {
  for (const k of [...store.keys()]) {
    if (!k.startsWith(prefix)) continue;
    const e = store.get(k);
    if (!e) continue;
    store.set(k, { data: e.data, at: 0, inflight: e.inflight });
    versions.set(k, (versions.get(k) ?? 0) + 1);
    notify(k);
  }
}
