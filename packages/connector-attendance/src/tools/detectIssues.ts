import { z } from "zod";
import { detect } from "../domain/detect";
import { employeeName } from "../domain/records";
import { kstParts } from "../domain/time";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, ok, err, resolveStore, isErr } from "./context";
import type { IssueKind } from "../domain/types";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다");

export const detectIssuesInput = z.object({ date: DATE, store_id: z.string().optional() }).strict();
export type DetectIssuesInput = z.infer<typeof detectIssuesInput>;

export interface IssueRow {
  name: string;
  kind: IssueKind;
  minutes?: number;
  detail: string;
}

export async function detectIssues(
  source: AttendanceSource,
  ctx: ToolContext,
  input: DetectIssuesInput,
): Promise<ToolResult<{ store_id: string; date: string; issues: IssueRow[] }>> {
  const s = resolveStore(ctx, input.store_id);
  if (isErr(s)) return s;
  const db = await source.load(s.store_id);
  if (db.shifts.length === 0) return err("schedule_unavailable", "스케줄 데이터가 없어 이상 건을 판정할 수 없습니다");

  const nowStamp = kstParts(source.now()).stamp;
  const issues: IssueRow[] = detect(db, input.date, nowStamp).map((f) => ({
    name: employeeName(db, f.employeeId),
    kind: f.kind,
    minutes: f.minutes,
    detail: f.detail,
  }));
  return ok(source.now(), { store_id: s.store_id, date: input.date, issues });
}
