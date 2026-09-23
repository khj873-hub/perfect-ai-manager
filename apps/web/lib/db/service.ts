import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Briefing } from "@/lib/agent/briefing";

// 서버 전용 service_role 클라이언트 (RLS 우회 — 브리핑·감사로그 쓰기, 온보딩).
// 근태관리 키가 아니라 에이전트 DB 키다(§10). 미설정이면 null.
export function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// 브리핑을 저장하고, 해당 매장 사용자들의 대화에 role='briefing' 메시지로 넣는다(§8).
// Supabase 미설정(로컬)이면 no-op 로 { persisted:false } 반환.
export async function persistBriefing(b: Briefing): Promise<{ persisted: boolean; messages: number }> {
  const sb = createServiceClient();
  if (!sb) return { persisted: false, messages: 0 };

  await sb.from("briefings").upsert(
    { store_id: b.store_id, work_date: b.work_date, body: b.body, issues: b.issues },
    { onConflict: "store_id,work_date" },
  );

  const { data: users } = await sb.from("agent_users").select("id, store_ids");
  let messages = 0;
  for (const u of users ?? []) {
    const storeIds = (u.store_ids as string[]) ?? [];
    if (!storeIds.includes(b.store_id)) continue;

    // 사용자의 최근 대화(없으면 생성)에 브리핑 메시지 추가
    const { data: conv } = await sb
      .from("conversations")
      .select("id")
      .eq("user_id", u.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let conversationId = conv?.id as string | undefined;
    if (!conversationId) {
      const { data: created } = await sb.from("conversations").insert({ user_id: u.id }).select("id").single();
      conversationId = created?.id as string | undefined;
    }
    if (!conversationId) continue;
    await sb.from("messages").insert({ conversation_id: conversationId, role: "briefing", content: b.body });
    messages++;
  }
  return { persisted: true, messages };
}

// 브리핑 대상 매장 목록: store_settings(에이전트 DB)에서, 없으면 로컬 기본 store_demo.
export async function briefingStores(): Promise<string[]> {
  const sb = createServiceClient();
  if (!sb) return ["store_demo"];
  const { data } = await sb.from("store_settings").select("store_id");
  const ids = (data ?? []).map((r) => String(r.store_id));
  return ids.length ? ids : ["store_demo"];
}
