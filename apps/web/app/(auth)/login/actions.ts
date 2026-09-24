"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 6자리 코드 발송. 링크(prefetch에 소모됨) 대신 코드 입력 방식으로 기기·브라우저·Gmail 무관 로그인.
export async function sendCode(email: string): Promise<{ ok: boolean; message: string }> {
  const e = email.trim();
  if (!EMAIL_RE.test(e)) return { ok: false, message: "올바른 이메일을 입력하세요." };
  try {
    const supabase = await createClient();
    // emailRedirectTo 를 주지 않으면 링크 대신 OTP 코드 위주로 발송된다(템플릿의 {{ .Token }}).
    const { error } = await supabase.auth.signInWithOtp({ email: e });
    if (error) return { ok: false, message: `발송 실패: ${error.message}` };
    return { ok: true, message: "이메일로 6자리 코드를 보냈습니다. 코드를 입력하세요." };
  } catch (err) {
    return { ok: false, message: `설정 오류: ${(err as Error).message}` };
  }
}

// 6자리 코드 검증 → 세션 발급 → 홈으로. (성공 시 redirect 로 이 함수는 반환하지 않음)
export async function verifyCode(email: string, code: string): Promise<{ ok: false; message: string } | void> {
  const e = email.trim();
  const token = code.trim();
  if (!/^\d{6}$/.test(token)) return { ok: false, message: "6자리 숫자 코드를 입력하세요." };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: e, token, type: "email" });
  if (error) return { ok: false, message: `코드가 올바르지 않거나 만료됐어요. 다시 받아주세요.` };
  redirect("/");
}
