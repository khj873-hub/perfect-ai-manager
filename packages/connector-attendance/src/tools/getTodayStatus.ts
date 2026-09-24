import { z } from "zod";
import { recordsForDate, employeeName } from "../domain/records";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, resolveStore, isErr } from "./context";

export const getTodayStatusInput = z.object({ store_id: z.string().optional() }).strict();
export type GetTodayStatusInput = z.infer<typeof getTodayStatusInput>;

export interface TodayRow {
  name: string;
  scheduled: string | null; // "HH:mm-HH:mm"
  check_in: string | null;
  check_out: string | null;
  status: "예정" | "근무중" | "퇴근";
}

export async function getTodayStatus(
  source: AttendanceSource,
  ctx: ToolContext,
  input: GetTodayStatusInput,
): Promise<ToolResult<{ store_id: string; date: string; employees: TodayRow[] }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  const db = await source.load(s.store_id);
  // 스케줄(shift)이 있거나, 실제 출근(check_in)한 직원을 모두 포함한다.
  // (근무표 미등록 매장에서도 실제 출근자가 "근무중"으로 보이도록 — shift만 필터하면 누락됨)
  const employees: TodayRow[] = recordsForDate(db, ctx.today)
    .filter((r) => r.shift || r.checkIn)
    .map((r) => ({
      name: employeeName(db, r.employeeId),
      scheduled: r.shift ? `${r.shift.start}-${r.shift.end}` : null,
      check_in: r.checkIn,
      check_out: r.checkOut,
      status: r.checkIn ? (r.checkOut ? "퇴근" : "근무중") : "예정",
    }));
  return ok(source.now(), { store_id: s.store_id, date: ctx.today, employees });
}
