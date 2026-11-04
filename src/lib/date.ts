/**
 * 纯日期工具（同构，无框架/无 IO 依赖）
 * 约定：所有"纯日期"统一使用 "YYYY-MM-DD" 字符串；内部按 UTC 解析，规避时区偏移。
 */

export type DateStr = string;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(value: unknown): value is DateStr {
  return typeof value === "string" && DATE_RE.test(value);
}

export function parseDate(value: DateStr): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date: Date): DateStr {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(value: DateStr, days: number): DateStr {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

/** 0=周一 … 6=周日 */
export function weekdayIndex(value: DateStr): number {
  return (parseDate(value).getUTCDay() + 6) % 7;
}

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function compareDate(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a >= b ? a : b;
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a <= b ? a : b;
}

/** 本地时区的今天（用于"今日线"） */
export function todayStr(): DateStr {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 生成 [start, end] 区间内的全部日期（含首尾），上限保护 2000 天 */
export function enumerateDates(start: DateStr, end: DateStr): DateStr[] {
  const result: DateStr[] = [];
  let cursor = start;
  let guard = 0;
  while (compareDate(cursor, end) <= 0 && guard < 2000) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return result;
}

export function formatDisplay(value: DateStr | null | undefined): string {
  if (!value) return "—";
  const [, m, d] = value.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function formatWithWeekday(value: DateStr | null | undefined): string {
  if (!value) return "—";
  return `${value} 周${WEEKDAY_LABELS[weekdayIndex(value)]}`;
}
