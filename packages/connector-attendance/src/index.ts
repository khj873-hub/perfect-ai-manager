// 근태 커넥터 진입점.
// createAttendanceConnector(source) → { tools } : 소스에 바인딩된 조회 도구 6종.
// 웹 에이전트(apps/web)는 이 tools 를 역할로 필터링해 Claude 에게 노출한다(§5, 작업 #6).

import type { AttendanceSource } from "./adapter/AttendanceSource";
import { bindTools, toolsForRole, type BoundTool } from "./tools";
import type { Role, ToolContext } from "./tools/context";

export function createAttendanceConnector(source: AttendanceSource): {
  tools: BoundTool[];
  toolsFor: (role: Role) => BoundTool[];
} {
  const tools = bindTools(source);
  return { tools, toolsFor: (role: Role) => toolsForRole(tools, role) };
}

export type { AttendanceSource } from "./adapter/AttendanceSource";
export type { BoundTool } from "./tools";
export type { Role, ToolContext, ToolResult, ToolErr } from "./tools/context";
export { createFixtureDb, createFixtureSource } from "./adapter/FixtureSource";
export { createHttpSource } from "./adapter/HttpSource";
export type { HttpSourceOptions, FetchLike } from "./adapter/HttpSource";
export type { StoreSettings } from "./adapter/PostgresSource"; // type-only(빌드 시 소거) → pg 미유입
export { withDefaultSchedule } from "./adapter/withDefaultSchedule";
export type { DefaultShift, WithScheduleOptions } from "./adapter/withDefaultSchedule";
// PostgresSource(접근법 B — Railway Postgres 이전 시)는 index 에서 재노출하지 않는다:
// `import("pg")` 가 번들 그래프에 끌려와 pg 미설치 환경의 빌드를 깨뜨리기 때문.
// B 를 쓸 때만 deep import: `@perfect-ai-manager/connector-attendance/src/adapter/PostgresSource`.

// 도메인·도구도 함께 노출 (테스트·상위 조립용)
export * from "./domain/types";
export * from "./domain/time";
export * from "./domain/parseTime";
export * from "./domain/records";
export * from "./domain/settlement";
export * from "./domain/detect";
export * from "./domain/permissions";
