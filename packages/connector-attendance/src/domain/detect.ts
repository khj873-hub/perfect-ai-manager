import type { Db, IssueKind } from "./types";
import { addDays, minutesBetween, toMinutes } from "./time";
import { dayRecord, employeeName, recordsForDate } from "./records";

// 감지 규칙 — 순수 함수. LLM 없이 결정적으로 동작한다.
export interface Finding {
  employeeId: string;
  date: string;
  kind: IssueKind;
  minutes?: number;
  detail: string;
}

const CHECKOUT_WAIT_MIN = 60; // 스케줄 종료 후 이 시간이 지나도 퇴근 기록이 없으면 누락으로 본다
const PROXY_WINDOW_MIN = 5; // 같은 기기로 다른 직원이 이 시간 안에 찍으면 대리 출퇴근 의심

export function detect(db: Db, date: string, nowStamp: string): Finding[] {
  const grace = db.store.graceMinutes;
  const out: Finding[] = [];

  for (const rec of recordsForDate(db, date)) {
    const s = rec.shift;
    if (!s) continue; // 스케줄 없는 날 기록은 MVP 범위 밖
    const name = employeeName(db, rec.employeeId);
    const startedFor = minutesBetween(`${date} ${s.start}`, nowStamp);
    const endedFor = minutesBetween(`${date} ${s.end}`, nowStamp);
    if (startedFor < 0) continue; // 아직 근무 시작 전

    if (!rec.checkIn && !rec.checkOut) {
      if (startedFor > 30) {
        out.push({
          employeeId: rec.employeeId, date, kind: "absent",
          detail: `${name}님 ${s.start}~${s.end} 근무인데 출퇴근 기록이 없습니다`,
        });
      }
      continue;
    }
    if (!rec.checkIn && rec.checkOut) {
      out.push({
        employeeId: rec.employeeId, date, kind: "missing_checkin",
        detail: `${name}님 퇴근(${rec.checkOut}) 기록만 있고 출근 기록이 없습니다`,
      });
    }
    if (rec.checkIn) {
      const late = toMinutes(rec.checkIn) - toMinutes(s.start);
      if (late > grace) {
        out.push({
          employeeId: rec.employeeId, date, kind: "late", minutes: late,
          detail: `${name}님 ${s.start} 출근 예정 → ${rec.checkIn} 출근 (${late}분 지각)`,
        });
      }
    }
    if (rec.checkIn && !rec.checkOut && endedFor > CHECKOUT_WAIT_MIN) {
      out.push({
        employeeId: rec.employeeId, date, kind: "missing_checkout",
        detail: `${name}님 ${rec.checkIn} 출근 후 퇴근 기록이 없습니다 (예정 ${s.end})`,
      });
    }
    if (rec.checkOut) {
      const early = toMinutes(s.end) - toMinutes(rec.checkOut);
      if (early > grace) {
        out.push({
          employeeId: rec.employeeId, date, kind: "early_leave", minutes: early,
          detail: `${name}님 ${s.end} 퇴근 예정 → ${rec.checkOut} 퇴근 (${early}분 조기 퇴근)`,
        });
      }
    }
  }

  // 대리 출퇴근 의심: 한 기기에서 서로 다른 직원이 짧은 간격으로 기록
  const punches = db.punches.filter((p) => p.date === date).sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  const flagged = new Set<string>();
  for (const p of punches) {
    const owner = db.employees.find((e) => e.deviceId === p.deviceId)?.id;
    // 1) 다른 직원의 등록 기기로 찍힌 기록
    if (owner && owner !== p.employeeId) {
      const key = `${p.employeeId}`;
      if (!flagged.has(key)) {
        flagged.add(key);
        out.push({
          employeeId: p.employeeId, date, kind: "proxy_suspect",
          detail: `${employeeName(db, p.employeeId)}님 ${p.type === "in" ? "출근" : "퇴근"}(${p.time})이 ${employeeName(db, owner)}님 휴대폰에서 기록됐습니다`,
        });
      }
      continue;
    }
    // 2) 미등록 기기라도 같은 기기에서 다른 직원이 연달아 기록
    for (const q of punches) {
      if (q === p || q.deviceId !== p.deviceId || q.employeeId === p.employeeId) continue;
      if (Math.abs(toMinutes(q.time) - toMinutes(p.time)) > PROXY_WINDOW_MIN) continue;
      const key = [p.employeeId, q.employeeId].sort().join("+");
      if (flagged.has(key)) continue;
      flagged.add(key);
      out.push({
        employeeId: p.employeeId, date, kind: "proxy_suspect",
        detail: `${employeeName(db, p.employeeId)}님과 ${employeeName(db, q.employeeId)}님이 같은 기기로 ${PROXY_WINDOW_MIN}분 안에 기록했습니다`,
      });
    }
  }
  return out;
}

// 최근 N일 지각 횟수 (정정 반영된 실제 기록 기준)
export function lateCount(db: Db, employeeId: string, endDate: string, days = 30): number {
  let n = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(endDate, -i);
    const rec = dayRecord(db, employeeId, date);
    if (rec.shift && rec.checkIn && toMinutes(rec.checkIn) - toMinutes(rec.shift.start) > db.store.graceMinutes) n++;
  }
  return n;
}
