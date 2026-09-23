import { redirect } from "next/navigation";
import { getProfile } from "@/lib/db/profiles";
import { toolSummaries } from "@/lib/agent/registry";

// 홈: 로그인한 계정의 역할에 따라 '쓸 수 있는 도구 목록'을 보여준다.
// (채팅 UI 는 작업 #6. 이 화면은 역할별 도구 차이를 확인하는 최소 화면이다 — §12 작업 #5 완료 기준.)
export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) {
    // 인증은 됐으나 agent_users 미등록이거나 세션 없음 → 안내
    return (
      <main>
        <h1>퍼펙트 AI 매니저</h1>
        <p className="muted">
          로그인은 되었지만 아직 사용 권한이 없습니다. 대표에게 계정 등록을 요청하세요.
        </p>
        <p>
          <a href="/auth/signout">로그아웃</a>
        </p>
      </main>
    );
  }

  const tools = toolSummaries(profile.role);
  return (
    <main>
      <h1>퍼펙트 AI 매니저</h1>
      <p className="muted">
        {profile.displayName} 님 · 역할 <span className="tag">{profile.role}</span> · 매장 {profile.storeIds.join(", ") || "-"}
      </p>
      <p>
        <a href="/chat">→ 채팅으로 물어보기</a>
      </p>
      <h2 style={{ fontSize: 16 }}>이 계정이 쓸 수 있는 도구 ({tools.length})</h2>
      {tools.map((t) => (
        <div key={t.name} className="card">
          <div style={{ fontWeight: 600 }}>{t.name}</div>
          <div className="muted">{t.description}</div>
        </div>
      ))}
      <p className="muted">
        {profile.role === "manager"
          ? "관리자에게는 급여 조회(get_payroll_preview)가 노출되지 않습니다."
          : "사장님에게는 급여 조회를 포함한 전체 도구가 노출됩니다."}
      </p>
      <p>
        <a href="/auth/signout">로그아웃</a>
      </p>
    </main>
  );
}
