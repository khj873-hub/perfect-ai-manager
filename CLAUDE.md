# 퍼펙트 AI 매니저 — 작업 규칙

운영 중인 퍼펙트근태관리 데이터를 읽기 전용으로 읽고, 사장님·관리자와 웹 채팅으로 대화하는 AI 매니저.
전체 맥락·범위·다음 단계는 `HANDOFF.md`. 이번(1단계)은 M0~M1(조회 도구 6종 + 웹 채팅 + 아침 브리핑).
배포·인수인계는 `docs/DEPLOY.md`(런북+환경변수 체크리스트), `docs/PHASE1-HANDOFF.md`(1단계 완료 요약), 근태관리 연동은 `integrations/README.md`, 스키마는 `docs/attendance-schema-map.md`.

## 절대 규칙
- 퍼펙트근태관리 DB에는 쓰지 않는다. 연결은 agent_reader 역할, agent.v_* 뷰만. service_role 키를 근태관리용으로 쓰지 않는다.
- 도구의 매장 범위(storeIds)와 역할은 서버 세션에서만 온다. LLM 인자로 받지 않는다.
- 숫자 계산은 packages/connector-attendance/src/domain에서만. 에이전트 코드에서 근무시간·급여를 계산하지 않는다.
- 시각은 KST 벽시계 문자열(YYYY-MM-DD, HH:mm). Date 객체 타임존 변환은 domain/time.ts만 사용.
- 새 도구를 추가하면 zod 스키마 + 단위 테스트 + golden.json 질문 1개 이상을 같이 추가한다.

## 명령
- `npm test`  (= connector-attendance vitest, ATTENDANCE_SOURCE=fixture 전제)
- `npm run typecheck`
- (앞으로) `npm run eval -w apps/web`, `npm run build -w apps/web`

## 범위
- 이번 범위: 조회 도구 6종, 웹 채팅, 아침 브리핑. 쓰기·카톡·CCTV는 `HANDOFF.md` §9 참고, 만들지 않는다.

## 진행 현황 / 실패에서 배운 규칙
- **작업 #1 완료**: 모노레포 + `packages/connector-attendance` 도메인 이식(detect/records/settlement/time/parseTime/types/permissions) + `adapter/FixtureSource.ts`(구 seed) + 이식 테스트 통과.
- **작업 #2 완료**: 도구 6종(`src/tools/*` — get_today_status·get_day_records·get_period_stats·detect_issues·get_payroll_preview(owner전용)·list_employees) + zod 입력 + `AttendanceSource` 인터페이스 + `createAttendanceConnector(source)→{tools,toolsFor(role)}` + 단위 테스트 33개(도메인18+도구15), `npm run typecheck` 통과.
  - 매장/역할은 `ctx`(세션)에서만. `resolveStore`(need_store/forbidden)·`resolveEmployee`(ambiguous/not_found)·zod(bad_input) 오류를 결과 union 으로 돌려줌. as_of/source 첨부, PII(전화·PIN) 미노출, 시급은 owner만.
  - 레지스트리 `execute` 반환은 `ToolResult<unknown>`(도구별 페이로드 상이). `Ok<any>` 는 any 로 붕괴해 좁히기가 깨지니 쓰지 말 것 — 호출측에서 구체 타입으로 캐스팅.
  - golden.json(도구별 질문 1개)은 `apps/web/evals` 소관 → 작업 #7에서 추가.
- **작업 #3 초안(대표 확인 대기)**: `docs/attendance-schema-map.md` — 근태관리 스키마 조사(읽기 전용, 코드 변경 없음). 로컬 `perfect-attendance-edu` 조사 기준.
  - 🔴 **스케줄(근무표) 테이블 없음** → 지각·조퇴·결근·오늘예정 판정 불가(§3-3). 도구는 이미 `schedule_unavailable` 반환하도록 설계됨.
  - ✅ **스택 확정(2026-09-24)**: 퍼펙트근태관리 = **Fastify + better-sqlite3(SQLite) + Railway** (HANDOFF 의 "Supabase" 는 오기). 스키마는 db.ts 기준 확정.
  - ⚠️ attendance=세션행(clock_in+clock_out 한 행, KST 벽시계 TEXT), **스케줄 테이블 없음**, device 없음(대리감지 불가), active 컬럼 없음, graceMinutes/fivePlus 원천 없음.
  - 🔴 **#4 접근법이 바뀜**: SQLite 는 로컬 파일이라 외부 앱이 직접 못 붙는다 → HANDOFF §3-2(agent_reader 역할+뷰+pooler)는 Postgres 전제라 **불가**. 대안: **A. 근태관리에 읽기 전용 HTTP API + `HttpSource`(권장)** / B. Railway Postgres 이전 후 `PostgresSource` / C. 파일 복제(비권장). `docs/attendance-schema-map.md` §3-A.
