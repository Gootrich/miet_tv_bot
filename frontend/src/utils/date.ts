export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const wd = d.getDay();
  const offset = wd === 0 ? -6 : 1 - wd;
  d.setDate(d.getDate() + offset);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + n);
  return r;
}

export function addHours(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 3_600_000);
}

export function setHour(date: Date, hour: number): Date {
  const r = new Date(date);
  r.setHours(hour, 0, 0, 0);
  return r;
}

const WEEKDAYS_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"] as const;

export function weekdayShort(date: Date): string {
  return WEEKDAYS_SHORT[date.getDay()];
}

export function formatDayMonth(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function formatWeekRange(start: Date, end: Date): string {
  return `${formatDayMonth(start)} — ${formatDayMonth(end)}`;
}
