import type { Db, SettlementRow } from "./types";
import { addDays, daysInMonth, kstParts, mondayOf, toMinutes } from "./time";
import { breakMinutes, dayRecord, overstayMinutes, workedMinutes } from "./records";

// 월 정산 계산 — 참고용. 실제 급여 확정 전 노무 확인이 필요하다.
// 규칙(단순화):
//  - 인정 근무: 스케줄 범위 안의 실제 근무, 휴게 공제(4h→30분, 8h→60분)
//  - 연장: 1일 8시간 초과 또는 주 40시간 초과분. 가산 50%는 상시 5인 이상 사업장만
//  - 주휴: 주 소정근로 15시간 이상이고 그 주 예정 근무일에 모두 출근한 경우,
//          (주 소정근로시간 ÷ 40) × 8시간, 최대 8시간. 일요일이 해당 월에 속한 주만 계산
export const MIN_WAGE_2026 = 10320;

function scheduledMinutes(start: string, end: string) {
  const span = toMinutes(end) - toMinutes(start);
  return span - breakMinutes(span);
}

export function computeSettlement(db: Db, month: string, today = kstParts().date): SettlementRow[] {
  const days = daysInMonth(month).filter((d) => d < today); // 끝난 날만
  const rows: SettlementRow[] = [];

  for (const e of db.employees.filter((x) => x.active)) {
    const notes: string[] = [];
    let worked = 0;
    let overtime = 0;
    let missing = 0;
    let overstay = 0;
    const weekRegular = new Map<string, number>();

    for (const d of days) {
      const rec = dayRecord(db, e.id, d);
      if (!rec.shift && !rec.checkIn) continue;
      if (rec.shift && rec.checkIn && !rec.checkOut) missing++;
      if (overstayMinutes(rec) >= 15) overstay++;
      const w = workedMinutes(rec);
      worked += w;
      const dailyReg = Math.min(w, 480);
      let ot = w - dailyReg;
      const wk = mondayOf(d);
      const soFar = weekRegular.get(wk) ?? 0;
      const allowed = Math.max(0, 2400 - soFar);
      if (dailyReg > allowed) ot += dailyReg - allowed;
      weekRegular.set(wk, soFar + Math.min(dailyReg, allowed));
      overtime += ot;
    }

    // 주휴
    let holiday = 0;
    const firstMonday = mondayOf(`${month}-01`);
    for (let mon = firstMonday; mon <= `${month}-31`; mon = addDays(mon, 7)) {
      const sun = addDays(mon, 6);
      if (!sun.startsWith(month) || sun >= today) continue;
      const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
      const shifts = db.shifts.filter((s) => s.employeeId === e.id && week.includes(s.date));
      const sched = shifts.reduce((s, x) => s + scheduledMinutes(x.start, x.end), 0);
      if (sched < 15 * 60) continue;
      const perfect = shifts.every((s) => dayRecord(db, e.id, s.date).checkIn);
      if (!perfect) {
        notes.push(`${mon} 주 결근으로 주휴 제외`);
        continue;
      }
      holiday += Math.min(480, Math.round(sched / 5));
    }

    const perMin = e.hourlyWage / 60;
    const basePay = Math.round(worked * perMin);
    const overtimePay = db.store.fivePlus ? Math.round(overtime * perMin * 0.5) : 0;
    const holidayPay = Math.round(holiday * perMin);

    if (e.hourlyWage < MIN_WAGE_2026) notes.push(`시급 ${e.hourlyWage.toLocaleString("ko-KR")}원이 2026년 최저임금(10,320원)보다 낮음`);
    if (missing) notes.push(`퇴근 기록 누락 ${missing}일 미정정 — 해당일 0시간 처리`);
    if (overstay) notes.push(`예정보다 15분 이상 늦게 퇴근 ${overstay}일 — 연장근무 인정 여부 확인 필요`);
    if (overtime && !db.store.fivePlus) notes.push("5인 미만 사업장: 연장 가산수당 미적용");

    rows.push({
      employeeId: e.id,
      name: e.name,
      workedMinutes: worked,
      overtimeMinutes: overtime,
      holidayMinutes: holiday,
      basePay,
      overtimePay,
      holidayPay,
      total: basePay + overtimePay + holidayPay,
      notes,
    });
  }
  return rows;
}

export function settlementCsv(rows: SettlementRow[]): string {
  const head = "이름,근무시간(분),연장(분),주휴(분),기본급,연장가산,주휴수당,합계,확인사항";
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [
    head,
    ...rows.map((r) =>
      [r.name, r.workedMinutes, r.overtimeMinutes, r.holidayMinutes, r.basePay, r.overtimePay, r.holidayPay, r.total, esc(r.notes.join(" / "))].join(","),
    ),
  ].join("\n");
}
