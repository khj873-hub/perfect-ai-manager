// 커넥터 레지스트리 — 커넥터들의 도구를 합쳐 역할별로 필터링한다.
// 이번 단계는 로컬 근태 커넥터 1개(FixtureSource). 작업 #4에서 PostgresSource,
// M4에서 원격 MCP 커넥터를 여기 추가만 하면 에이전트 루프는 그대로다(§9).
import {
  createAttendanceConnector,
  createFixtureSource,
  createHttpSource,
  withDefaultSchedule,
  type AttendanceSource,
  type BoundTool,
  type Role,
} from "@perfect-ai-manager/connector-attendance";
import { loadDefaultSchedule } from "@/lib/db/schedule";

// 소스 선택: ATTENDANCE_SOURCE=http → 근태관리 읽기 전용 HTTP API(접근법 A). 기본 fixture.
// 근태관리엔 스케줄이 없으므로, 에이전트 DB 기본 근무표(안 b)로 감싸 지각·결근 판정을 가능케 한다.
// (기본 근무표 미설정 매장은 shifts=[] → 지각류 도구가 schedule_unavailable.)
export function attendanceSource(): AttendanceSource {
  if (process.env.ATTENDANCE_SOURCE === "http" && process.env.ATTENDANCE_API_URL) {
    const http = createHttpSource({
      baseUrl: process.env.ATTENDANCE_API_URL,
      token: process.env.ATTENDANCE_API_TOKEN,
      // TODO: storeSettings 를 에이전트 DB store_settings 에서 주입(grace/fivePlus)
    });
    return withDefaultSchedule(http, { schedule: loadDefaultSchedule });
  }
  return createFixtureSource();
}

export function buildConnectors(source: AttendanceSource = attendanceSource()) {
  return [createAttendanceConnector(source)];
}

// 역할이 볼 수 있는 전체 도구 목록 (커넥터들의 합). get_payroll_preview 는 owner 만(§5).
export function agentToolsForRole(role: Role, source: AttendanceSource = attendanceSource()): BoundTool[] {
  return buildConnectors(source).flatMap((c) => c.toolsFor(role));
}

// 화면·프롬프트 표시용 요약
export function toolSummaries(role: Role, source?: AttendanceSource): { name: string; description: string }[] {
  return agentToolsForRole(role, source).map((t) => ({ name: t.name, description: t.description }));
}
