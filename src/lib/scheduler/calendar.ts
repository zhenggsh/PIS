import { addDays, compareDate, weekdayIndex, type DateStr } from "@/lib/date";
import { DEFAULT_WORKWEEK_MASK } from "@/lib/domain/types";

/**
 * 工作日历（设计文档 6.1）
 * - workweekMask 位掩码：bit0=周一 … bit6=周日；默认 31（周一~周五）
 * - holidays 为 "YYYY-MM-DD" 集合
 * - 口径：addWorkdays(start, 0) === snapForward(start)；工期 1 天时 start === end
 */
export interface Calendar {
  readonly mask: number;
  readonly holidays: ReadonlySet<DateStr>;
  isWorkday(date: DateStr): boolean;
  snapForward(date: DateStr): DateStr;
  snapBackward(date: DateStr): DateStr;
  addWorkdays(date: DateStr, offset: number): DateStr;
  /** from（不含）→ to（含）之间跨越的工作日数；反向为负 */
  workdaysBetween(from: DateStr, to: DateStr): number;
  /** [from, to] 闭区间内的工作日数 */
  workdaysInclusive(from: DateStr, to: DateStr): number;
}

const ITERATION_GUARD = 4000;

export function createCalendar(
  mask: number = DEFAULT_WORKWEEK_MASK,
  holidays: Iterable<DateStr> = [],
): Calendar {
  // 掩码为 0 时视为全周工作，避免死循环
  const normalized = mask & 0b1111111 || 0b1111111;
  const holidaySet = new Set(holidays);

  const isWorkday = (date: DateStr): boolean => {
    const bit = 1 << weekdayIndex(date);
    return (normalized & bit) !== 0 && !holidaySet.has(date);
  };

  const snapForward = (date: DateStr): DateStr => {
    let cursor = date;
    for (let i = 0; i < ITERATION_GUARD; i += 1) {
      if (isWorkday(cursor)) return cursor;
      cursor = addDays(cursor, 1);
    }
    return cursor;
  };

  const snapBackward = (date: DateStr): DateStr => {
    let cursor = date;
    for (let i = 0; i < ITERATION_GUARD; i += 1) {
      if (isWorkday(cursor)) return cursor;
      cursor = addDays(cursor, -1);
    }
    return cursor;
  };

  const addWorkdays = (date: DateStr, offset: number): DateStr => {
    let cursor = snapForward(date);
    if (offset === 0) return cursor;
    const step = offset > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(offset); i += 1) {
      cursor = step > 0 ? snapForward(addDays(cursor, 1)) : snapBackward(addDays(cursor, -1));
    }
    return cursor;
  };

  const workdaysBetween = (from: DateStr, to: DateStr): number => {
    if (from === to) return 0;
    const forward = compareDate(from, to) < 0;
    const [lo, hi] = forward ? [from, to] : [to, from];
    let count = 0;
    let cursor = addDays(lo, 1);
    for (let i = 0; i < ITERATION_GUARD && compareDate(cursor, hi) <= 0; i += 1) {
      if (isWorkday(cursor)) count += 1;
      cursor = addDays(cursor, 1);
    }
    return forward ? count : -count;
  };

  const workdaysInclusive = (from: DateStr, to: DateStr): number => {
    if (compareDate(from, to) > 0) return 0;
    let count = 0;
    let cursor = from;
    for (let i = 0; i < ITERATION_GUARD && compareDate(cursor, to) <= 0; i += 1) {
      if (isWorkday(cursor)) count += 1;
      cursor = addDays(cursor, 1);
    }
    return count;
  };

  return {
    mask: normalized,
    holidays: holidaySet,
    isWorkday,
    snapForward,
    snapBackward,
    addWorkdays,
    workdaysBetween,
    workdaysInclusive,
  };
}
