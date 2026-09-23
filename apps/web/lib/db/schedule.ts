import { createServiceClient } from "@/lib/db/service";
import type { DefaultShift } from "@perfect-ai-manager/connector-attendance";

// 에이전트 DB default_schedules 에서 매장 기본 근무표를 읽는다(스케줄 안 b).
// Supabase 미설정이거나 미등록 매장이면 [] → withDefaultSchedule 이 shifts 를 비워 둔다(schedule_unavailable).
export async function loadDefaultSchedule(storeId: string): Promise<DefaultShift[]> {
  const sb = createServiceClient();
  if (!sb) return [];
  const { data } = await sb
    .from("default_schedules")
    .select("employee_id, weekday, start_hm, end_hm")
    .eq("store_id", storeId);
  return (data ?? []).map((r) => ({
    employeeId: String(r.employee_id),
    weekday: Number(r.weekday),
    start: String(r.start_hm),
    end: String(r.end_hm),
  }));
}
