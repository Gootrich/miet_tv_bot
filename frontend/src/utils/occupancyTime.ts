/** Рабочие часы студии: слоты [9:00–22:00), последний 21:00–22:00. */
export const HOUR_START = 9;
export const HOUR_END = 22;
export const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);