- **작업 #4 진행(접근법 A 확정 — 대표 선택)**: 근태관리 읽기 전용 HTTP API + `HttpSource`.
  - `HttpSource.ts`(fetch 기반 AttendanceSource — 세션행 clock_in/out 을 in/out punch 로 펼침, PII 제외, 주입 fetch 로 테스트) + 커넥터 index 노출 + 테스트 5건.
  - `integrations/attendance-agent-routes.ts`(대표가 근태관리 Fastify 에 추가할 읽기 전용 라우트: /api/agent/stores·employees·attendance, x-agent-token 인증) + `integrations/README.md`.
  - `apps/web/lib/agent/registry.ts` 배선: `ATTENDANCE_SOURCE=http`+`ATTENDANCE_API_URL`/`ATTENDANCE_API_TOKEN` → HttpSource. 기본은 fixture.
  - `PostgresSource`(B 안 전용)는 index 에서 재노출 안 함 — `import("pg")` 가 번들돼 빌드가 깨지므로. B 쓸 때만 deep import.
  - **남은 대표 액션**: ① 근태관리에 위 라우트 추가+`AGENT_READ_TOKEN` 설정+배포 ② 실매장 1곳 `get_day_records` 화면 대조(= #4 완료 기준).
- **스케줄 안 b 구현 완료**: 근태관리에 스케줄이 없어, 에이전트 DB `default_schedules`(store_id·employee_id·weekday·start·end) + 커넥터 `withDefaultSchedule` 래퍼로 조회 윈도우에 shifts 합성 → 지각·조퇴·결근 판정 가능.
  - `registry.attendanceSource()` 가 http 소스를 `withDefaultSchedule(loadDefaultSchedule)` 로 감쌈. 기본 근무표 미등록 매장은 shifts=[] → `schedule_unavailable`(안 a 로 자동 폴백).
  - 등록법: `integrations/README.md`(에이전트 Supabase 에 default_schedules insert). employee_id 는 근태관리 id 와 동일해야 함.
  - 테스트: 커넥터 `withDefaultSchedule.test.ts` 4건(합성·지각탐지·빈 근무표→schedule_unavailable·기존 shifts 보존). 전체 connector 42 + web 13.
- **작업 #5 완료**: 에이전트 DB 스키마 + 매직링크 로그인 + 역할.
  - `supabase/agent-schema.sql` (§6: agent_users/conversations/messages/tool_calls/store_settings/briefings + RLS — 본인/소속매장만 읽기, 쓰기는 service_role).
  - `apps/web` (Next.js 15 App Router): 매직링크 로그인(`@supabase/ssr`, `app/(auth)/login` + `auth/callback`), 미들웨어 세션 가드, `lib/db/profiles`(agent_users→역할·store_ids), `lib/agent/registry`(커넥터 `toolsFor(role)` 합성), 홈에서 역할별 도구 목록 표시.
  - **완료 기준 충족**: `apps/web/tests/registry.test.ts` — owner 6종(급여 포함)·manager 5종(급여 제외), 목록 상이. `next build` 통과(5 라우트+미들웨어).
  - 로그인/RLS 실제 동작은 Supabase 프로젝트 필요 → 배포 시 검증(작업 #9). `ANTHROPIC_MODEL` 기본값·비용상한은 미결정 4(작업 #6 착수 시 확정).
  - `apps/web`은 소스=fixture 로 동작(작업 #4에서 PostgresSource 연결).
- **작업 #6 완료**: 에이전트 루프 + 채팅 UI(스트리밍).
  - `lib/agent/loop.ts`(도구 호출 최대 6회, tool_calls 로깅, 초과 시 "나눠서" 안내) + `llm.ts`(백엔드 추상화: `AnthropicLlm` 실제 Claude / `MockLlm` 키 없을 때 결정적) + `systemPrompt.ts`(§7) + `guard.ts`(숫자 가드 — 측정만, 차단 안 함).
  - `app/api/chat/route.ts`(스트리밍) + `app/chat/page.tsx`(추천 질문 칩 4개 + "퍼펙트근태관리 기준 · HH:mm 조회").
  - **완료 기준 충족**: `tests/loop.test.ts` — 추천 질문 4개 각각 올바른 도구 선택+답변(MockLlm, 결정적). 추가로 **실제 Claude로 HTTP 스모크 테스트**도 4개 정상 답변 확인(환경에 키 존재). `next build` 통과(7 라우트), web typecheck 0.
  - 루프는 LLM 무관 → 키 없으면 MockLlm 로 로컬 동작. 실제 답변에서 Claude가 근무시간을 시간 단위로 합산(예: 379시간)하면 guard 가 도구 결과에 없는 숫자로 표시(정상 — 측정 목적).
  - `ANTHROPIC_MODEL` 기본값(현재 `claude-sonnet-4-5`)·월 비용상한은 미결정 4 → 대표 확인.
  - 영속화(messages/tool_calls)는 Supabase 설정 시 붙인다(작업 #8 근처). 로컬은 생략.
- **작업 #4 초안(대표 확인 대기)**: `packages/connector-attendance/src/adapter/PostgresSource.ts` — `agent.v_*` 뷰 계약(표준 컬럼)만 읽어 Db 생성(실테이블명 무관). 주입식 QueryFn 으로 테스트 가능, `createPgQuery`(지연 pg). **뷰 SQL(`attendance-readonly.sql`)·레지스트리 배선·실매장 대조는 대표의 스키마 확정 후**(§3-1 규칙). 지금은 index 에 미노출·미배선(inert).
- **작업 #7 완료**: 골든셋 평가.
  - `apps/web/evals/golden.json`(30문항, fixture 근거) + `evals/run.ts`(`npm run eval`). 지표: 도구 선택 정확도·기대 문구 포함율·manager 급여 노출.
  - **실제 Claude 평가가 store_id 환각 버그를 잡아냄** → AnthropicLlm 이 LLM 도구 스키마에서 `store_id` 제거(서버가 ctx 로 주입, §4) + 프롬프트 보강으로 수정.
  - **오프라인(MockLlm) 기준 PASS**: 도구 100%·포함 100%·급여 노출 0 (키 없이 CI 게이트). MockLlm 을 골든 의도 범주 전반 라우팅으로 보강(레퍼런스 에이전트).
  - ⚠️ **실제 Claude 전체 통과 수치는 API 크레딧 소진으로 미측정**(외부 결제 한도). 크레딧 복구 시 `npm run eval`(키 있으면 자동 실제 Claude)로 재측정. 첫 실측은 store_id 수정 전 도구 86.7%였고, 그 원인(store_id 환각)을 제거했다.
  - `expect_tools: null` 문항 = 누출 검사 전용(manager 급여) — 도구 선택 평가에서 제외, 핵심은 금액 미노출.
- **작업 #8 완료**: 아침 브리핑 크론.
  - `app/api/cron/briefing/route.ts`(GET/POST, `CRON_SECRET` Bearer 보호) + `lib/agent/briefing.ts`(detect_issues 어제 → 5줄 이내 결정적 템플릿 요약; 숫자·사실은 도구에서만) + `lib/db/service.ts`(service_role: briefings upsert + 매장 사용자 대화에 role='briefing' 삽입, Supabase 미설정이면 no-op) + `vercel.json`(cron `0 23 * * *` = KST 08:00).
  - **완료 기준 충족(런타임 스모크)**: 비밀키 없음/틀림 → 401, 올바른 Bearer → 200 + 어제 이상 5건 브리핑 생성. `tests/briefing.test.ts` 2건(5건 요약 / 이상 없으면 한 줄).
  - 요약은 LLM 대신 결정적 템플릿(무료·재현·오류 없음) — 자동 일일 메시지에 적합. 브리핑 DB 영속화·대화 삽입은 Supabase 설정 시 동작(로컬 persisted:false).
- 도메인은 아직 MVP의 `Db` 형태를 입력으로 받는다. §4의 "detect 를 AttendanceSource 배열로" 리팩터링은 **작업 #4**(PostgresSource 도입 시) — 지금 미리 바꾸지 말 것.
- `permissions.ts` 는 FixtureSource 가 `defaultPermissions()` 를 쓰기 때문에 domain 에 함께 이식했다. 최종 위치는 M1 `apps/web/lib/agent/guard.ts`(§4) — M1에서 옮긴다.
- 이식하지 않은 것(다음 세션): `ask.ts`(→ 도구), `agent.ts`(→ M1 loop.ts), `store.ts`·UI·발송함(버림), `apps/web`, `supabase/`. 이들에 의존하던 MVP 테스트 블록은 해당 작업에서 도구 단위 테스트로 재구성한다(§12 작업 #2·#5).
