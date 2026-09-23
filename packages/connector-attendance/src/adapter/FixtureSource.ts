import type { Db, Employee, Punch, Shift } from "../domain/types";
import { addDays, fromMinutes, kstParts, toMinutes, weekday } from "../domain/time";
import { defaultPermissions } from "../domain/permissions";
import type { AttendanceSource } from "./AttendanceSource";

// FixtureSource — MVP 시드 기반 테스트·로컬 개발 데이터 (구 seed.ts 이식).
// 데모 데이터: 오늘(KST) 기준 최근 30일 + 앞으로 7일 스케줄.
// "어제"에 에이전트가 처리할 이상 건을 일부러 심어둔다.
//
// 참고(다음 단계): 운영 데이터 소스(PostgresSource)와 공통 인터페이스 AttendanceSource 는
// M0-a(작업 #4)에서 도입한다. 이번 세션은 도메인 로직이 소비하는 Db 형태를 그대로 만든다.

const EMPLOYEES: Employee[] = [
  { id: "e1", name: "김민지", phone: "010-1111-0001", pin: "1111", hourlyWage: 10320, active: true },
  { id: "e2", name: "박준호", phone: "010-1111-0002", pin: "2222", hourlyWage: 10500, active: true },
  { id: "e3", name: "이서연", phone: "010-1111-0003", pin: "3333", hourlyWage: 10320, active: true },
  { id: "e4", name: "최하늘", phone: "010-1111-0004", pin: "4444", hourlyWage: 10400, active: true },
  { id: "e5", name: "정우진", phone: "010-1111-0005", pin: "5555", hourlyWage: 10320, active: true },
];

// 요일별 기본 스케줄 (0=일 … 6=토)
const PATTERN: Record<string, { days: number[]; start: string; end: string }> = {
  e1: { days: [1, 2, 3, 4, 5], start: "09:00", end: "15:00" },
  e2: { days: [1, 2, 3, 4, 5], start: "14:00", end: "21:00" },
  e3: { days: [0, 3, 6], start: "10:00", end: "18:00" },
  e4: { days: [1, 3, 5], start: "11:00", end: "17:00" },
  e5: { days: [0, 2, 4, 6], start: "17:00", end: "22:00" },
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** MVP 시드 데이터로 채운 Db 를 만든다 (구 createSeed). 같은 now 면 항상 같은 결과. */
export function createFixtureDb(now: Date = new Date()): Db {
  const today = kstParts(now).date;
  const yesterday = addDays(today, -1);
  const rand = rng(42);
  const shifts: Shift[] = [];
  const punches: Punch[] = [];
  let n = 0;
  const pid = () => `p${++n}`;

  const forced = new Set([yesterday, today]);

  for (let offset = -30; offset <= 7; offset++) {
    const date = addDays(today, offset);
    const wd = weekday(date);
    for (const e of EMPLOYEES) {
      const p = PATTERN[e.id];
      if (!p.days.includes(wd) && !forced.has(date)) continue;
      shifts.push({ id: `s_${e.id}_${date}`, employeeId: e.id, date, start: p.start, end: p.end });
    }
  }

  // 김민지: 최근 30일 안에 지각 2회 (어제 지각까지 3회 → 주의 메시지 제안)
  const e1Past = shifts
    .filter((s) => s.employeeId === "e1" && s.date < yesterday)
    .map((s) => s.date)
    .sort()
    .reverse();
  const lateDays = new Map([[e1Past[2], 12], [e1Past[6], 21]]);

  for (const s of shifts) {
    if (s.date >= yesterday) continue; // 어제·오늘은 시나리오로 직접 작성
    let inMin = toMinutes(s.start) - Math.floor(rand() * 9);
    if (s.employeeId === "e1" && lateDays.has(s.date)) inMin = toMinutes(s.start) + lateDays.get(s.date)!;
    const outMin = toMinutes(s.end) + Math.floor(rand() * 11);
    const dev = `dev-${s.employeeId}`;
    punches.push({ id: pid(), employeeId: s.employeeId, type: "in", date: s.date, time: fromMinutes(inMin), deviceId: dev });
    punches.push({ id: pid(), employeeId: s.employeeId, type: "out", date: s.date, time: fromMinutes(outMin), deviceId: dev });
  }

  // ── 어제 시나리오 ──
  const y = yesterday;
  const add = (employeeId: string, type: "in" | "out", time: string, deviceId = `dev-${employeeId}`) =>
    punches.push({ id: pid(), employeeId, type, date: y, time, deviceId });
  add("e1", "in", "09:17"); // 지각 17분 (최근 30일 3번째)
  add("e1", "out", "15:03");
  add("e2", "in", "13:56"); // 퇴근 기록 누락
  add("e3", "in", "09:57");
  add("e3", "out", "17:20"); // 조퇴 40분
  add("e4", "in", "10:58", "dev-e3"); // 이서연 휴대폰으로 출근 → 대리 출근 의심
  add("e4", "out", "17:04");
  // e5 정우진: 기록 없음 → 결근 의심

  // ── 오늘: 오전 근무자만 출근한 상태 ──
  punches.push({ id: pid(), employeeId: "e1", type: "in", date: today, time: "08:56", deviceId: "dev-e1" });
  punches.push({ id: pid(), employeeId: "e3", type: "in", date: today, time: "09:59", deviceId: "dev-e3" });

  return {
    version: 1,
    store: { name: "퍼펙트카페 판교점", graceMinutes: 5, fivePlus: true },
    employees: EMPLOYEES.map((e) => ({ ...e, deviceId: `dev-${e.id}` })),
    shifts,
    punches,
    corrections: [],
    issues: [],
    actions: [],
    messages: [],
    reports: [],
    settlements: [],
    permissions: defaultPermissions(),
  };
}

export interface FixtureOptions {
  storeId?: string; // 이 데모 소스가 대표하는 매장 id (ctx.storeIds 와 맞춘다)
  now?: Date; // 조회 기준 시각 (고정 → 결정적). 시드도 이 시각 기준으로 생성.
}

/** AttendanceSource 를 구현하는 시드 기반 데모 소스 (테스트·로컬 개발용).
 *  단일 매장이므로 load(storeId) 는 store_id 와 무관하게 같은 데모 Db 를 돌려준다. */
export function createFixtureSource(opts: FixtureOptions = {}): AttendanceSource {
  const storeId = opts.storeId ?? "store_demo";
  const now = opts.now ?? new Date();
  const db = createFixtureDb(now);
  return {
    now: () => now,
    storeIds: () => [storeId],
    load: () => db,
  };
}
