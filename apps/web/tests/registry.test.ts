import { describe, expect, it } from "vitest";
import { createFixtureSource } from "@perfect-ai-manager/connector-attendance";
import { agentToolsForRole, toolSummaries } from "@/lib/agent/registry";

// 완료 기준(§12 작업 #5): owner/manager 계정으로 도구 목록이 다르게 나온다.
const src = createFixtureSource({ now: new Date("2026-09-23T01:00:00Z") });

describe("역할별 도구 레지스트리", () => {
  it("owner 는 급여 조회 포함 6종", () => {
    const names = agentToolsForRole("owner", src).map((t) => t.name);
    expect(names).toHaveLength(6);
    expect(names).toContain("get_payroll_preview");
  });

  it("manager 는 급여 조회 제외 5종", () => {
    const names = agentToolsForRole("manager", src).map((t) => t.name);
    expect(names).toHaveLength(5);
    expect(names).not.toContain("get_payroll_preview");
  });

  it("owner 와 manager 의 도구 목록이 다르다", () => {
    const owner = agentToolsForRole("owner", src).map((t) => t.name).sort();
    const manager = agentToolsForRole("manager", src).map((t) => t.name).sort();
    expect(owner).not.toEqual(manager);
    const ownerOnly = owner.filter((n) => !manager.includes(n));
    expect(ownerOnly).toEqual(["get_payroll_preview"]);
  });

  it("toolSummaries 는 name·description 을 준다", () => {
    const s = toolSummaries("manager", src);
    expect(s.length).toBe(5);
    expect(s[0]).toHaveProperty("description");
  });
});
