import {
  createAttendanceConnector,
  addDays,
  labelDate,
  type AttendanceSource,
  type ToolContext,
} from "@perfect-ai-manager/connector-attendance";

// 아침 브리핑 (HANDOFF §8): 어제 이상 건을 5줄 이내로 요약.
// 요약은 결정적 템플릿으로 만든다(자동 일일 메시지 → 재현성·무료·오류 없음).
// 필요하면 상위에서 LLM 다듬기를 붙일 수 있으나, 숫자·사실은 detect_issues(도구)에서만 온다.

export interface Briefing {
  store_id: string;
  work_date: string; // 어제 (YYYY-MM-DD)
  body: string;
  issues: unknown[];
}

export async function buildBriefing(storeId: string, source: AttendanceSource, today: string): Promise<Briefing> {
  const conn = createAttendanceConnector(source);
  const tool = conn.tools.find((t) => t.name === "detect_issues")!;
  const workDate = addDays(today, -1);
  const ctx: ToolContext = { userId: "cron", role: "owner", storeIds: [storeId], today };
  const res = (await tool.execute(ctx, { date: workDate })) as
    | { ok: true; issues: { name: string; kind: string; detail: string }[] }
    | { ok: false; error: string; message: string };

  const label = labelDate(workDate);
  if (!res.ok) {
    // 예: 스케줄 미등록(schedule_unavailable)
    return { store_id: storeId, work_date: workDate, body: `${label} 근태 브리핑 — ${res.message}`, issues: [] };
  }
  const issues = res.issues;
  const body = issues.length
    ? `${label} 근태 브리핑 — 이상 ${issues.length}건\n` + issues.slice(0, 5).map((i) => `- ${i.detail}`).join("\n")
    : `${label} 근태 브리핑 — 특이사항 없었어요.`;
  return { store_id: storeId, work_date: workDate, body, issues };
}
