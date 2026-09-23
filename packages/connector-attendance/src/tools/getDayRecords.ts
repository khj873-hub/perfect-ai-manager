import { z } from "zod";
import { recordsForDate, workedMinutes, employeeName } from "../domain/records";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, resolveStore, resolveEmployee, isErr } from "./context";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다");

export const getDayRecordsInput = z
  .object({ date: DATE, employee_name: z.string().optional(), store_id: z.string().optional() })
  .strict();
export type GetDayRecordsInput = z.infer<typeof getDayRecordsInput>;

export interface DayRow {
  name: string;
  scheduled: string | null;
  check_in: string | null;
  check_out: string | null;
  worked_minutes: number; // 인정 근무분 (스케줄 범위 내, 휴게 공제)
}

export async function getDayRecords(
  source: AttendanceSource,
  ctx: ToolContext,
  input: GetDayRecordsInput,
): Promise<ToolResult<{ store_id: string; date: string; records: DayRow[] }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  const db = await source.load(s.store_id);
  const emp = resolveEmployee(db, input.employee_name);
  if (isErr(emp)) return emp;

  const records: DayRow[] = recordsForDate(db, input.date)
    .filter((r) => !emp.employee || r.employeeId === emp.employee.id)
    .map((r) => ({
      name: employeeName(db, r.employeeId),
      scheduled: r.shift ? `${r.shift.start}-${r.shift.end}` : null,
      check_in: r.checkIn,
      check_out: r.checkOut,
      worked_minutes: workedMinutes(r),
    }));
  return ok(source.now(), { store_id: s.store_id, date: input.date, records });
}
