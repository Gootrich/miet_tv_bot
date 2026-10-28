// Мини-кэш stale-while-revalidate: без зависимостей.
type Entry = { data: unknown; at: number; inflight?: Promise<unknown> };
const store = new Map<string, Entry>();

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/** Возвращает данные; если кэш старше ttl, обновляет (дедуплицируя запросы). */
export function load<T>(key: string, fetcher: () => Promise<T>, ttlMs = 45_000): Promise<T> {
  const e = store.get(key);
  if (e && Date.now() - e.at < ttlMs) return Promise.resolve(e.data as T);
  if (e?.inflight) return e.inflight as Promise<T>;
  const p = fetcher().then((data) => {
    store.set(key, { data, at: Date.now() });
    return data;
  }).catch((err) => {
    const cur = store.get(key);
    if (cur) delete cur.inflight;
    throw err;
  });
  store.set(key, { data: e?.data, at: e?.at ?? 0, inflight: p });
  return p;
}

export function invalidate(prefix = ""): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
