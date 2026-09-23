import { describe, expect, it, beforeEach } from "vitest";
import { createFixtureDb } from "@/adapter/FixtureSource";
import { detect, lateCount } from "@/domain/detect";
import type { Db } from "@/domain/types";

// MVP tests/agent.test.ts 의 "감지 규칙" 블록 이식 (순수 도메인).
// 원본의 "에이전트 실행"·"직원 답변 → 기록 정정"·"권한과 정산" 블록은 agent.ts/permissions.ts
// 의존 — 이번 범위 밖(M1 loop.ts / M2 쓰기·guard.ts).

// 2026-09-23 10:00 KST 기준 (어제 = 2026-09-22 화요일)
const NOW = new Date("2026-09-23T01:00:00Z");
const TODAY = "2026-09-23";
const Y = "2026-09-22";
const STAMP = "2026-09-23 10:00";

let db: Db;
beforeEach(() => {
  db = createFixtureDb(NOW);
});

describe("감지 규칙", () => {
  it("어제 시나리오의 이상 건 5종을 모두 찾는다", () => {
    const f = detect(db, Y, STAMP);
    const kinds = f.map((x) => `${x.employeeId}:${x.kind}`).sort();
    expect(kinds).toEqual(["e1:late", "e2:missing_checkout", "e3:early_leave", "e4:proxy_suspect", "e5:absent"]);
    expect(f.find((x) => x.kind === "late")?.minutes).toBe(17);
    expect(f.find((x) => x.kind === "early_leave")?.minutes).toBe(40);
  });

  it("정상 근무일에는 아무것도 찾지 않는다", () => {
    const quiet = "2026-09-15";
    const f = detect(db, quiet, STAMP).filter((x) => x.employeeId !== "e1");
    expect(f).toEqual([]);
  });

  it("근무 중인 오늘은 퇴근 누락으로 보지 않는다", () => {
    const f = detect(db, TODAY, STAMP);
    expect(f.some((x) => x.kind === "missing_checkout")).toBe(false);
  });

  it("최근 30일 김민지 지각 3회", () => {
    expect(lateCount(db, "e1", Y)).toBe(3);
  });
});
