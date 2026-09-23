import type { ZodType } from "zod";
import type { AttendanceSource } from "../adapter/AttendanceSource";
import { type ToolContext, type ToolResult, type Role, err } from "./context";
import { getTodayStatus, getTodayStatusInput } from "./getTodayStatus";
import { getDayRecords, getDayRecordsInput } from "./getDayRecords";
import { getPeriodStats, getPeriodStatsInput } from "./getPeriodStats";
import { detectIssues, detectIssuesInput } from "./detectIssues";
import { getPayrollPreview, getPayrollPreviewInput } from "./getPayrollPreview";
import { listEmployees, listEmployeesInput } from "./listEmployees";

interface ToolSpec<I> {
  name: string;
  description: string;
  roles: Role[]; // 이 역할만 목록에 노출 + 호출 가능 (§5)
  input: ZodType<I>;
  run: (source: AttendanceSource, ctx: ToolContext, input: I) => Promise<ToolResult<unknown>>;
}

function spec<I>(s: ToolSpec<I>): ToolSpec<unknown> {
  return s as unknown as ToolSpec<unknown>;
}

const BOTH: Role[] = ["owner", "manager"];

// 설명은 Claude 의 도구 선택용 — '무엇을' 뿐 아니라 '언제 부르는지'를 명시(트리거 조건).
const SPECS: ToolSpec<unknown>[] = [
  spec({
    name: "get_today_status",
    description: "오늘 매장의 근무 예정·출근·퇴근·근무 중 현황. '지금 누가 근무 중?', '오늘 누가 나왔어?' 같은 질문에 사용.",
    roles: BOTH,
    input: getTodayStatusInput,
    run: getTodayStatus,
  }),
  spec({
    name: "get_day_records",
    description: "특정 날짜의 직원별 예정/출근/퇴근/인정 근무시간. '어제 몇 시에 나왔어?', 'N일 근무기록' 질문에 사용. date 는 YYYY-MM-DD.",
    roles: BOTH,
    input: getDayRecordsInput,
    run: getDayRecords,
  }),
  spec({
    name: "get_period_stats",
    description: "기간별 직원 지각·조퇴·결근 횟수와 인정 근무시간 합계. '이번 주 지각', '이번 달 근무시간', '지각 제일 많은 사람' 질문에 사용. 최대 93일.",
    roles: BOTH,
    input: getPeriodStatsInput,
    run: getPeriodStats,
  }),
  spec({
    name: "detect_issues",
    description: "특정 날짜의 이상 건(지각·조퇴·출퇴근 누락·결근·대리 출퇴근 의심)을 찾는다. '어제 이상 있었어?' 와 아침 브리핑에 사용.",
    roles: BOTH,
    input: detectIssuesInput,
    run: detectIssues,
  }),
  spec({
    name: "get_payroll_preview",
    description: "월 급여 참고 계산(기본급·연장 가산·주휴·합계·확인사항). '이번 달 급여 대략 얼마?' 질문에 사용. 참고용이며 확정은 근태관리에서. owner 전용.",
    roles: ["owner"],
    input: getPayrollPreviewInput,
    run: getPayrollPreview,
  }),
  spec({
    name: "list_employees",
    description: "매장 직원 목록(이름·활성 여부). 시급은 owner 에게만. 직원이 누구인지 확인할 때 사용.",
    roles: BOTH,
    input: listEmployeesInput,
    run: listEmployees,
  }),
];

// 소스에 바인딩된, 서버가 바로 호출할 수 있는 도구.
// 레지스트리는 이질적 도구의 배열이라 결과 페이로드는 도구별로 다르다 → ToolResult<any>.
// (개별 도구 함수는 각자 정확한 타입을 유지한다; 정적 타입이 필요하면 그 함수를 직접 쓴다.)
export interface BoundTool {
  name: string;
  description: string;
  roles: Role[];
  input: ZodType<unknown>;
  execute(ctx: ToolContext, rawInput: unknown): Promise<ToolResult<unknown>>;
}

function bind(source: AttendanceSource, s: ToolSpec<unknown>): BoundTool {
  return {
    name: s.name,
    description: s.description,
    roles: s.roles,
    input: s.input,
    async execute(ctx, rawInput): Promise<ToolResult<unknown>> {
      // 역할 게이트(방어적 재확인 — 목록 필터와 별개로 실행 시에도 막는다)
      if (!s.roles.includes(ctx.role)) return err("forbidden", `${s.name} 은(는) ${ctx.role} 권한으로 사용할 수 없습니다`);
      const parsed = s.input.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return err("bad_input", parsed.error.issues.map((i) => `${i.path.join(".") || "(입력)"}: ${i.message}`).join("; "));
      }
      return s.run(source, ctx, parsed.data);
    },
  };
}

export function bindTools(source: AttendanceSource): BoundTool[] {
  return SPECS.map((s) => bind(source, s));
}

export function toolsForRole(tools: BoundTool[], role: Role): BoundTool[] {
  return tools.filter((t) => t.roles.includes(role));
}
