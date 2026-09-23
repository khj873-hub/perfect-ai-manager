import { kstParts, type Role, type ToolContext } from "@perfect-ai-manager/connector-attendance";

// 에이전트 사용자 프로필 (agent_users 에서 로드)
export interface AgentProfile {
  userId: string;
  displayName: string;
  role: Role;
  storeIds: string[];
}

// ToolContext 는 서버가 세션으로 채운다. LLM 인자로 매장·역할을 받지 않는다(§4·CLAUDE 규칙).
export function buildToolContext(p: AgentProfile, now: Date = new Date()): ToolContext {
  return { userId: p.userId, role: p.role, storeIds: p.storeIds, today: kstParts(now).date };
}
