"use client";

import { useActionState } from "react";
import { sendMagicLink } from "./actions";

const initial = { ok: false, message: "" };

export default function LoginPage() {
  const [state, action, pending] = useActionState(sendMagicLink, initial);
  return (
    <main>
      <h1>퍼펙트 AI 매니저 로그인</h1>
      <p className="muted">가입된 이메일로 로그인 링크를 보내드립니다.</p>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        <input type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
        <button type="submit" disabled={pending}>
          {pending ? "보내는 중…" : "로그인 링크 받기"}
        </button>
      </form>
      {state.message ? (
        <p className={state.ok ? "" : "muted"} style={{ marginTop: 12 }}>
          {state.message}
        </p>
      ) : null}
    </main>
  );
}
