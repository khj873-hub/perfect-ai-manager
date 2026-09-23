import { createClient } from "@/lib/supabase/server";
import type { AgentProfile } from "@/lib/agent/context";
import type { Role } from "@perfect-ai-manager/connector-attendance";

// agent_users 에서 로그인 사용자의 프로필(역할·매장)을 읽는다. RLS 로 본인 행만 조회된다.
// 없으면 null (인증은 됐지만 아직 에이전트 사용자로 등록 안 된 상태 — 대표가 수동 등록, §5).
export async function getProfile(): Promise<AgentProfile | null> {
  try {
    const supabase = await createClient(); // Supabase 미설정 시 throw → null
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("agent_users")
      .select("display_name, role, store_ids")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !data) return null;

    return {
      userId: user.id,
      displayName: data.display_name as string,
      role: data.role as Role,
      storeIds: (data.store_ids as string[]) ?? [],
    };
  } catch {
    return null;
  }
}

// 로컬 개발용(Supabase 미설정): owner 프로필로 채팅을 바로 체험. 운영에선 사용되지 않는다.
export function devFallbackProfile(): AgentProfile | null {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return null; // 설정돼 있으면 실제 인증만
  return { userId: "dev", displayName: "로컬 사장", role: "owner", storeIds: ["store_demo"] };
}
