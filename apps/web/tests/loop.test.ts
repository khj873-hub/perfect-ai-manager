import { describe, expect, it } from "vitest";
import { createAttendanceConnector, createFixtureSource, type Role, type ToolContext } from "@perfect-ai-manager/connector-attendance";
import { MockLlm } from "@/lib/agent/llm";
import { runAgentTurn } from "@/lib/agent/loop";
import { unverifiedNumbers } from "@/lib/agent/guard";

// 완료 기준(§12 작업 #6): 로컬에서 추천 질문 4개 정상 답변.
// 키 없이 MockLlm + FixtureSource 로 루프 end-to-end(도구 선택→실행→답변) 검증.
const NOW = new Date("2026-09-23T01:00:00Z");
const TODAY = "2026-09-23";
const source = createFixtureSource({ storeId: "store_demo", now: NOW });
const conn = createAttendanceConnector(source);

function deps(role: Role = "owner") {
  const ctx: ToolContext = { userId: "u", role, storeIds: ["store_demo"], today: TODAY };
  return { llm: new MockLlm(TODAY), tools: conn.toolsFor(role), ctx, system: "test" };
}

describe("추천 질문 4개 (§8 chips)", () => {
  it("① 지금 누가 근무 중? → get_today_status, 근무자 이름", async () => {
    const r = await runAgentTurn("지금 누가 근무 중이야?", [], deps());
    expect(r.toolCalls[0].tool).toBe("get_today_status");
    expect(r.toolCalls[0].ok).toBe(true);
    expect(r.text).toContain("김민지");
  });

  it("② 어제 이상 있었어? → detect_issues, 5건", async () => {
    const r = await runAgentTurn("어제 이상 있었어?", [], deps());
    expect(r.toolCalls[0].tool).toBe("detect_issues");
    expect(r.text).toContain("5");
  });

  it("③ 이번 주 지각 → get_period_stats, 지각자", async () => {
    const r = await runAgentTurn("이번 주 지각 누구야?", [], deps());
    expect(r.toolCalls[0].tool).toBe("get_period_stats");
    expect(r.text).toContain("지각");
    expect(r.text).toContain("김민지");
  });

  it("④ 이번 달 근무시간 → get_period_stats, 시간", async () => {
    const r = await runAgentTurn("이번 달 근무시간 알려줘", [], deps());
    expect(r.toolCalls[0].tool).toBe("get_period_stats");
    expect(r.text).toContain("시간");
  });
});

describe("가드·권한", () => {
  it("manager 가 급여를 물으면 급여 도구가 없어 금액을 노출하지 않는다", async () => {
    const r = await runAgentTurn("이번 달 급여 얼마야?", [], deps("manager"));
    expect(r.toolCalls).toHaveLength(0); // 급여 도구가 목록에 없음
    expect(r.text).not.toContain("원");
  });

  it("숫자 가드: 도구 결과에 없는 숫자를 unverified 로 잡는다", () => {
    expect(unverifiedNumbers("총 999건입니다", [{ issues: [] }])).toEqual(["999"]);
    expect(unverifiedNumbers("5건입니다", [{ count: 5 }])).toEqual([]);
  });

  it("모르는 질문은 안내로 답한다(도구 호출 없음)", async () => {
    const r = await runAgentTurn("오늘 날씨 어때?", [], deps());
    expect(r.toolCalls).toHaveLength(0);
    expect(r.text).toContain("답할 수 있어요");
  });
});
