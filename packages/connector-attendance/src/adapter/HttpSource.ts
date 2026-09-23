import type { Db } from "../domain/types";
import { kstParts, addDays } from "../domain/time";
import { defaultPermissions } from "../domain/permissions";
import type { AttendanceSource } from "./AttendanceSource";
import type { StoreSettings } from "./PostgresSource";

// 운영 데이터 소스 — 근태관리(Fastify+SQLite, Railway)의 읽기 전용 HTTP API 를 호출한다.
// SQLite 는 로컬 파일이라 외부 직접 접속이 불가하므로, 근태관리 서버가 데이터를 노출하고
// 에이전트는 이 어댑터로 읽는다(접근법 A, docs/attendance-schema-map.md §3-A).
//
// 근태관리에 추가할 라우트 스펙(integrations/attendance-agent-routes.ts):
//   GET /api/agent/stores                              → [{ id(slug), name }]
//   GET /api/agent/employees?store=<slug>              → [{ id, name, hourly_wage, active }]  (PII 제외)
//   GET /api/agent/attendance?store=<slug>&from&to     → [{ id, employee_id, clock_in, clock_out }]  (세션행)
//   인증: 헤더 x-agent-token: <AGENT_READ_TOKEN>
//
// 근태관리에 스케줄 테이블이 없으므로 shifts=[] → 지각류 도구는 schedule_unavailable(§3-3).

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface HttpSourceOptions {
  baseUrl: string; // 예: https://perfect-attendance.up.railway.app
  token?: string; // AGENT_READ_TOKEN
  now?: () => Date;
  windowPastDays?: number; // load 범위(과거 일수, 기본 120). 미래 +14일.
  storeSettings?: (storeId: string) => StoreSettings | Promise<StoreSettings>;
  fetchFn?: FetchLike; // 테스트 주입용. 기본 globalThis.fetch
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));

// "YYYY-MM-DD HH:MM:SS" (KST 벽시계 TEXT) → { date, hm }
function splitStamp(stamp: unknown): { date: string; hm: string } {
  const [d, t] = s(stamp).split(" ");
  return { date: d ?? "", hm: (t ?? "").slice(0, 5) };
}

export function createHttpSource(opts: HttpSourceOptions): AttendanceSource {
  const nowFn = opts.now ?? (() => new Date());
  const doFetch: FetchLike = opts.fetchFn ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
  if (!doFetch) throw new Error("fetch 를 사용할 수 없습니다 (fetchFn 주입 필요)");
  const base = opts.baseUrl.replace(/\/$/, "");

  async function getJson(pathAndQuery: string): Promise<Row[]> {
    const res = await doFetch(`${base}${pathAndQuery}`, {
      headers: opts.token ? { "x-agent-token": opts.token } : {},
    });
    if (!res.ok) throw new Error(`근태관리 API ${pathAndQuery} 실패: HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? (data as Row[]) : [];
  }

  return {
    now: nowFn,

    async storeIds(): Promise<string[]> {
      const rows = await getJson("/api/agent/stores");
      return rows.map((r) => s(r.id)).filter(Boolean);
    },

    async load(storeId: string): Promise<Db> {
      const today = kstParts(nowFn()).date;
      const from = addDays(today, -(opts.windowPastDays ?? 120));
      const to = addDays(today, 14); // 배타적 상한(날짜 문자열 비교)

      const q = `store=${encodeURIComponent(storeId)}`;
      const emps = await getJson(`/api/agent/employees?${q}`);
      const att = await getJson(`/api/agent/attendance?${q}&from=${from}&to=${to}`);

      // 세션행(clock_in+clock_out 한 행) → punch(in/out 별도 행)로 펼친다.
      const punches = att.flatMap((a) => {
        const eid = s(a.employee_id);
        const rid = s(a.id);
        const out: Db["punches"] = [];
        if (a.clock_in) {
          const { date, hm } = splitStamp(a.clock_in);
          out.push({ id: `${rid}-in`, employeeId: eid, type: "in", date, time: hm, deviceId: "" });
        }
        if (a.clock_out) {
          const { date, hm } = splitStamp(a.clock_out);
          out.push({ id: `${rid}-out`, employeeId: eid, type: "out", date, time: hm, deviceId: "" });
        }
        return out;
      });

      const settings = (await opts.storeSettings?.(storeId)) ?? {};

      return {
        version: 1,
        store: {
          name: settings.name ?? storeId,
          graceMinutes: settings.graceMinutes ?? 5,
          fivePlus: settings.fivePlus ?? false,
        },
        employees: emps.map((e) => ({
          id: s(e.id),
          name: s(e.name),
          phone: "",
          pin: "",
          hourlyWage: Number(e.hourly_wage) || 0,
          active: e.active !== 0 && e.active !== false,
        })),
        shifts: [], // 근태관리에 스케줄 없음(§3-3) → 지각류 도구는 schedule_unavailable
        punches,
        corrections: [],
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
