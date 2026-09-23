import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // 세션이 없거나 설정 전 — 무시하고 로그인으로
  }
  return NextResponse.redirect(`${origin}/login`);
}
