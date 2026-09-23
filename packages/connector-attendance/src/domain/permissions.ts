import type { ActionKind, PermissionLevel } from "./types";

// 권한 매트릭스 — 사업기획서 v2 3장 기준
// auto: 에이전트가 바로 실행하고 사후 보고
// approve: 에이전트가 준비하고 사장님 승인 후 실행
// draft: 초안만 기록하고 실행하지 않음

export const ACTION_META: Record<
  ActionKind,
  { label: string; description: string; defaultLevel: PermissionLevel; maxLevel: PermissionLevel; why: string }
> = {
  daily_report: {
    label: "일일 근태 요약 보고",
    description: "하루 근태를 정리해 사장님께 보고",
    defaultLevel: "auto",
    maxLevel: "auto",
    why: "기록·보고만 하며 되돌릴 필요가 없음",
  },
  ask_employee: {
    label: "직원에게 사유 확인 카톡",
    description: "지각·누락 등 감지 시 해당 직원에게 사유를 묻는 메시지",
    defaultLevel: "auto",
    maxLevel: "auto",
    why: "매장 내부 소통이며 입사 시 에이전트 운영을 고지함",
  },
  apply_correction: {
    label: "근태 기록 정정 (직원 소명 반영)",
    description: "직원이 알려준 실제 출퇴근 시각을 기록에 반영",
    defaultLevel: "auto",
    maxLevel: "auto",
    why: "원본 기록을 보존하고 사장님이 언제든 되돌릴 수 있음",
  },
  escalate_owner: {
    label: "사장님께 판단 요청",
    description: "에이전트가 스스로 처리할 수 없는 건을 사장님께 넘김",
    defaultLevel: "auto",
    maxLevel: "auto",
    why: "보고만 하는 행동",
  },
  warning_message: {
    label: "반복 지각 주의 메시지",
    description: "최근 30일 지각이 잦은 직원에게 보내는 주의 메시지",
    defaultLevel: "approve",
    maxLevel: "approve",
    why: "직원에게 불이익이 될 수 있어 노무 리스크가 있음 — 자동 불가",
  },
  payroll_settlement: {
    label: "월말 정산표 확정·급여 반영",
    description: "월 근무시간·수당을 계산해 급여에 반영",
    defaultLevel: "approve",
    maxLevel: "approve",
    why: "돈이 걸린 행동 — 자동 승격 대상에서 제외",
  },
};

export const LEVEL_LABEL: Record<PermissionLevel, string> = {
  auto: "자동 실행",
  approve: "승인 후 실행",
  draft: "초안만",
};

const ORDER: PermissionLevel[] = ["draft", "approve", "auto"];

export function clampLevel(kind: ActionKind, level: PermissionLevel): PermissionLevel {
  const max = ACTION_META[kind].maxLevel;
  return ORDER.indexOf(level) > ORDER.indexOf(max) ? max : level;
}

export function defaultPermissions(): Record<ActionKind, PermissionLevel> {
  const out = {} as Record<ActionKind, PermissionLevel>;
  (Object.keys(ACTION_META) as ActionKind[]).forEach((k) => (out[k] = ACTION_META[k].defaultLevel));
  return out;
}
