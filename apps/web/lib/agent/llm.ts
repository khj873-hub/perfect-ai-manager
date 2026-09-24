// LLM 백엔드 추상화. 루프는 이 인터페이스에만 의존한다(실제 Claude / Mock 교체 가능).
// - AnthropicLlm: ANTHROPIC_API_KEY 있을 때 실제 Claude Messages API + tool_use.
// - MockLlm: 키 없이 로컬·테스트용. 추천 질문류의 도구 선택·답변을 결정적으로 재현.
import { addDays, mondayOf, hoursLabel } from "@perfect-ai-manager/connector-attendance";
import type { BoundTool } from "@perfect-ai-manager/connector-attendance";

export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}
export interface LlmTurn {
  text: string;
  toolUses: LlmToolUse[];
  stop: "tool_use" | "end";
}

// 루프 내부 대화 표현 (Anthropic 포맷과 독립)
export type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolUses?: LlmToolUse[] }
  | { role: "tool"; results: { id: string; name: string; result: unknown }[] };

export interface Llm {
  name: string;
  next(system: string, msgs: Msg[], tools: BoundTool[]): Promise<LlmTurn>;
}

// --------------------------------------------------------------------------- #
// Mock LLM — 결정적. 추천 질문 4종(§8) + 기본 분기.
// --------------------------------------------------------------------------- #
export class MockLlm implements Llm {
  name = "mock";
  constructor(private today: string) {}

  async next(_system: string, msgs: Msg[], tools: BoundTool[]): Promise<LlmTurn> {
    // 현재 턴만 본다: 마지막 user 메시지 이후 범위. (멀티턴 채팅에서 이전 질문·도구 결과가 섞이지 않게)
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const question = lastUserIdx >= 0 ? (msgs[lastUserIdx] as Extract<Msg, { role: "user" }>).text : "";
    const turnMsgs = lastUserIdx >= 0 ? msgs.slice(lastUserIdx) : msgs;
    const lastTool = [...turnMsgs].reverse().find((m) => m.role === "tool") as
      | Extract<Msg, { role: "tool" }>
      | undefined;
    const alreadyRan = turnMsgs.some((m) => m.role === "tool");

    if (!alreadyRan) {
      const pick = this.pickTool(question);
      if (!pick || !tools.some((t) => t.name === pick.name)) {
        return { text: this.fallback(), toolUses: [], stop: "end" };
      }
      return { text: "", toolUses: [{ id: "mock_1", name: pick.name, input: pick.input }], stop: "tool_use" };
    }

    // 도구 결과가 있으면 답변 작성
    const r = lastTool?.results[0];
    return { text: this.compose(question, r?.name ?? "", r?.result), toolUses: [], stop: "end" };
  }

