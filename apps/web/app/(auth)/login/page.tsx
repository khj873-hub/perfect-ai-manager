"use client";

import { useState } from "react";
import { sendCode, verifyCode } from "./actions";

export default function LoginPage() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    const r = await sendCode(email);
    setBusy(false);
    setOk(r.ok);
    setMsg(r.message);
    if (r.ok) setStep("code");
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    const r = await verifyCode(email, code); // 성공 시 서버가 홈으로 redirect
    setBusy(false);
    if (r && !r.ok) {
      setOk(false);
      setMsg(r.message);
    }
  }

  return (
    <main>
      <h1>퍼펙트 AI 매니저 로그인</h1>

      {step === "email" ? (
        <>
          <p className="muted">가입된 이메일로 6자리 로그인 코드를 보내드립니다.</p>
          <form onSubmit={onSend} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? "보내는 중…" : "코드 받기"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="muted">
            <b>{email}</b> 으로 보낸 <b>6자리 코드</b>를 입력하세요. (이메일 앱에서 코드를 확인하세요)
          </p>
          <form onSubmit={onVerify} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              style={{ letterSpacing: "0.3em", fontSize: 20, textAlign: "center" }}
              required
              autoFocus
            />
            <button type="submit" disabled={busy}>
              {busy ? "확인 중…" : "로그인"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setMsg("");
              }}
              style={{ background: "#f3f4f6", color: "#111" }}
            >
              이메일 다시 입력 / 코드 재발송
            </button>
          </form>
        </>
      )}

      {msg ? (
        <p className={ok ? "" : "muted"} style={{ marginTop: 12 }}>
          {msg}
        </p>
      ) : null}
    </main>
  );
}
