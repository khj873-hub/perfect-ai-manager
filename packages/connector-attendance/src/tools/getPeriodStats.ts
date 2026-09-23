import { z } from "zod";
import { dayRecord, workedMinutes } from "../domain/records";
import { addDays, toMinutes } from "../domain/time";
import type { Db } from "../domain/types";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, err, resolveStore, resolveEmployee, isErr } from "./context";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다");
const MAX_DAYS = 93; // 부하 방지: 최대 조회 기간 (§3-2)

export const getPeriodStatsInput = z
  .object({ from: DATE, to: DATE, employee_name: z.string().optional(), store_id: z.string().optional() })
  .strict();
export type GetPeriodStatsInput = z.infer<typeof getPeriodStatsInput>;

export interface PeriodRow {
  name: string;
  late_count: number;
  late_minutes: number; // 지각 분 합계
  early_leave_count: number;
  absent_count: number;
  worked_minutes: number; // 인정 근무분 합계
}

function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function statsFor(db: Db, employeeId: string, name: string, days: string[], grace: number, today: string): PeriodRow {
  const row: PeriodRow = { name, late_count: 0, late_minutes: 0, early_leave_count: 0, absent_count: 0, worked_minutes: 0 };
  for (const d of days) {
    const rec = dayRecord(db, employeeId, d);
    if (!rec.shift) continue;
    if (rec.checkIn) {
      const late = toMinutes(rec.checkIn) - toMinutes(rec.shift.start);
      if (late > grace) {
        row.late_count++;
        row.late_minutes += late;
      }
    }
    if (rec.checkOut) {
      const early = toMinutes(rec.shift.end) - toMinutes(rec.checkOut);
      if (early > grace) row.early_leave_count++;
    }
    if (!rec.checkIn && !rec.checkOut && d < today) row.absent_count++;
    row.worked_minutes += workedMinutes(rec);
  }
  return row;
}

export async function getPeriodStats(
  source: AttendanceSource,
  ctx: ToolContext,
  input: GetPeriodStatsInput,
): Promise<ToolResult<{ store_id: string; from: string; to: string; stats: PeriodRow[] }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  if (input.from > input.to) return err("bad_input", "시작일이 종료일보다 늦습니다");
  const days = dayList(input.from, input.to);
  if (days.length > MAX_DAYS) return err("bad_input", `조회 기간은 최대 ${MAX_DAYS}일입니다 (요청 ${days.length}일)`);

  const db = await source.load(s.store_id);
  if (db.shifts.length === 0) return err("schedule_unavailable", "스케줄 데이터가 없어 지각·결근을 계산할 수 없습니다");
  const emp = resolveEmployee(db, input.employee_name);
  if (isErr(emp)) return emp;

  const targets = emp.employee
    ? db.employees.filter((e) => e.id === emp.employee!.id)
    : db.employees.filter((e) => e.active);
  const stats = targets.map((e) => statsFor(db, e.id, e.name, days, db.store.graceMinutes, ctx.today));
  return ok(source.now(), { store_id: s.store_id, from: input.from, to: input.to, stats });
}
