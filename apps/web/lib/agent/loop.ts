import type { BoundTool, ToolContext } from "@perfect-ai-manager/connector-attendance";
import type { Llm, Msg } from "./llm";
import { unverifiedNumbers } from "./guard";

const MAX_ITERS = 6; // HANDOFF §7-3

export interface ToolCallLog {
  tool: string;
  input: unknown;
  ok: boolean;
  error?: string;
  duration_ms: number;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCallLog[];
  unverified: string[]; // 도구 결과에 없는 숫자 (측정만, 차단 안 함)
  messages: Msg[]; // 갱신된 히스토리 (assistant/tool 포함)
}

export interface LoopDeps {
  llm: Llm;
  tools: BoundTool[];
  ctx: ToolContext;
  system: string;
}

export async function runAgentTurn(userText: string, history: Msg[], deps: LoopDeps): Promise<AgentTurnResult> {
  const { llm, tools, ctx, system } = deps;
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const msgs: Msg[] = [...history, { role: "user", text: userText }];
  const toolCalls: ToolCallLog[] = [];
  let lastResults: unknown[] = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const turn = await llm.next(system, msgs, tools);

    if (turn.stop === "end" || turn.toolUses.length === 0) {
      const unverified = unverifiedNumbers(turn.text, lastResults);
      msgs.push({ role: "assistant", text: turn.text });
      return { text: turn.text, toolCalls, unverified, messages: msgs };
    }

    // tool_use 턴
    msgs.push({ role: "assistant", text: turn.text, toolUses: turn.toolUses });
    const results: { id: string; name: string; result: unknown }[] = [];
    for (const tu of turn.toolUses) {
      const tool = toolMap.get(tu.name);
      const started = Date.now();
      if (!tool) {
        const result = { ok: false, error: "unknown_tool", message: `없는 도구: ${tu.name}` };
        results.push({ id: tu.id, name: tu.name, result });
        toolCalls.push({ tool: tu.name, input: tu.input, ok: false, error: "unknown_tool", duration_ms: 0 });
        continue;
      }
      const result = await tool.execute(ctx, tu.input);
      const duration_ms = Date.now() - started;
      const ok = (result as { ok?: boolean }).ok === true;
      results.push({ id: tu.id, name: tu.name, result });
      toolCalls.push({ tool: tu.name, input: tu.input, ok, error: ok ? undefined : (result as { error?: string }).error, duration_ms });
    }
    lastResults = results.map((r) => r.result);
    msgs.push({ role: "tool", results });
  }

  // 6회 초과
  const text = "질문이 조금 복잡해요. 한 번에 하나씩 나눠서 물어봐 주세요.";
  msgs.push({ role: "assistant", text });
  return { text, toolCalls, unverified: [], messages: msgs };
}
