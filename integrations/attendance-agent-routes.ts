// ─────────────────────────────────────────────────────────────────────────
// 퍼펙트근태관리(Fastify + better-sqlite3)에 추가할 **읽기 전용** 라우트.
// AI 매니저(에이전트)가 근태 데이터를 읽는 유일한 통로다(접근법 A).
//
// 설치:
//   1) 이 파일을 근태관리 저장소 server/src/routes/agent.ts 로 복사
//   2) server/src/index.ts 에서 등록:
//        import { registerAgentRoutes } from "./routes/agent";
//        registerAgentRoutes(app, db);
//   3) 환경변수 AGENT_READ_TOKEN=<길고 강한 랜덤값> 설정 (Railway Variables)
//   4) 배포 후 에이전트(.env)에 ATTENDANCE_SOURCE=http, ATTENDANCE_API_URL=<근태관리 URL>,
//      ATTENDANCE_API_TOKEN=<AGENT_READ_TOKEN> 설정
//
// 원칙: 테이블은 읽기만 한다(수정 없음). 전화번호·PIN 등 PII 는 내보내지 않는다.
//       매장은 businesses.slug 로 식별한다.
// ─────────────────────────────────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export function registerAgentRoutes(app: FastifyInstance, db: Database.Database): void {
  // 인증: 헤더 x-agent-token === AGENT_READ_TOKEN. 미설정이면 전면 차단.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/agent/")) return;
    const token = process.env.AGENT_READ_TOKEN;
    if (!token || req.headers["x-agent-token"] !== token) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  // 매장 목록
  app.get("/api/agent/stores", async () => {
    return db.prepare("SELECT slug AS id, name FROM businesses").all();
  });

  // 직원: 시급 포함, PII 제외. active 컬럼이 없으므로 항상 활성으로 본다.
  app.get<{ Querystring: { store?: string } }>("/api/agent/employees", async (req, reply) => {
    const store = req.query.store;
    if (!store) return reply.code(400).send({ error: "store 필요" });
    return db
      .prepare(
        `SELECT e.id, e.name, e.hourly_rate AS hourly_wage, 1 AS active
         FROM employees e JOIN businesses b ON b.id = e.business_id
         WHERE b.slug = ?`,
      )
      .all(store);
  });

  // 출퇴근(세션행): clock_in/clock_out 은 "YYYY-MM-DD HH:MM:SS" KST 문자열.
  // from(포함)·to(배타) 는 날짜 문자열(YYYY-MM-DD). TEXT 비교로 기간 필터.
  app.get<{ Querystring: { store?: string; from?: string; to?: string } }>(
    "/api/agent/attendance",
    async (req, reply) => {
      const { store, from, to } = req.query;
      if (!store || !from || !to) return reply.code(400).send({ error: "store/from/to 필요" });
      // 최대 조회 폭 제한(부하 방지)
      return db
        .prepare(
          `SELECT a.id, a.employee_id, a.clock_in, a.clock_out
           FROM attendance a
           JOIN employees e ON e.id = a.employee_id
           JOIN businesses b ON b.id = e.business_id
           WHERE b.slug = ? AND a.clock_in >= ? AND a.clock_in < ?
           ORDER BY a.clock_in`,
        )
        .all(store, from, to);
    },
  );
}
