// 직원 답변에서 시각을 뽑는다. "18:05", "6시 5분", "오후 6시", "저녁 9시 반", "21시"
// 반환: "HH:mm" 또는 null. hint(예정 시각)가 있으면 12시간제 모호성을 그쪽에 가깝게 푼다.

import { fromMinutes, toMinutes } from "./time";

export function parseKoreanTime(text: string, hint?: string): string | null {
  const t = text.replace(/\s+/g, " ");

  let h: number | null = null;
  let m = 0;
  let meridiem: "am" | "pm" | null = null;

  const colon = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  const korean = t.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (korean) {
    h = Number(korean[1]);
    if (korean[2]) m = Number(korean[2]);
    else if (korean[3]) m = 30;
  }
  if (h === null || h > 24 || m > 59) return null;

  if (/(오후|저녁|밤)/.test(t)) meridiem = "pm";
  else if (/(오전|아침|새벽)/.test(t)) meridiem = "am";

  if (meridiem === "pm" && h < 12) h += 12;
  else if (meridiem === "am" && h === 12) h = 0;
  else if (!meridiem && h <= 12 && hint) {
    // 모호한 12시간제: 예정 시각에 더 가까운 쪽 선택
    const a = h * 60 + m;
    const b = (h + 12) * 60 + m;
    const target = toMinutes(hint);
    if (h < 12 && Math.abs(b - target) < Math.abs(a - target)) h += 12;
  }
  if (h === 24) h = 0;
  return fromMinutes(h * 60 + m);
}
