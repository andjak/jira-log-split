export interface Period {
  start: Date;
  end: Date;
}

export function endOfTodayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23, 59, 59, 999,
  ));
}

export function clampPeriodEndToTodayUTC<T extends Period>(period: T, now: Date = new Date()): T {
  const todayEnd = endOfTodayUTC(now);
  const clampedEnd = period.end.getTime() > todayEnd.getTime() ? todayEnd : period.end;
  return { ...period, end: clampedEnd } as T;
}


