import { type NextRequest } from "next/server";
import { kstParts } from "@perfect-ai-manager/connector-attendance";
import { attendanceSource } from "@/lib/agent/registry";
import { buildBriefing } from "@/lib/agent/briefing";
import { persistBriefing, briefingStores } from "@/lib/db/service";

export const dynamic = "force-dynamic";

// Vercel Cron: 매일 KST 08:00 (= UTC 23:00, vercel.json). CRON_SECRET 로 보호(§8).
// Vercel 은 CRON_SECRET 설정 시 Authorization: Bearer <CRON_SECRET> 를 붙여 호출한다.
async function handle(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const source = attendanceSource(); // 로컬 fixture (작업 #4에서 postgres)
  const today = kstParts(source.now()).date;
  const stores = await briefingStores();

  const generated = [];
  for (const store of stores) {
    const b = await buildBriefing(store, source, today);
    const p = await persistBriefing(b); // Supabase 미설정이면 no-op
    generated.push({ store_id: b.store_id, work_date: b.work_date, issues: b.issues.length, persisted: p.persisted, messages: p.messages, body: b.body });
  }

  return Response.json({ ok: true, count: generated.length, generated });
}

// Vercel Cron 은 GET 으로 호출. 수동 트리거도 GET/POST 모두 허용.
export const GET = handle;
export const POST = handle;
