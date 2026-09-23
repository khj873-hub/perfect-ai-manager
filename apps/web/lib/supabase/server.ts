import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieItem = { name: string; value: string; options?: CookieOptions };

// 에이전트 DB(별도 Supabase)용 서버 클라이언트. anon 키 + 사용자 세션 → RLS 적용.
// Next 15 에서 cookies() 는 async 다.
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 가 필요합니다");
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: CookieItem[]) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // 서버 컴포넌트에서 set 이 막힌 경우 — 세션 갱신은 미들웨어가 처리한다.
        }
      },
    },
  });
}