  private parsePastDate(q: string): string | null {
    if (/그저께|그제/.test(q)) return addDays(this.today, -2);
    if (/어제/.test(q)) return addDays(this.today, -1);
    const m = q.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) return `${this.today.slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  }

  private pickTool(q: string): { name: string; input: Record<string, unknown> } | null {
    const monthStart = `${this.today.slice(0, 7)}-01`;
    const past = this.parsePastDate(q);
    if (/(이상|특이|문제|사고|대리)/.test(q)) return { name: "detect_issues", input: { date: past ?? addDays(this.today, -1) } };
    if (/(명단|직원|몇\s?명)/.test(q)) return { name: "list_employees", input: {} };
    if (/급여|월급/.test(q)) return { name: "get_payroll_preview", input: { month: this.today.slice(0, 7) } };
    if (/근무\s?시간|몇\s?시간|일한\s?시간/.test(q)) {
      const from = /이번\s?주/.test(q) ? mondayOf(this.today) : monthStart;
      return { name: "get_period_stats", input: { from, to: this.today } };
    }
    if (/지각|조퇴|결근/.test(q)) {
      const from = /이번\s?달|한\s?달/.test(q) ? monthStart : mondayOf(this.today);
      return { name: "get_period_stats", input: { from, to: this.today } };
    }
    // 특정 과거일의 기록, 또는 이름·기록 언급(단 '오늘/지금/아직'이면 오늘 현황으로)
    if (past || (/(출근|퇴근|기록|몇\s?시)/.test(q) && !/오늘|지금|아직/.test(q))) {
      return { name: "get_day_records", input: { date: past ?? this.today } };
    }
    if (/지금|근무\s?중|누가 일|출근한|아직 출근/.test(q)) return { name: "get_today_status", input: {} };
    return null;
  }

  private compose(q: string, tool: string, result: unknown): string {
    const r = result as Record<string, unknown> | undefined;
    if (!r || (r as { ok?: boolean }).ok === false) {
      const err = r as { error?: string; message?: string } | undefined;
      if (err?.error === "schedule_unavailable") return "스케줄이 등록돼 있지 않아 지각·결근을 계산할 수 없어요. 근무표를 먼저 등록해 주세요.";
      if (err?.error === "need_store") return "어느 매장인지 알려주세요.";
      if (err?.error === "ambiguous_employee") return "이름이 여러 명과 일치해요. 전체 이름으로 다시 물어봐 주세요.";
      return err?.message ?? "조회에 실패했어요.";
    }
    if (tool === "get_today_status") {
      const emps = (r.employees as { name: string; status: string }[]) ?? [];
      const working = emps.filter((e) => e.status === "근무중").map((e) => e.name);
      const pending = emps.filter((e) => e.status === "예정").map((e) => e.name);
      const head = working.length ? `지금 근무 중: ${working.join(", ")} (${working.length}명)입니다.` : "지금 근무 중인 직원이 없어요.";
      return pending.length ? `${head} 아직 출근 전: ${pending.join(", ")}.` : head;
    }
    if (tool === "get_day_records") {
      const recs = (r.records as { name: string; check_in: string | null; check_out: string | null }[]) ?? [];
      if (!recs.length) return `${r.date} 근무 기록이 없어요.`;
      return `${r.date} 근무 기록입니다.\n` + recs.map((x) => `- ${x.name} 출근 ${x.check_in ?? "-"} 퇴근 ${x.check_out ?? "-"}`).join("\n");
    }
    if (tool === "detect_issues") {
      const issues = (r.issues as { name: string; detail: string }[]) ?? [];
      if (!issues.length) return "특이사항 없었어요.";
      return `이상 ${issues.length}건입니다.\n` + issues.map((i) => `- ${i.detail}`).join("\n");
    }
    if (tool === "get_period_stats") {
      const stats = (r.stats as { name: string; late_count: number; late_minutes: number; early_leave_count: number; absent_count: number; worked_minutes: number }[]) ?? [];
      if (/근무\s?시간|몇\s?시간|일한\s?시간/.test(q)) {
        const top = stats.filter((s) => s.worked_minutes > 0).sort((a, b) => b.worked_minutes - a.worked_minutes);
        if (!top.length) return "해당 기간 근무 기록이 없어요.";
        return "근무시간: " + top.slice(0, 5).map((s) => `${s.name} ${hoursLabel(s.worked_minutes)}`).join(", ") + "입니다.";
      }
      if (/조퇴/.test(q)) {
        const e = stats.filter((s) => s.early_leave_count > 0).sort((a, b) => b.early_leave_count - a.early_leave_count);
        return e.length ? "조퇴: " + e.map((s) => `${s.name} ${s.early_leave_count}회`).join(", ") + "입니다." : "해당 기간 조퇴한 사람이 없어요.";
      }
      if (/결근/.test(q)) {
        const a = stats.filter((s) => s.absent_count > 0).sort((x, y) => y.absent_count - x.absent_count);
        return a.length ? "결근: " + a.map((s) => `${s.name} ${s.absent_count}회`).join(", ") + "입니다." : "해당 기간 결근한 사람이 없어요.";
      }
      const late = stats.filter((s) => s.late_count > 0).sort((a, b) => b.late_count - a.late_count);
      if (!late.length) return "해당 기간 지각한 사람이 없어요.";
      return "지각: " + late.map((s) => `${s.name} ${s.late_count}회`).join(", ") + "입니다.";
    }
    if (tool === "list_employees") {
      const emps = (r.employees as { name: string }[]) ?? [];
      return `직원 ${emps.length}명: ${emps.map((e) => e.name).join(", ")}입니다.`;
    }
    if (tool === "get_payroll_preview") {
      const rows = (r.rows as { name: string; total: number }[]) ?? [];
      const body = rows.map((x) => `${x.name} ${x.total.toLocaleString("ko-KR")}원`).join(", ");
      return `참고용 급여 계산입니다. ${body}. 확정은 퍼펙트근태관리에서 하세요.`;
    }
    return "결과를 확인했어요.";
  }

  private fallback(): string {
    return "이런 질문에 답할 수 있어요: 지금 누가 근무 중인지, 어제 이상이 있었는지, 이번 주 지각, 이번 달 근무시간.";
  }
}

// --------------------------------------------------------------------------- #
// Anthropic LLM — 실제 Claude. (런타임 검증은 배포/키 필요)
// --------------------------------------------------------------------------- #
export class AnthropicLlm implements Llm {
  name = "anthropic";
  private model: string;
  constructor(model?: string) {
    this.model = model || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  }

  async next(system: string, msgs: Msg[], tools: BoundTool[]): Promise<LlmTurn> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const client = new Anthropic();
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      // zod → JSON schema (Anthropic input_schema). store_id 는 서버가 ctx 로 주입하므로
      // LLM 에 노출하지 않는다(§4: LLM 이 매장 범위를 정하지 않는다 — 환각 방지).
      input_schema: stripStoreId(zodToJsonSchema(t.input as never, { target: "openApi3" }) as Record<string, unknown>),
    }));
    const resp = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      tools: toolDefs as never,
      messages: toAnthropic(msgs) as never,
    });
    let text = "";
    const toolUses: LlmToolUse[] = [];
    for (const block of resp.content as { type: string; text?: string; id?: string; name?: string; input?: unknown }[]) {
      if (block.type === "text") text += block.text ?? "";
      else if (block.type === "tool_use") toolUses.push({ id: block.id!, name: block.name!, input: block.input });
    }
    return { text, toolUses, stop: resp.stop_reason === "tool_use" ? "tool_use" : "end" };
  }
}

function toAnthropic(msgs: Msg[]): unknown[] {
  const out: unknown[] = [];
  for (const m of msgs) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const tu of m.toolUses ?? []) content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.result) })),
      });
    }
  }
  return out;
}

// LLM 도구 스키마에서 store_id 제거 (서버가 ctx 로 정함)
function stripStoreId(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props && "store_id" in props) delete props.store_id;
  if (Array.isArray(schema.required)) schema.required = (schema.required as string[]).filter((r) => r !== "store_id");
  return schema;
}

export function makeLlm(today: string): Llm {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicLlm() : new MockLlm(today);
}
