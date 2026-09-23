// 숫자 가드 (HANDOFF §7-5): 답변에 나온 숫자가 이번 턴 도구 결과에 없으면 unverified 로 표시.
// 베타 동안 차단하지 않고 측정만 한다.

function numbersIn(text: string): string[] {
  // 3자리 콤마(1,000)를 하나로 묶어 추출
  return (text.match(/\d[\d,]*/g) ?? []).map((s) => s.replace(/,/g, ""));
}

export function unverifiedNumbers(answer: string, toolResults: unknown[]): string[] {
  const haystack = JSON.stringify(toolResults ?? []).replace(/,/g, "");
  const out: string[] = [];
  for (const n of numbersIn(answer)) {
    if (n.length === 0) continue;
    if (!haystack.includes(n)) out.push(n);
  }
  return out;
}
