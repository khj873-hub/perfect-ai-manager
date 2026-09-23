# 근태관리 연동 (접근법 A — 읽기 전용 HTTP API)

퍼펙트근태관리는 **Fastify + SQLite(better-sqlite3) + Railway**다. SQLite 는 로컬 파일이라
에이전트가 직접 접속할 수 없으므로, 근태관리 서버가 **읽기 전용 API** 를 노출하고 에이전트가
`HttpSource` 로 읽는다. (근거·대안: `docs/attendance-schema-map.md` §3-A)

## 대표가 할 일 (근태관리 저장소)
1. `attendance-agent-routes.ts` → 근태관리 `server/src/routes/agent.ts` 로 복사.
2. `server/src/index.ts` 에 등록:
   ```ts
   import { registerAgentRoutes } from "./routes/agent";
   registerAgentRoutes(app, db);
   ```
3. Railway Variables 에 `AGENT_READ_TOKEN=<길고 강한 랜덤값>` 추가 후 배포.
4. 확인: `curl -H "x-agent-token: <TOKEN>" https://<근태관리>/api/agent/stores` → 매장 목록 JSON.

## 에이전트(perfect-ai-manager) 쪽 (내가 이미 배선함)
`apps/web/.env` 에:
```
ATTENDANCE_SOURCE=http
ATTENDANCE_API_URL=https://<근태관리 Railway URL>
ATTENDANCE_API_TOKEN=<AGENT_READ_TOKEN 와 동일>
```
그러면 `HttpSource` 가 위 API 를 호출해 도구가 실데이터로 동작한다. (`lib/agent/registry.ts`)

## API 계약 (읽기 전용, PII 제외)
| 엔드포인트 | 반환 |
|---|---|
| `GET /api/agent/stores` | `[{ id(slug), name }]` |
| `GET /api/agent/employees?store=<slug>` | `[{ id, name, hourly_wage, active }]` |
| `GET /api/agent/attendance?store=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD` | `[{ id, employee_id, clock_in, clock_out }]` (세션행) |

인증: 헤더 `x-agent-token: <AGENT_READ_TOKEN>`. 전화번호·PIN 은 내보내지 않는다.

## 스케줄(기본 근무표) — 안 b 구현됨
근태관리에 스케줄 테이블이 없어, 에이전트 DB `default_schedules` 에 **매장별 기본 근무표**를 두면
지각·조퇴·결근·"오늘 예정"을 판정한다. 등록 방법(에이전트 Supabase SQL Editor, service_role):
```sql
insert into default_schedules (store_id, employee_id, weekday, start_hm, end_hm) values
  ('store_demo', '<근태관리 employee id>', 1, '09:00', '18:00'),  -- 1=월
  ('store_demo', '<근태관리 employee id>', 2, '09:00', '18:00');  -- 2=화 ...
-- weekday: 0=일 … 6=토. employee_id 는 /api/agent/employees 의 id 와 동일해야 함.
```
미등록 매장은 지각류 도구가 `schedule_unavailable` 로 안내한다(출퇴근·근무시간·명단은 무관하게 동작).
- `grace_minutes`·`five_plus` 는 근태관리에 없어 에이전트 DB `store_settings` 에서 주입(추후).
- 완료 기준(#4): 실매장 1곳에서 `get_day_records` 결과가 근태관리 화면 숫자와 일치하는지 대조.
