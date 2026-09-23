import type { Db } from "../domain/types";
import { kstParts } from "../domain/time";

// 도구 실행 컨텍스트 — 서버가 로그인 세션으로 채운다. LLM 인자로는 매장·역할을 정하지 않는다(§4).
export type Role = "owner" | "manager";
export interface ToolContext {
  userId: string;
  role: Role;
  storeIds: string[]; // 이 사용자가 볼 수 있는 매장 (세션에서)
  today: string; // KST YYYY-MM-DD (서버가 계산)
}

export type ErrorCode =
  | "need_store" // 매장이 여러 개인데 지정 안 함 → 에이전트가 되묻는다
  | "forbidden" // 권한 밖 매장/역할
  | "ambiguous_employee" // 이름이 여러 명과 일치
  | "not_found" // 이름을 못 찾음
  | "schedule_unavailable" // 스케줄 데이터 없음(§3-3)
  | "bad_input"; // zod 검증 실패 등

export interface EmployeeRef {
  id: string;
  name: string;
}

export interface ToolErr {
  ok: false;
  error: ErrorCode;
  message: string;
  candidates?: EmployeeRef[]; // ambiguous_employee 후보
  store_ids?: string[]; // need_store 시 선택지
}

export const SOURCE_LABEL = "퍼펙트근태관리" as const;
export interface ToolMeta {
  as_of: string; // 조회 시각 (KST "YYYY-MM-DD HH:mm")
  source: typeof SOURCE_LABEL;
}
export type Ok<T> = { ok: true } & ToolMeta & T;
export type ToolResult<T> = Ok<T> | ToolErr;

export function ok<T extends object>(now: Date, data: T): Ok<T> {
  return { ok: true, as_of: kstParts(now).stamp, source: SOURCE_LABEL, ...data };
}

export function err(error: ErrorCode, message: string, extra: Omit<ToolErr, "ok" | "error" | "message"> = {}): ToolErr {
  return { ok: false, error, message, ...extra };
}

export function isErr(x: unknown): x is ToolErr {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

// 매장 범위 판정 — ctx.storeIds 밖의 값은 forbidden, 미지정+다매장은 need_store (§4).
export function resolveStore(ctx: ToolContext, storeId?: string): { store_id: string } | ToolErr {
  if (storeId) {
    if (!ctx.storeIds.includes(storeId)) return err("forbidden", `매장 ${storeId} 에 접근 권한이 없습니다`);
    return { store_id: storeId };
  }
  if (ctx.storeIds.length === 1) return { store_id: ctx.storeIds[0] };
  return err("need_store", "어느 매장인지 알려주세요", { store_ids: ctx.storeIds });
}

// 이름 부분 일치("민지"→"김민지"). 없으면 전체(undefined), 여러 명이면 ambiguous (§4).
export function resolveEmployee(db: Db, name?: string): { employee?: EmployeeRef } | ToolErr {
  const q = (name ?? "").trim();
  if (!q) return { employee: undefined };
  const hits = db.employees.filter((e) => e.name.includes(q));
  if (hits.length === 0) return err("not_found", `'${q}' 이름의 직원을 찾지 못했습니다`);
  if (hits.length > 1)
    return err("ambiguous_employee", `'${q}' 에 해당하는 직원이 여러 명입니다`, {
      candidates: hits.map((e) => ({ id: e.id, name: e.name })),
    });
  return { employee: { id: hits[0].id, name: hits[0].name } };
}
