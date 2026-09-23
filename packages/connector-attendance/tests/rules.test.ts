import { describe, expect, it } from "vitest";
import { parseKoreanTime } from "@/domain/parseTime";
import { breakMinutes, workedMinutes, type DayRecord } from "@/domain/records";
import { computeSettlement } from "@/domain/settlement";
import { createFixtureDb } from "@/adapter/FixtureSource";
import { mondayOf, addDays } from "@/domain/time";

// MVP tests/rules.test.ts 에서 도메인 규칙 부분을 이식.
// 원본의 "질문 답변(규칙)" 블록은 ask.ts(ruleAnswer) 의존 — ask 는 이번 범위 밖(작업 #2에서
// get_period_stats 도구로 재구성). 순수 시간 계산인 "주 계산"만 아래 "시간 계산"으로 옮겨왔다.

describe("시각 파싱", () => {
  it.each([
    ["18:05에 나갔어요", undefined, "18:05"],
    ["6시 5분", "18:00", "18:05"],
    ["오후 6시", undefined, "18:00"],
    ["저녁 9시 반쯤 퇴근", undefined, "21:30"],
    ["9시 10분", "21:00", "21:10"],
    ["9시 10분", "09:00", "09:10"],
    ["21시", undefined, "21:00"],
    ["오전 12시", undefined, "00:00"],
    ["기억 안남", "21:00", null],
  ])("%s (예정 %s) → %s", (text, hint, expected) => {
    expect(parseKoreanTime(text, hint)).toBe(expected);
  });
});

describe("근무시간", () => {
  const base: DayRecord = {
    employeeId: "x", date: "2026-09-01", checkIn: null, checkOut: null, corrected: {},
    shift: { id: "s", employeeId: "x", date: "2026-09-01", start: "09:00", end: "18:00" },
  };
  it("휴게 공제", () => {
    expect(breakMinutes(3 * 60 + 59)).toBe(0);
    expect(breakMinutes(4 * 60)).toBe(30);
    expect(breakMinutes(8 * 60)).toBe(60);
  });
  it("스케줄 범위 안에서만 인정", () => {
    expect(workedMinutes({ ...base, checkIn: "08:40", checkOut: "18:30" })).toBe(9 * 60 - 60);
    expect(workedMinutes({ ...base, checkIn: "09:30", checkOut: "18:00" })).toBe(8 * 60 + 30 - 60);
    expect(workedMinutes({ ...base, checkIn: "09:00", checkOut: null })).toBe(0);
  });
});

describe("정산", () => {
  it("주휴·최저임금·누락 확인사항을 계산한다", () => {
    const db = createFixtureDb(new Date("2026-09-23T01:00:00Z"));
    db.employees[0].hourlyWage = 10000;
    const rows = computeSettlement(db, "2026-09", "2026-09-23");
    const minji = rows.find((r) => r.employeeId === "e1")!;
    expect(minji.notes.join()).toContain("최저임금");
    // 김민지: 평일 6시간(휴게 30분 → 5.5h) × 5일 = 27.5h ≥ 15h → 주휴 (27.5/40×8 = 5.5h = 330분)
    expect(minji.holidayMinutes % 330).toBe(0);
    expect(minji.holidayMinutes).toBeGreaterThan(0);
    const junho = rows.find((r) => r.employeeId === "e2")!;
    expect(junho.notes.join()).toContain("퇴근 기록 누락 1일");
    expect(junho.total).toBe(junho.basePay + junho.overtimePay + junho.holidayPay);
  });

  it("결근한 주는 주휴 제외", () => {
    const db = createFixtureDb(new Date("2026-09-23T01:00:00Z"));
    const rows = computeSettlement(db, "2026-09", "2026-09-30");
    const woojin = rows.find((r) => r.employeeId === "e5")!;
    expect(woojin.notes.join()).toContain("결근으로 주휴 제외");
  });
});

describe("시간 계산", () => {
  it("주 계산", () => {
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});
