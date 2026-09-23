import { describe, expect, it } from "vitest";
import { withDefaultSchedule, type DefaultShift } from "@/adapter/withDefaultSchedule";
import { createAttendanceConnector } from "@/index";
import { detect } from "@/domain/detect";
import { weekday } from "@/domain/time";
import { defaultPermissions as perms } from "@/domain/permissions";
import type { AttendanceSource } from "@/adapter/AttendanceSource";
import type { Db } from "@/domain/types";
import type { ToolContext as Ctx } from "@/tools/context";

const NOW = new Date("2026-09-23T01:00:00Z");
const Y = "2026-09-22"; // 어제(화)
const STORE = "s1";

// 스케줄이 없는 소스(HttpSource 처럼): 어제 09:17 출근 / 15:03 퇴근만 있음
function noScheduleSource(): AttendanceSource {
  const db: Db = {
    version: 1,
    store: { name: "판교", graceMinutes: 5, fivePlus: false },
    employees: [{ id: "e1", name: "김민지", phone: "", pin: "", hourlyWage: 10320, active: true }],
    shifts: [],
    punches: [
      { id: "1-in", employeeId: "e1", type: "in", date: Y, time: "09:17", deviceId: "" },
      { id: "1-out", employeeId: "e1", type: "out", date: Y, time: "15:03", deviceId: "" },
    ],
    corrections: [],
    issues: [],
    actions: [],
    messages: [],
    reports: [],
    settlements: [],
    permissions: perms(),
  };
  return { now: () => NOW, storeIds: () => [STORE], load: () => db };
}

describe("withDefaultSchedule", () => {
  it("기본 근무표를 조회 윈도우에 펼쳐 shifts 를 합성한다", async () => {
    const wd = weekday(Y);
    const sched: DefaultShift[] = [{ employeeId: "e1", weekday: wd, start: "09:00", end: "15:00" }];
    const src = withDefaultSchedule(noScheduleSource(), { schedule: () => sched });
    const db = await src.load(STORE);
    expect(db.shifts.length).toBeGreaterThan(0);
    const yShift = db.shifts.find((s) => s.date === Y);
    expect(yShift).toBeTruthy();
    expect(yShift!.start).toBe("09:00");
  });

  it("합성된 스케줄로 지각을 탐지한다", async () => {
    const wd = weekday(Y);
    const sched: DefaultShift[] = [{ employeeId: "e1", weekday: wd, start: "09:00", end: "15:00" }];
    const src = withDefaultSchedule(noScheduleSource(), { schedule: () => sched });
    const db = await src.load(STORE);
    const findings = detect(db, Y, "2026-09-23 10:00");
    const late = findings.find((f) => f.kind === "late");
    expect(late?.minutes).toBe(17); // 09:17 - 09:00
  });

  it("기본 근무표가 비어 있으면 shifts 는 그대로 비어 있다(→ schedule_unavailable)", async () => {
    const src = withDefaultSchedule(noScheduleSource(), { schedule: () => [] });
    const conn = createAttendanceConnector(src);
    const ctx: Ctx = { userId: "u", role: "owner", storeIds: [STORE], today: "2026-09-23" };
    const res = (await conn.tools.find((t) => t.name === "get_period_stats")!.execute(ctx, { from: "2026-09-01", to: Y })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toBe("schedule_unavailable");
  });

  it("이미 shifts 가 있으면 손대지 않는다", async () => {
    const inner: AttendanceSource = {
      now: () => NOW,
      storeIds: () => [STORE],
      load: () => ({ ...(noScheduleSource().load(STORE) as Db), shifts: [{ id: "keep", employeeId: "e1", date: Y, start: "10:00", end: "16:00" }] }),
    };
    const src = withDefaultSchedule(inner, { schedule: () => [{ employeeId: "e1", weekday: weekday(Y), start: "09:00", end: "15:00" }] });
    const db = await src.load(STORE);
    expect(db.shifts).toHaveLength(1);
    expect(db.shifts[0].id).toBe("keep");
  });
});
