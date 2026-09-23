"use server";

import { createClient } from "@/lib/supabase/server";

// 매직링크(OTP) 발송. 에이전트 DB Supabase Auth 사용(§5).
export async function sendMagicLink(_prev: unknown, formData: FormData): Promise<{ message: string; ok: boolean }> {
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
    return { ok: true, message: "로그인 링크를 이메일로 보냈습니다. 메일함을 확인하세요." };
  } catch (e) {
    return { ok: false, message: `설정 오류: ${(e as Error).message}` };
  }
}
