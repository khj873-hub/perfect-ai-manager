import { describe, expect, it } from "vitest";
import {
  createFixtureSource,
  addDays,
  defaultPermissions,
  type AttendanceSource,
  type Db,
} from "@perfect-ai-manager/connector-attendance";
import { buildBriefing } from "@/lib/agent/briefing";

const NOW = new Date("2026-09-23T01:00:00Z");
const TODAY = "2026-09-23";

describe("아침 브리핑", () => {
  it("어제 이상 5건을 요약한다", async () => {
    const src = createFixtureSource({ storeId: "store_demo", now: NOW });
    const b = await buildBriefing("store_demo", src, TODAY);
    expect(b.work_date).toBe("2026-09-22"); // 어제
    expect(b.issues.length).toBe(5);
    expect(b.body).toContain("이상 5건");
    expect(b.body).toContain("김민지");
    expect(b.body.split("\n").length).toBeLessThanOrEqual(6); // 제목 + 최대 5줄
  });

  it("이상이 없으면 특이사항 없음 한 줄", async () => {
    // 어제(09-22)에 정시 출퇴근만 있는 깨끗한 매장
    const y = addDays(TODAY, -1);
    const db: Db = {
      version: 1,
      store: { name: "테스트", graceMinutes: 5, fivePlus: false },
      employees: [{ id: "e1", name: "김직원", phone: "", pin: "", hourlyWage: 10320, active: true }],
      shifts: [{ id: "s1", employeeId: "e1", date: y, start: "09:00", end: "18:00" }],
      punches: [
        { id: "p1", employeeId: "e1", type: "in", date: y, time: "09:00", deviceId: "d1" },
        { id: "p2", employeeId: "e1", type: "out", date: y, time: "18:00", deviceId: "d1" },
      ],
      corrections: [],
      issues: [],
      actions: [],
      messages: [],
      reports: [],
      settlements: [],
      permissions: defaultPermissions(),
    };
    const clean: AttendanceSource = { now: () => NOW, storeIds: () => ["s1"], load: () => db };
    const b = await buildBriefing("s1", clean, TODAY);
    expect(b.issues.length).toBe(0);
    expect(b.body).toContain("특이사항 없었어요");
  });
});
