import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { load, peek, subscribe, versionOf } from "./cache";

export interface CachedData<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refresh: () => void;
}

export interface UseCachedDataOptions {
  ttlMs?: number;
  /** Показывать данные предыдущего ключа, пока новый ключ грузится (без «мигания»). */
  keepPrevious?: boolean;
}

/**
 * Подписка на глобальный кэш (см. ./cache.ts) с автоматической загрузкой.
 *
 * Поведение SWR: если в кэше уже есть данные — они возвращаются сразу,
 * а обновление выполняется в фоне, когда истёк TTL или запись была
 * инвалидирована (через invalidate()).
 *
 * Ключ `key` должен однозначно определять содержимое. Если нужно
 * перезапросить данные при изменении параметров — меняйте key.
 *
 * С `keepPrevious: true` при смене ключа возвращаются данные прошлого
 * ключа, пока не придут новые — карточки не пропадают.
 */
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMsOrOpts: number | UseCachedDataOptions = 45_000,
): CachedData<T> {
  const opts: UseCachedDataOptions =
    typeof ttlMsOrOpts === "number" ? { ttlMs: ttlMsOrOpts } : ttlMsOrOpts;
  const ttlMs = opts.ttlMs ?? 45_000;
  const keepPrevious = opts.keepPrevious ?? false;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const data = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    useCallback(() => peek<T>(key), [key]),
    useCallback(() => peek<T>(key), [key]),
  );

  const version = useSyncExternalStore(
    useCallback((cb: () => void) => subscribe(key, cb), [key]),
    useCallback(() => versionOf(key), [key]),
    useCallback(() => versionOf(key), [key]),
  );

  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(data === undefined);
  const [tick, setTick] = useState(0);

  const lastRef = useRef<T | undefined>(undefined);
  if (data !== undefined) lastRef.current = data;
  const shown = keepPrevious && data === undefined ? lastRef.current : data;

  useEffect(() => {
    let cancelled = false;
    if (peek<T>(key) === undefined) setLoading(true);
    load(key, () => fetcherRef.current(), ttlMs)
      .then(() => {
        if (cancelled) return;
        setError(undefined);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, ttlMs, tick, version]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return {
    data: shown,
    error,
    loading: shown === undefined && loading,
    refresh,
  };
}
