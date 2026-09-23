// KST 기준 시각 유틸. 서버 TZ와 무관하게 동작하도록 UTC+9를 직접 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function kstParts(d: Date = new Date()) {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const date = `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
  const time = `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
  return { date, time, stamp: `${date} ${time}` };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// 0=일요일 … 6=토요일
export function weekday(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function mondayOf(date: string): string {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function daysInMonth(month: string): string[] {
  const [y, mo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`);
}

// "YYYY-MM-DD HH:mm" 두 개 사이의 분 차이 (b - a)
export function minutesBetween(a: string, b: string): number {
  const toAbs = (s: string) => {
    const [d, t] = s.split(" ");
    const [y, mo, day] = d.split("-").map(Number);
    return Date.UTC(y, mo - 1, day) / 60000 + toMinutes(t);
  };
  return toAbs(b) - toAbs(a);
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function labelDate(date: string): string {
  const [, mo, d] = date.split("-").map(Number);
  return `${mo}/${d}(${WD[weekday(date)]})`;
}

export function hoursLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
