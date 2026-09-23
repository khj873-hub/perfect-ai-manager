import { describe, expect, it } from "vitest";
import { createAttendanceConnector } from "@/index";
import { createFixtureSource, createFixtureDb } from "@/adapter/FixtureSource";
import type { AttendanceSource } from "@/adapter/AttendanceSource";
import type { BoundTool } from "@/tools";
import type { ToolContext, ToolResult } from "@/tools/context";
import type { TodayRow } from "@/tools/getTodayStatus";
import type { DayRow } from "@/tools/getDayRecords";
import type { PeriodRow } from "@/tools/getPeriodStats";
import type { IssueRow } from "@/tools/detectIssues";
import type { PayrollRow } from "@/tools/getPayrollPreview";
import type { EmployeeRow } from "@/tools/listEmployees";

// 2026-09-23 10:00 KST (어제 = 2026-09-22). 고정 시각 → 결정적.
const NOW = new Date("2026-09-23T01:00:00Z");
const TODAY = "2026-09-23";
const Y = "2026-09-22";
const STORE = "store_demo";

const source = createFixtureSource({ storeId: STORE, now: NOW });
const conn = createAttendanceConnector(source);
const tool = (name: string): BoundTool => conn.tools.find((t) => t.name === name)!;

const owner: ToolContext = { userId: "u1", role: "owner", storeIds: [STORE], today: TODAY };
const manager: ToolContext = { userId: "u2", role: "manager", storeIds: [STORE], today: TODAY };

function stub(db: ReturnType<typeof createFixtureDb>): AttendanceSource {
  return { now: () => NOW, storeIds: () => [STORE], load: () => db };
}
// 레지스트리 execute 는 도구별 페이로드가 달라 ToolResult<unknown> 을 돌려준다.
// 테스트에서 해당 도구의 결과 타입으로 캐스팅해 필드를 검증한다.
async function call<T>(name: string, ctx: ToolContext, input: unknown, c = conn): Promise<ToolResult<T>> {
  const t = c.tools.find((x) => x.name === name)!;
  return (await t.execute(ctx, input)) as ToolResult<T>;
}

