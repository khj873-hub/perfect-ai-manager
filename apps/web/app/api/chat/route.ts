import { type NextRequest } from "next/server";
import { kstParts } from "@perfect-ai-manager/connector-attendance";
import { getProfile, devFallbackProfile } from "@/lib/db/profiles";
import { buildToolContext } from "@/lib/agent/context";
import { agentToolsForRole } from "@/lib/agent/registry";
import { makeLlm, type Msg } from "@/lib/agent/llm";
import { runAgentTurn } from "@/lib/agent/loop";
import { systemPrompt } from "@/lib/agent/systemPrompt";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const profile = (await getProfile()) ?? devFallbackProfile();
  if (!profile) return new Response("unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { message?: unknown; history?: unknown };
  const message = String(body.message ?? "").trim();
  if (!message) return new Response("empty message", { status: 400 });
  const history: Msg[] = Array.isArray(body.history) ? (body.history as Msg[]).slice(-20) : [];

  const ctx = buildToolContext(profile);
  const tools = agentToolsForRole(profile.role);
  const system = systemPrompt(profile.storeIds[0] ?? "매장", ctx.today);
  const llm = makeLlm(ctx.today);

  // 커넥터(근태관리 API)·LLM 장애가 그대로 500 이 되면 화면엔 "오류가 났어요."만 남아
  // 원인을 알 수 없다. 여기서 잡아 사람이 읽을 수 있는 안내로 바꾸고, 원문은 로그에 남긴다.
  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn(message, history, { llm, tools, ctx, system });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[chat] 에이전트 턴 실패:", detail);
    const isAttendance = detail.includes("근태관리 API");
    const msg = isAttendance
      ? "지금 퍼펙트근태관리에서 자료를 못 가져오고 있어요. 잠시 뒤 다시 물어봐 주세요. (관리자: 근태관리 읽기 API 연결을 확인해 주세요)"
      : "지금 답을 만들지 못했어요. 잠시 뒤 다시 물어봐 주세요.";
    return new Response(msg, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // TODO(작업 #8 전): Supabase 설정 시 messages/tool_calls 영속화. 로컬은 생략.

  const asOf = kstParts().time; // "HH:mm"
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const parts = result.text.match(/\S+\s*/g) ?? [result.text];
      for (const p of parts) {
        controller.enqueue(enc.encode(p));
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-as-of": asOf,
      "x-tools": result.toolCalls.map((t) => t.tool).join(","),
      "cache-control": "no-store",
    },
  });
}
