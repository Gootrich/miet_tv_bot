import { useSyncExternalStore } from "react";
import type { DTRange } from "../components/DateTimeRangePicker";

export interface CartState {
  /** Выбранный период (может быть пустым). */
  range: DTRange;
  /** modelId -> количество (>= 1). */
  items: Map<number, number>;
}

let state: CartState = {
  range: { start: null, end: null },
  items: new Map(),
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): CartState {
  return state;
}

function commit(next: Partial<CartState>): void {
  state = { ...state, ...next };
  emit();
}

/** Подписка React на состояние корзины. Корзина живёт в памяти вкладки. */
export function useCart(): CartState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function cartSetRange(range: DTRange): void {
  if (
    state.range.start === range.start &&
    state.range.end === range.end
  ) {
    return;
  }
  commit({ range });
}

export function cartToggle(modelId: number): void {
  const items = new Map(state.items);
  if (items.has(modelId)) items.delete(modelId);
  else items.set(modelId, 1);
  commit({ items });
}

export function cartSetQty(modelId: number, quantity: number): void {
  const items = new Map(state.items);
  if (quantity <= 0) items.delete(modelId);
  else items.set(modelId, quantity);
  commit({ items });
}

export function cartRemove(modelId: number): void {
  const items = new Map(state.items);
  items.delete(modelId);
  commit({ items });
}

export function cartClear(): void {
  if (state.items.size === 0) return;
  commit({ items: new Map() });
}
