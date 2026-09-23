import type { Db, Shift } from "../domain/types";
import { kstParts, addDays, weekday } from "../domain/time";
import type { AttendanceSource } from "./AttendanceSource";

// 기본 근무표 데코레이터 (스케줄 안 b — docs/attendance-schema-map.md §5-2).
// 근태관리에 스케줄 테이블이 없어 HttpSource 는 shifts=[] 를 준다. 이 래퍼는 매장별
// 기본 근무표(요일×직원×시간)를 조회 윈도우 전체에 펼쳐 shifts 를 합성한다.
// → 지각·조퇴·결근·"오늘 예정" 판정이 가능해진다.
//
// inner.load 가 이미 shifts 를 주면(예: 미래에 근태관리가 스케줄을 갖게 되면) 그대로 둔다.
// 기본 근무표가 비어 있으면(미설정 매장) shifts 는 비어 있어 도구가 schedule_unavailable(안 a).

export interface DefaultShift {
  employeeId: string; // 근태관리 employee id 와 동일해야 함
  weekday: number; // 0=일 … 6=토
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface WithScheduleOptions {
  schedule: (storeId: string) => DefaultShift[] | Promise<DefaultShift[]>;
  windowPastDays?: number; // 기본 120
  windowFutureDays?: number; // 기본 14
}

export function withDefaultSchedule(inner: AttendanceSource, opts: WithScheduleOptions): AttendanceSource {
  return {
    now: inner.now,
    storeIds: inner.storeIds.bind(inner),
    async load(storeId: string): Promise<Db> {
      const db = await inner.load(storeId);
      if (db.shifts.length > 0) return db; // 이미 스케줄이 있으면 손대지 않는다

      const rows = await opts.schedule(storeId);
      if (!rows.length) return db; // 기본 근무표 미설정 → shifts=[] (schedule_unavailable)

      const today = kstParts(inner.now()).date;
      const from = addDays(today, -(opts.windowPastDays ?? 120));
      const to = addDays(today, opts.windowFutureDays ?? 14);
      const byWeekday = new Map<number, DefaultShift[]>();
      for (const r of rows) {
        const list = byWeekday.get(r.weekday) ?? [];
        list.push(r);
        byWeekday.set(r.weekday, list);
      }

      const shifts: Shift[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const wd = weekday(d);
        for (const r of byWeekday.get(wd) ?? []) {
          shifts.push({ id: `sch_${r.employeeId}_${d}`, employeeId: r.employeeId, date: d, start: r.start, end: r.end });
        }
      }
      return { ...db, shifts };
    },
  };
}
