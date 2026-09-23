import { z } from "zod";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, resolveStore, isErr } from "./context";

export const listEmployeesInput = z.object({ store_id: z.string().optional() }).strict();
export type ListEmployeesInput = z.infer<typeof listEmployeesInput>;

export interface EmployeeRow {
  name: string;
  active: boolean;
  hourly_wage?: number; // owner 에게만 (§4 필드 제한)
}

export async function listEmployees(
  source: AttendanceSource,
  ctx: ToolContext,
  input: ListEmployeesInput,
): Promise<ToolResult<{ store_id: string; employees: EmployeeRow[] }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  const db = await source.load(s.store_id);
  const employees: EmployeeRow[] = db.employees.map((e) => ({
    name: e.name,
    active: e.active,
    ...(ctx.role === "owner" ? { hourly_wage: e.hourlyWage } : {}),
    // 전화번호·PIN 등은 출력하지 않는다 (§4)
  }));
  return ok(source.now(), { store_id: s.store_id, employees });
}
