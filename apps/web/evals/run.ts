// 골든셋 평가 (HANDOFF §8). FixtureSource(고정 시각)로 에이전트 루프를 돌려
// 도구 선택 정확도 / 기대 숫자·문자 포함율 / manager 급여 노출 건수를 측정한다.
//   실행: npm run eval -w @perfect-ai-manager/web
//   LLM: ANTHROPIC_API_KEY 있으면 실제 Claude, 없으면 MockLlm(결정적).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAttendanceConnector,
  createFixtureSource,
  type Role,
  type ToolContext,
} from "@perfect-ai-manager/connector-attendance";
import { makeLlm } from "../lib/agent/llm";
import { runAgentTurn } from "../lib/agent/loop";
import { systemPrompt } from "../lib/agent/systemPrompt";

interface GoldenItem {
  q: string;
  role: Role;
  expect_tools: string[] | null; // null = 도구 선택 평가 제외(누출 검사 전용 문항)
  expect_in_answer?: string[];
  expect_not_in_answer?: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden: GoldenItem[] = JSON.parse(fs.readFileSync(path.join(__dirname, "golden.json"), "utf8"));

const NOW = new Date("2026-09-23T01:00:00Z");
const TODAY = "2026-09-23";
const STORE = "store_demo";
const source = createFixtureSource({ storeId: STORE, now: NOW });
const conn = createAttendanceConnector(source);

function toolsMatch(expected: string[], called: string[]): boolean {
  if (expected.length === 0) return called.length === 0;
  return expected.every((t) => called.includes(t));
}

// 누출 판정. 금지어가 "원"이면 실제 금액(숫자+원)만 누출로 본다("직원" 같은 단어의 오탐 방지).
function leaked(token: string, text: string): boolean {
  if (token === "원") return /\d[\d,]*\s*원/.test(text);
  return text.includes(token);
}

async function main() {
  const llmName = process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";
  console.log(`[eval] 문항 ${golden.length}개 · LLM=${llmName} · today=${TODAY}\n`);

  let toolOk = 0;
  let toolDenom = 0;
  let inclDenom = 0;
  let inclOk = 0;
  let leaks = 0;
  const fails: string[] = [];

  for (const g of golden) {
    const ctx: ToolContext = { userId: "eval", role: g.role, storeIds: [STORE], today: TODAY };
    const tools = conn.toolsFor(g.role);
    const llm = makeLlm(TODAY);
    const res = await runAgentTurn(g.q, [], { llm, tools, ctx, system: systemPrompt("퍼펙트카페 판교점", TODAY) });
    const called = res.toolCalls.map((t) => t.tool);

    let tMatch = true;
    if (Array.isArray(g.expect_tools)) {
      toolDenom++;
      tMatch = toolsMatch(g.expect_tools, called);
      if (tMatch) toolOk++;
    }

    let iMatch = true;
    if (g.expect_in_answer && g.expect_in_answer.length) {
      inclDenom++;
      iMatch = g.expect_in_answer.every((s) => res.text.includes(s));
      if (iMatch) inclOk++;
    }

    let leak = false;
    if (g.expect_not_in_answer) {
      leak = g.expect_not_in_answer.some((s) => leaked(s, res.text));
      if (leak) leaks++;
    }

    const mark = tMatch && iMatch && !leak ? "✓" : "✗";
    if (mark === "✗") {
      fails.push(
        `  ✗ [${g.role}] ${g.q}\n     기대도구=${JSON.stringify(g.expect_tools)} 실제=${JSON.stringify(called)}` +
          (g.expect_in_answer ? ` | 기대문구=${JSON.stringify(g.expect_in_answer)} 포함=${iMatch}` : "") +
          (leak ? ` | 급여노출!` : "") +
          `\n     답변: ${res.text.replace(/\n/g, " ").slice(0, 120)}`,
      );
    }
    process.stdout.write(mark);
  }

  const toolAcc = toolDenom ? toolOk / toolDenom : 1;
  const inclRate = inclDenom ? inclOk / inclDenom : 1;
  console.log("\n");
  if (fails.length) console.log("실패 상세:\n" + fails.join("\n") + "\n");

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log("── 결과 ──");
  console.log(`도구 선택 정확도 : ${pct(toolAcc)} (${toolOk}/${toolDenom})   목표 ≥ 90%`);
  console.log(`기대 문구 포함율 : ${pct(inclRate)} (${inclOk}/${inclDenom})   목표 ≥ 95%`);
  console.log(`manager 급여 노출: ${leaks}건   목표 0건`);

  const passed = toolAcc >= 0.9 && inclRate >= 0.95 && leaks === 0;
  console.log(`\n${passed ? "PASS ✅" : "FAIL ❌"} (${llmName})`);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
