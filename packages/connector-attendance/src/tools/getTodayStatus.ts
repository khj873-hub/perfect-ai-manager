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
  const employees: TodayRow[] = recordsForDate(db, ctx.today)
    .filter((r) => r.shift)
    .map((r) => ({
      name: employeeName(db, r.employeeId),
      scheduled: r.shift ? `${r.shift.start}-${r.shift.end}` : null,
      check_in: r.checkIn,
      check_out: r.checkOut,
      status: r.checkIn ? (r.checkOut ? "퇴근" : "근무중") : "예정",
    }));
  return ok(source.now(), { store_id: s.store_id, date: ctx.today, employees });
}
