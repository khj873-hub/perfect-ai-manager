import { z } from "zod";
import { computeSettlement } from "../domain/settlement";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, resolveStore, resolveEmployee, isErr } from "./context";

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, "월은 YYYY-MM 형식이어야 합니다");

export const getPayrollPreviewInput = z
  .object({ month: MONTH, employee_name: z.string().optional(), store_id: z.string().optional() })
  .strict();
export type GetPayrollPreviewInput = z.infer<typeof getPayrollPreviewInput>;

export interface PayrollRow {
  name: string;
  worked_minutes: number;
  overtime_minutes: number;
  holiday_minutes: number;
  base_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  total: number;
  notes: string[];
}

// owner 전용(레지스트리에서 역할 필터 + execute 에서 재확인). 급여는 참고용 계산이다.
export async function getPayrollPreview(
  source: AttendanceSource,
  ctx: ToolContext,
  input: GetPayrollPreviewInput,
): Promise<ToolResult<{ store_id: string; month: string; rows: PayrollRow[]; disclaimer: string }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  const db = await source.load(s.store_id);
  const emp = resolveEmployee(db, input.employee_name);
  if (isErr(emp)) return emp;

  const rows: PayrollRow[] = computeSettlement(db, input.month, ctx.today)
    .filter((r) => !emp.employee || r.employeeId === emp.employee.id)
    .map((r) => ({
      name: r.name,
      worked_minutes: r.workedMinutes,
      overtime_minutes: r.overtimeMinutes,
      holiday_minutes: r.holidayMinutes,
      base_pay: r.basePay,
      overtime_pay: r.overtimePay,
      holiday_pay: r.holidayPay,
      total: r.total,
      notes: r.notes,
    }));
  return ok(source.now(), {
    store_id: s.store_id,
    month: input.month,
    rows,
    disclaimer: "참고용 계산입니다. 급여 확정은 퍼펙트근태관리에서 하세요.",
  });
}
