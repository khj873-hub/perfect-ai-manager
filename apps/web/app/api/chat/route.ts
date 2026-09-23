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

  const result = await runAgentTurn(message, history, { llm, tools, ctx, system });
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
