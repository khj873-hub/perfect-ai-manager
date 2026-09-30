"use server";

import { createClient } from "@/lib/supabase/server";

// 매직링크 발송. 무료 Supabase는 이메일 템플릿(6자리 코드) 편집이 불가하여 링크 방식 사용.
// emailRedirectTo 를 /auth/callback 으로 지정해야 링크 클릭 시 세션이 발급된다.
export async function sendMagicLink(_prev: unknown, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "올바른 이메일을 입력하세요." };
  }
  try {
    const supabase = await createClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${site}/auth/callback` },
    });
    if (error) return { ok: false, message: `발송 실패: ${error.message}` };
    return { ok: true, message: "로그인 링크를 이메일로 보냈어요. 같은 기기에서 메일의 링크를 눌러 로그인하세요." };
  } catch (e) {
    return { ok: false, message: `설정 오류: ${(e as Error).message}` };
  }
}
