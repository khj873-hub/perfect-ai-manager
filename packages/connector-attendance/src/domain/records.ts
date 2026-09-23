import type { Db, Shift } from "./types";
import { toMinutes } from "./time";

// 원본 출퇴근 기록 + 유효한 정정을 합친 "실제 근태"
export interface DayRecord {
  employeeId: string;
  date: string;
  shift?: Shift;
  checkIn: string | null;
  checkOut: string | null;
  inDevice?: string;
  corrected: { in?: boolean; out?: boolean };
}

export function dayRecord(db: Db, employeeId: string, date: string): DayRecord {
  const punches = db.punches
    .filter((p) => p.employeeId === employeeId && p.date === date)
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const firstIn = punches.find((p) => p.type === "in");
  const lastOut = [...punches].reverse().find((p) => p.type === "out");
  const rec: DayRecord = {
    employeeId,
    date,
    shift: db.shifts.find((s) => s.employeeId === employeeId && s.date === date),
    checkIn: firstIn?.time ?? null,
    checkOut: lastOut?.time ?? null,
    inDevice: firstIn?.deviceId,
    corrected: {},
  };
  for (const c of db.corrections) {
    if (c.reverted || c.employeeId !== employeeId || c.date !== date) continue;
    if (c.field === "in") {
      rec.checkIn = c.after;
      rec.corrected.in = true;
    } else {
      rec.checkOut = c.after;
      rec.corrected.out = true;
    }
  }
  return rec;
}

export function recordsForDate(db: Db, date: string): DayRecord[] {
  const ids = new Set<string>();
  db.shifts.filter((s) => s.date === date).forEach((s) => ids.add(s.employeeId));
  db.punches.filter((p) => p.date === date).forEach((p) => ids.add(p.employeeId));
  return [...ids].map((id) => dayRecord(db, id, date));
}

// 휴게시간 공제: 4시간 이상 30분, 8시간 이상 60분 (근로기준법 제54조 최소 기준)
export function breakMinutes(span: number): number {
  if (span >= 8 * 60) return 60;
  if (span >= 4 * 60) return 30;
  return 0;
}

// 인정 근무시간: 스케줄 범위 안에서만 계산한다 (조기 출근·스케줄 외 잔류는 제외).
// 스케줄 밖 초과분은 overstayMinutes로 따로 보여주고 사장님이 판단한다.
export function workedMinutes(rec: DayRecord): number {
  if (!rec.checkIn || !rec.checkOut) return 0;
  let start = toMinutes(rec.checkIn);
  let end = toMinutes(rec.checkOut);
  if (rec.shift) {
    start = Math.max(start, toMinutes(rec.shift.start));
    end = Math.min(end, toMinutes(rec.shift.end));
  }
  const span = end - start;
  if (span <= 0) return 0;
  return span - breakMinutes(span);
}

export function overstayMinutes(rec: DayRecord): number {
  if (!rec.checkOut || !rec.shift) return 0;
  return Math.max(0, toMinutes(rec.checkOut) - toMinutes(rec.shift.end));
}

export function employeeName(db: Db, id: string): string {
  return db.employees.find((e) => e.id === id)?.name ?? id;
}
