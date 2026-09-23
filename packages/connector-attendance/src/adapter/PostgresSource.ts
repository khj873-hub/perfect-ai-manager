import type { Db } from "../domain/types";
import { kstParts, addDays } from "../domain/time";
import { defaultPermissions } from "../domain/permissions";
import type { AttendanceSource } from "./AttendanceSource";

// 운영 데이터 소스 — 근태관리 DB 의 agent.v_* 뷰만 읽는다(§3-2).
// 뷰의 컬럼(계약)은 커넥터 표준으로 고정돼 있으므로, 이 어댑터는 실제 테이블명과 무관하다.
// 실제 뷰 정의(테이블 매핑)는 supabase/attendance-readonly.sql, 매핑 근거는 docs/attendance-schema-map.md.
//
// 매장 필터는 RLS 가 아니라 여기서 store_id 로 강제한다(§3-2). 모든 쿼리에 store_id 가 들어간다.

export type Row = Record<string, unknown>;
export type QueryFn = (sql: string, params?: unknown[]) => Promise<Row[]>;

export interface StoreSettings {
  name?: string;
  graceMinutes?: number; // 근태관리에 없어 에이전트 DB store_settings 에서 주입(§3-1 #5)
  fivePlus?: boolean;
}

export interface PostgresSourceOptions {
  query: QueryFn;
  storeSettings?: (storeId: string) => StoreSettings | Promise<StoreSettings>;
  now?: () => Date;
  windowPastDays?: number; // load 시 불러올 과거 일수(기본 120). 미래 스케줄은 +14일.
}

const s = (v: unknown): string => (v == null ? "" : String(v));

export function createPostgresSource(opts: PostgresSourceOptions): AttendanceSource {
  const nowFn = opts.now ?? (() => new Date());
  const q = opts.query;

  return {
    now: nowFn,

    async storeIds(): Promise<string[]> {
      const rows = await q("select distinct store_id from agent.v_employees");
      return rows.map((r) => s(r.store_id)).filter(Boolean);
    },

    async load(storeId: string): Promise<Db> {
      const today = kstParts(nowFn()).date;
      const from = addDays(today, -(opts.windowPastDays ?? 120));
      const to = addDays(today, 14);

      const emps = await q(
        "select id, store_id, name, hourly_wage, active from agent.v_employees where store_id = $1",
        [storeId],
      );
      const ids = emps.map((e) => s(e.id));

      // 스케줄(v_shifts)이 운영에 없을 수 있다(§3-3) → 뷰가 비어 있으면 shifts=[] → 도구가 schedule_unavailable.
      const shifts = ids.length
        ? await q(
            "select id, employee_id, work_date, start_hm, end_hm from agent.v_shifts " +
              "where employee_id = any($1) and work_date >= $2 and work_date < $3",
            [ids, from, to],
          ).catch(() => [] as Row[]) // v_shifts 뷰가 없으면 무시(스케줄 미도입 매장)
        : [];

      const punches = ids.length
        ? await q(
            "select id, employee_id, type, work_date, hm, device_id from agent.v_punches " +
              "where employee_id = any($1) and work_date >= $2 and work_date < $3",
            [ids, from, to],
          )
        : [];

      const settings = (await opts.storeSettings?.(storeId)) ?? {};

      return {
        version: 1,
        store: {
          name: settings.name ?? s(emps[0]?.store_id ?? storeId),
          graceMinutes: settings.graceMinutes ?? 5,
          fivePlus: settings.fivePlus ?? false,
        },
        employees: emps.map((e) => ({
          id: s(e.id),
          name: s(e.name),
          phone: "", // 뷰에서 PII 제외(§3-2). 읽기 도구는 사용하지 않음
          pin: "",
          hourlyWage: Number(e.hourly_wage) || 0,
          active: e.active !== false,
        })),
        shifts: shifts.map((sh) => ({
          id: s(sh.id),
          employeeId: s(sh.employee_id),
          date: s(sh.work_date),
          start: s(sh.start_hm),
          end: s(sh.end_hm),
        })),
        punches: punches.map((p) => ({
          id: s(p.id),
          employeeId: s(p.employee_id),
          type: p.type === "out" ? "out" : "in",
          date: s(p.work_date),
          time: s(p.hm),
          deviceId: s(p.device_id),
        })),
        corrections: [], // 정정은 에이전트 측 기능(M2). 읽기 소스에는 없음
        issues: [],
        actions: [],
        messages: [],
        reports: [],
        settlements: [],
        permissions: defaultPermissions(),
      };
    },
  };
}

// 지연 로드 pg 풀로 QueryFn 생성. pg 는 앱(서버)에서 설치한다(커넥터 필수 의존 아님).
// 연결: Supabase Session pooler + agent_reader 계정(§3-2). service_role 키를 쓰지 않는다.
export async function createPgQuery(connectionString: string): Promise<QueryFn> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pg" as string);
  const pool = new mod.Pool({ connectionString, max: 4, statement_timeout: 3000 });
  return async (sql, params) => (await pool.query(sql, params)).rows as Row[];
}
