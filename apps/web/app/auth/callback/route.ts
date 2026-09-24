import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// 매직링크 콜백 → 세션 발급 후 홈으로.
// token_hash(verifyOtp) 를 우선 지원한다: 요청한 브라우저가 아니어도 성공하므로
// PC에서 요청 → 모바일에서 열기, 메일앱 인앱브라우저 등 기기·브라우저가 달라도 로그인된다.
// code(PKCE) 는 하위호환 폴백(요청한 브라우저에서만 성공).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}/`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
