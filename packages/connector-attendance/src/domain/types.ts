// 도메인 타입 — 퍼펙트 근태 에이전트
// 모든 시각은 매장 현지 시각(KST) 문자열로 저장한다: 날짜 "YYYY-MM-DD", 시각 "HH:mm".

export type Id = string;

export interface StoreInfo {
  name: string;
  graceMinutes: number; // 지각·조퇴 허용 범위(분)
  fivePlus: boolean; // 상시 5인 이상 사업장 여부 (연장근로 가산수당 적용)
}

export interface Employee {
  id: Id;
  name: string;
  phone: string; // 모의 발송 대상 (실제 발송 없음)
  pin: string; // 체크인용 4자리
  hourlyWage: number; // 원
  active: boolean;
  deviceId?: string; // 처음 체크인한 휴대폰을 본인 기기로 등록 (대리 출퇴근 감지용)
}

export interface Shift {
  id: Id;
  employeeId: Id;
  date: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string; // HH:mm (자정 넘김 근무는 MVP 범위 밖)
}

export type PunchType = "in" | "out";

export interface Punch {
  id: Id;
  employeeId: Id;
  type: PunchType;
  date: string;
  time: string;
  deviceId: string;
}

// 원본 기록은 절대 수정하지 않고, 정정은 별도 레코드로 쌓는다 (되돌리기 가능)
export interface Correction {
  id: Id;
  employeeId: Id;
  date: string;
  field: "in" | "out";
  before: string | null;
  after: string;
  reason: string;
  actionId: Id;
  reverted: boolean;
}

export type IssueKind =
  | "late"
  | "early_leave"
  | "missing_checkin"
  | "missing_checkout"
  | "absent"
  | "proxy_suspect";

export type IssueStatus =
  | "open" // 감지됨, 아직 조치 없음
  | "asked" // 직원에게 사유 확인 요청함
  | "explained" // 직원이 사유 답변함
  | "resolved" // 처리 완료 (기록 정정 등)
  | "escalated"; // 사장님께 넘김

export interface Issue {
  id: Id;
  date: string;
  employeeId: Id;
  kind: IssueKind;
  minutes?: number; // 지각·조퇴 분
  detail: string;
  status: IssueStatus;
  replyToken: string; // 직원 답변 링크용
  reply?: { text: string; time?: string; at: string };
  createdAt: string; // "YYYY-MM-DD HH:mm"
}

export type ActionKind =
  | "daily_report" // 일일 근태 요약 보고
  | "ask_employee" // 직원에게 사유 확인 카톡
  | "apply_correction" // 직원 소명을 근태 기록에 반영
  | "escalate_owner" // 사장님께 보고·판단 요청
  | "warning_message" // 반복 지각 등 주의 메시지
  | "payroll_settlement"; // 월말 정산표 확정·급여 반영

export type PermissionLevel = "auto" | "approve" | "draft";

export type ActionStatus =
  | "done" // 자동 실행됨
  | "pending" // 승인 대기
  | "approved" // 승인 후 실행됨
  | "rejected" // 사장님이 거절
  | "drafted" // 초안만 작성 (실행 안 함)
  | "reverted"; // 실행 후 되돌림

export interface AgentAction {
  id: Id;
  kind: ActionKind;
  level: PermissionLevel;
  status: ActionStatus;
  summary: string; // 사장님이 읽는 한 줄
  reason: string; // 에이전트가 왜 이렇게 판단했는지
  issueId?: Id;
  payload?: Record<string, unknown>;
  createdAt: string;
  decidedAt?: string;
}

export interface Message {
  id: Id;
  to: Id | "owner";
  toName: string;
  body: string;
  link?: string;
  actionId?: Id;
  createdAt: string;
}

export interface DailyReport {
  date: string;
  text: string;
  author: "llm" | "template";
  createdAt: string;
}

export interface SettlementRow {
  employeeId: Id;
  name: string;
  workedMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number; // 주휴시간
  basePay: number;
  overtimePay: number;
  holidayPay: number;
  total: number;
  notes: string[];
}

export interface Settlement {
  month: string; // YYYY-MM
  rows: SettlementRow[];
  status: "draft" | "pending" | "approved";
  actionId?: Id;
  createdAt: string;
}

export interface Db {
  version: 1;
  store: StoreInfo;
  employees: Employee[];
  shifts: Shift[];
  punches: Punch[];
  corrections: Correction[];
  issues: Issue[];
  actions: AgentAction[];
  messages: Message[];
  reports: DailyReport[];
  settlements: Settlement[];
  permissions: Record<ActionKind, PermissionLevel>;
}
