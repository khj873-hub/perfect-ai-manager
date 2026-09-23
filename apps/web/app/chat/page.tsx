"use client";

import { useRef, useState } from "react";

type ChatMsg = { role: "user" | "assistant"; text: string; asOf?: string };
const CHIPS = ["지금 누가 근무 중?", "어제 이상 있었어?", "이번 주 지각", "이번 달 근무시간"];

export default function ChatPage() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const asOf = res.headers.get("x-as-of") ?? undefined;
      if (!res.ok || !res.body) {
        setMsgs((m) => patchLast(m, res.status === 401 ? "로그인이 필요해요." : "오류가 났어요.", asOf));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => patchLast(m, acc, asOf));
      }
    } catch {
      setMsgs((m) => patchLast(m, "네트워크 오류예요.", undefined));
    } finally {
      setBusy(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <main>
      <h1>AI 매니저</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
        {msgs.length === 0 ? <p className="muted">근태에 대해 무엇이든 물어보세요.</p> : null}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div
              className="card"
              style={{ margin: 0, background: m.role === "user" ? "#eef2ff" : "#fff" }}
            >
              {m.text || (busy && i === msgs.length - 1 ? "…" : "")}
            </div>
            {m.role === "assistant" && m.text ? (
              <div className="muted" style={{ marginTop: 2 }}>
                퍼펙트근태관리 기준{m.asOf ? ` · ${m.asOf} 조회` : ""}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => send(c)}
            disabled={busy}
            style={{ background: "#f3f4f6", color: "#111", fontSize: 13, padding: "6px 10px" }}
          >
            {c}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="질문을 입력하세요" />
        <button type="submit" disabled={busy}>
          보내기
        </button>
      </form>
    </main>
  );
}

function patchLast(msgs: ChatMsg[], text: string, asOf?: string): ChatMsg[] {
  const copy = [...msgs];
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === "assistant") {
      copy[i] = { ...copy[i], text, asOf: asOf ?? copy[i].asOf };
      break;
    }
  }
  return copy;
}