describe("메타·매장 게이트", () => {
  it("성공 출력에 as_of·source 가 붙는다", async () => {
    const r = await tool("get_today_status").execute(owner, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("퍼펙트근태관리");
    expect(r.as_of).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r.as_of).toBe("2026-09-23 10:00"); // source.now() 고정 → 결정적
  });

  it("매장이 여러 개인데 지정 안 하면 need_store", async () => {
    const ctx: ToolContext = { ...owner, storeIds: ["a", "b"] };
    const r = await tool("get_today_status").execute(ctx, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("need_store");
    expect(r.store_ids).toEqual(["a", "b"]);
  });

  it("권한 밖 매장은 forbidden", async () => {
    const r = await tool("get_today_status").execute(owner, { store_id: "other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("forbidden");
  });
});

describe("get_today_status", () => {
  it("오늘 근무 현황 — 오전 출근자는 근무중, 나머지는 예정", async () => {
    const r = await call<{ employees: TodayRow[] }>("get_today_status", owner, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.employees).toHaveLength(5);
    const minji = r.employees.find((e) => e.name === "김민지")!;
    expect(minji.status).toBe("근무중");
    expect(minji.check_in).toBe("08:56");
    expect(r.employees.find((e) => e.name === "박준호")!.status).toBe("예정");
  });
});

describe("get_day_records", () => {
  it("이름 부분일치로 한 명만 조회, PII 없음", async () => {
    const r = await call<{ records: DayRow[] }>("get_day_records", owner, { date: Y, employee_name: "민지" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records).toHaveLength(1);
    const row = r.records[0];
    expect(row.name).toBe("김민지");
    expect(row.check_in).toBe("09:17");
    expect("phone" in row).toBe(false);
    expect("pin" in row).toBe(false);
  });

  it("없는 이름은 not_found", async () => {
    const r = await tool("get_day_records").execute(owner, { date: Y, employee_name: "홍길동" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_found");
  });

  it("날짜 형식이 틀리면 bad_input", async () => {
    const r = await tool("get_day_records").execute(owner, { date: "9/22" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("bad_input");
  });

  it("이름이 여러 명과 일치하면 ambiguous_employee", async () => {
    const db = createFixtureDb(NOW);
    db.employees.push({ id: "e9", name: "김민수", phone: "010-0000-0009", pin: "9999", hourlyWage: 10320, active: true });
    const c = createAttendanceConnector(stub(db));
    const r = await c.tools.find((t) => t.name === "get_day_records")!.execute(owner, { date: Y, employee_name: "민" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("ambiguous_employee");
    expect(r.candidates?.map((x) => x.name).sort()).toEqual(["김민수", "김민지"]);
  });
});

describe("get_period_stats", () => {
  it("기간 지각 집계 (민지 9/1~9/22 = 3회)", async () => {
    const r = await call<{ stats: PeriodRow[] }>("get_period_stats", owner, { from: "2026-09-01", to: Y, employee_name: "민지" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats).toHaveLength(1);
    expect(r.stats[0].late_count).toBe(3);
    expect(r.stats[0].worked_minutes).toBeGreaterThan(0);
  });

  it("93일 초과는 bad_input", async () => {
    const r = await tool("get_period_stats").execute(owner, { from: "2026-01-01", to: "2026-12-31" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("bad_input");
  });

  it("스케줄이 없으면 schedule_unavailable", async () => {
    const db = { ...createFixtureDb(NOW), shifts: [] };
    const c = createAttendanceConnector(stub(db));
    const r = await c.tools.find((t) => t.name === "get_period_stats")!.execute(owner, { from: "2026-09-01", to: Y });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("schedule_unavailable");
  });
});

describe("detect_issues", () => {
  it("어제 이상 건 5종을 찾는다", async () => {
    const r = await call<{ issues: IssueRow[] }>("detect_issues", owner, { date: Y });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toHaveLength(5);
    expect(r.issues.map((i) => i.kind).sort()).toEqual(
      ["absent", "early_leave", "late", "missing_checkout", "proxy_suspect"],
    );
  });
});

describe("get_payroll_preview (owner 전용)", () => {
  it("owner 는 월 급여 참고 계산을 받는다", async () => {
    const r = await call<{ rows: PayrollRow[]; disclaimer: string }>("get_payroll_preview", owner, {
      month: "2026-09",
      employee_name: "민지",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].total).toBe(r.rows[0].base_pay + r.rows[0].overtime_pay + r.rows[0].holiday_pay);
    expect(r.disclaimer).toContain("참고용");
  });

  it("manager 는 forbidden, 그리고 목록에서 빠진다", async () => {
    const r = await tool("get_payroll_preview").execute(manager, { month: "2026-09" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("forbidden");
    expect(conn.toolsFor("manager").some((t) => t.name === "get_payroll_preview")).toBe(false);
    expect(conn.toolsFor("owner").some((t) => t.name === "get_payroll_preview")).toBe(true);
    expect(conn.toolsFor("manager")).toHaveLength(5);
    expect(conn.toolsFor("owner")).toHaveLength(6);
  });
});

describe("list_employees (필드 제한)", () => {
  it("owner 는 시급을 보고, manager 는 못 본다. PII 없음", async () => {
    const ro = await call<{ employees: EmployeeRow[] }>("list_employees", owner, {});
    const rm = await call<{ employees: EmployeeRow[] }>("list_employees", manager, {});
    expect(ro.ok && rm.ok).toBe(true);
    if (!ro.ok || !rm.ok) return;
    expect(ro.employees[0].hourly_wage).toBeGreaterThan(0);
    expect("hourly_wage" in rm.employees[0]).toBe(false);
    expect("phone" in ro.employees[0]).toBe(false);
    expect("pin" in ro.employees[0]).toBe(false);
  });
});
