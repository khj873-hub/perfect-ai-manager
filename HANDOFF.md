# HANDOFF — 퍼펙트 AI 매니저 (대화형 근태 에이전트) → Claude Code

작성: 2026-09-23 · 대상: 알렉스킴 대표가 로컬 Claude Code에서 1단계(M0~M1)를 개발할 때의 시작점
관련 문서: 사업기획서 v3 (Claude Docs "퍼펙트 AI 매니저 사업기획서 v3"), Claude 프로젝트 "동작 분석 노트" → `claude/attendance-agent-mvp.md`
재사용 코드: `perfect-attendance-agent-mvp.zip` (9/23 근태 에이전트 MVP, 테스트 33개 통과)

---

## 0. 30초 요약

- **무엇**: 운영 중인 **퍼펙트근태관리**(Next.js + Supabase, Railway)의 데이터를 **읽기 전용**으로 읽고, 사장님·관리자와 **웹 채팅으로 대화**하는 AI 매니저. "이번 주 지각 누구야?", "민지 이번 달 근무시간", "이번 달 급여 대략 얼마?"에 답하고, 매일 아침 전날 근태 브리핑을 보낸다.
- **원칙**: 근태관리 서비스는 건드리지 않는다(읽기 전용 DB 역할 + 뷰만 추가). 에이전트는 **커넥터 도구**로만 데이터에 접근한다. 숫자는 도구(코드)가 계산하고 LLM은 설명만 한다.
- **이번 범위**: M0 근태 커넥터 + M1 웹 채팅 베타. 쓰기(정정·메시지·정산 확정), 카카오톡, CCTV는 **범위 밖**(§9에 다음 단계로 정리).
- **완료 모습**: 기존 고객 매장 하나로 로그인 → 채팅에서 질문하면 근태관리 화면과 같은 숫자로 답하고, 아침 8시에 전날 브리핑이 채팅 첫 메시지로 와 있다.

## 1. 전체 구조

```
[채널]        apps/web  — 웹 채팅 (PWA, 모바일 우선)           ← 이번 범위
                 │
[에이전트]    apps/web/lib/agent — Claude 도구 호출 루프, 대화 기억, 감사 로그   ← 이번 범위
                 │  ConnectorRegistry (도구 목록 = 커넥터들의 합)
[커넥터]      packages/connector-attendance  ← 이번 범위
              (추후) CCTV 커넥터 = 원격 MCP 서버, 같은 레지스트리에 추가만
                 │  읽기 전용 Postgres 연결 (agent_reader 역할, agent_v_* 뷰만)
[데이터]      퍼펙트근태관리 Supabase (운영 중, 수정 금지)
              에이전트 DB (새 Supabase 프로젝트: 사용자·대화·로그·브리핑)
```

**DB를 둘로 나누는 이유**: 근태관리 DB에는 에이전트가 절대 쓰지 않는다. 에이전트가 만드는 데이터(대화, 도구 호출 로그, 브리핑, 나중에 승인 요청)는 별도 Supabase 프로젝트에 저장한다. 근태관리 장애와 에이전트 장애가 서로 번지지 않게 한다.

## 2. 저장소 구조 (새 모노레포)

```
perfect-ai-manager/
├─ HANDOFF.md                  ← 이 문서
├─ CLAUDE.md                   ← §11 초안을 복사해서 시작
├─ package.json                ← npm workspaces
├─ packages/
│  └─ connector-attendance/    근태 커넥터 (순수 TS, 프레임워크 무관)
│     ├─ src/types.ts          커넥터 표준 타입 (Employee, Shift, Punch, DayRecord …)
│     ├─ src/adapter/
│     │  ├─ AttendanceSource.ts    데이터 소스 인터페이스
│     │  ├─ PostgresSource.ts      agent_v_* 뷰 읽기 (운영)
│     │  └─ FixtureSource.ts       MVP 시드 기반 (테스트·로컬 개발)
│     ├─ src/domain/           ← MVP에서 이식: detect, records, settlement, time, parseTime
│     ├─ src/tools/            도구 6종 (§4) — zod 입력 스키마 + 실행 함수
│     ├─ src/index.ts          createAttendanceConnector(source) → { tools }
│     └─ tests/
├─ apps/
│  ├─ web/                     Next.js 15 App Router — 채팅 UI + 에이전트 + 크론
│  │  ├─ app/(auth)/login
│  │  ├─ app/chat/             채팅 화면
│  │  ├─ app/api/chat/route.ts       스트리밍 응답
│  │  ├─ app/api/cron/briefing/route.ts
│  │  ├─ lib/agent/            loop.ts, systemPrompt.ts, registry.ts, guard.ts
│  │  ├─ lib/db/               에이전트 DB 접근 (Supabase JS)
│  │  └─ evals/golden.json     골든 질문셋 (§8)
│  └─ mcp-attendance/          (선택, M1 끝에) 같은 도구를 MCP 서버로 노출하는 얇은 래퍼
└─ supabase/
   ├─ attendance-readonly.sql  근태관리 DB에 적용: 역할 + 뷰 (§3)
   └─ agent-schema.sql         에이전트 DB 스키마 (§6)
```

## 3. M0-a. 근태관리 DB 읽기 전용 접근

### 3-1. 먼저 할 일: 기존 스키마 조사 (코드 수정 금지)

퍼펙트근태관리 저장소를 **읽기만** 해서 아래 매핑 표를 채운다. 결과는 `docs/attendance-schema-map.md`로 남긴다. 이 표가 채워지기 전에는 뷰를 만들지 않는다.

| 커넥터 표준 필드 | 근태관리 실제 테이블.컬럼 | 비고 (타임존, 단위, NULL 의미) |
| --- | --- | --- |
| store: id, name | ? | 매장(사업장) 단위. 다점포 구조인지 확인 |
| employee: id, store_id, name, hourly_wage, active | ? | 시급 컬럼 위치, 퇴사자 표시 방식 |
| shift: employee_id, date, start, end | ? | 스케줄 기능이 없으면 → §3-3 |
| punch: employee_id, type(in/out), at, device | ? | timestamptz인지, KST 로컬인지 |
| owner/manager 계정 → store 매핑 | ? | 로그인 연동 방식 결정에 필요 (§5) |
| 급여 설정: 5인 이상 여부, 휴게 규칙 | ? | 없으면 에이전트 DB의 매장 설정으로 |

### 3-2. 읽기 전용 역할과 뷰 (`supabase/attendance-readonly.sql`)

```sql
-- 근태관리 Supabase SQL Editor에서 대표가 직접 실행. 테이블은 절대 수정하지 않는다.
create role agent_reader with login password '<강한 비밀번호>';
alter role agent_reader set statement_timeout = '3s';
create schema if not exists agent;
grant usage on schema agent to agent_reader;

-- 표준 뷰: 컬럼 이름·타입을 커넥터 표준으로 맞춘다 (실제 테이블명은 3-1 결과로 교체)
create or replace view agent.v_employees as
  select e.id, e.store_id, e.name, e.hourly_wage, (e.deleted_at is null) as active
  from public.employees e;

create or replace view agent.v_shifts as
  select s.id, s.employee_id, (s.start_at at time zone 'Asia/Seoul')::date as work_date,
         to_char(s.start_at at time zone 'Asia/Seoul', 'HH24:MI') as start_hm,
         to_char(s.end_at   at time zone 'Asia/Seoul', 'HH24:MI') as end_hm
  from public.schedules s;

create or replace view agent.v_punches as
  select p.id, p.employee_id, p.kind as type,
         (p.created_at at time zone 'Asia/Seoul')::date as work_date,
         to_char(p.created_at at time zone 'Asia/Seoul', 'HH24:MI') as hm,
         coalesce(p.device_id, 'unknown') as device_id
  from public.attendance_logs p;

grant select on all tables in schema agent to agent_reader;
alter default privileges in schema agent grant select on tables to agent_reader;
-- public 스키마 테이블에는 아무 권한도 주지 않는다.
```

- 연결: Supabase **Session pooler** 연결 문자열 + `agent_reader` 계정. `service_role` 키는 에이전트 코드 어디에도 두지 않는다.
- 뷰만 조회하므로 근태관리 스키마가 바뀌면 **뷰만** 고친다.
- 뷰는 소유자 권한으로 실행되므로 `agent_reader`는 원본 테이블 권한 없이 뷰만 읽는다. 그 대신 **매장 필터는 RLS가 아니라 커넥터가 강제**한다(§4의 `ctx.storeIds`). 모든 쿼리에 `store_id = any($storeIds)`가 들어갔는지 테스트로 확인한다.
- 부하 방지: 모든 쿼리는 `store_id` + 날짜 범위 필수, 최대 기간 93일, 역할에 `statement_timeout = 3s`.

### 3-3. 스케줄 데이터가 없는 경우

근태관리에 스케줄이 없으면 지각·조퇴 판정이 불가능하다. 이때는 (a) 지각 관련 도구가 `schedule_unavailable`을 돌려주고 에이전트가 "스케줄 등록이 필요해요"라고 답하게 하고, (b) 에이전트 DB에 매장별 기본 근무표(요일×직원×시간)를 두는 방안을 대표에게 확인받는다. 임의로 근태관리에 테이블을 추가하지 않는다.

## 4. M0-b. 근태 커넥터 도구 (이번 범위: 조회 6종)

모든 도구는 `(ctx, input) => Promise<Result>` 형태다. **`ctx`는 서버가 로그인 세션으로 채우고, LLM이 만든 인자로는 절대 매장 범위를 정하지 않는다.**

```ts
type ToolContext = {
  userId: string;
  role: "owner" | "manager";
  storeIds: string[];   // 이 사용자가 볼 수 있는 매장 (세션에서)
  today: string;        // KST YYYY-MM-DD (서버가 계산)
};
```

| 도구 | 입력 (zod) | 출력 요지 | 역할 제한 |
| --- | --- | --- | --- |
| `get_today_status` | `{ store_id? }` | 오늘 근무 예정·출근·퇴근·근무 중 목록 | 없음 |
| `get_day_records` | `{ date, employee_name? , store_id? }` | 직원별 예정/출근/퇴근/인정 근무분 | 없음 |
| `get_period_stats` | `{ from, to, employee_name?, store_id? }` | 직원별 지각 횟수·분, 조퇴, 결근, 인정 근무분 | 없음 |
| `detect_issues` | `{ date, store_id? }` | 이상 건 목록 (지각·조퇴·출퇴근 누락·결근 의심·대리 출퇴근 의심) | 없음 |
| `get_payroll_preview` | `{ month, employee_name?, store_id? }` | 기본급·연장 가산·주휴·합계·확인사항 (참고용) | **owner만** |
| `list_employees` | `{ store_id? }` | 이름·활성 여부 (시급은 owner에게만) | 필드 제한 |

규칙:
- `store_id`가 없으면 `ctx.storeIds`가 1개일 때 그 매장, 여러 개면 `need_store` 오류로 에이전트가 되묻게 한다. `ctx.storeIds` 밖의 값은 `forbidden`.
- `employee_name`은 부분 일치("민지" → "김민지"). 여러 명이면 `ambiguous_employee`와 후보 목록을 돌려준다.
- 날짜 인자는 `YYYY-MM-DD`만 받는다. "지난주" 같은 상대 표현은 에이전트가 `ctx.today` 기준으로 변환한다(시스템 프롬프트에 오늘 날짜 제공).
- 출력에 **전화번호·PIN·주소 등 답변에 불필요한 개인정보를 넣지 않는다.**
- 모든 출력에 `as_of`(조회 시각)와 `source: "퍼펙트근태관리"`를 포함한다.

MVP 코드 이식 (zip의 `src/lib`):

| MVP 파일 | 이식 위치 | 변경 |
| --- | --- | --- |
| `detect.ts` | `domain/detect.ts` | `Db` 대신 `AttendanceSource`에서 받은 배열로 동작하게 |
| `records.ts`, `settlement.ts`, `time.ts`, `parseTime.ts` | `domain/` | 그대로 + 매장 설정(5인 이상, 허용 분) 주입 |
| `ask.ts`의 `employeeStats` | `tools/get_period_stats.ts` | 규칙 답변 부분은 버림 (에이전트가 대신함) |
| `permissions.ts` | `apps/web/lib/agent/guard.ts` | 2단계 쓰기 도구에서 재사용, 이번엔 역할 제한만 |
| `seed.ts` | `adapter/FixtureSource.ts` | 테스트·로컬 개발용 데이터로 |
| `tests/*.test.ts` | `packages/connector-attendance/tests/` | 도구 단위 테스트로 재구성 |
| `store.ts`, 체크인·답변 화면, 발송함 | **버림** | 근태관리가 원천이므로 불필요 |

## 5. M1-a. 로그인과 권한

- 1단계는 **에이전트 DB의 Supabase Auth(이메일 매직링크)**로 시작한다. `agent_users` 테이블에 `role`, `store_ids`(근태관리의 store id)를 둔다. 베타 매장은 대표가 수동 등록한다.
- 근태관리 계정과의 SSO는 3-1 조사 후 결정한다(미결정 1번).
- 관리자(manager)는 `get_payroll_preview` 도구가 **도구 목록에서 아예 빠진다**(프롬프트로 막는 게 아니라 레지스트리에서 제외).

## 6. M1-b. 에이전트 DB 스키마 (`supabase/agent-schema.sql`)

```sql
create table agent_users (
  id uuid primary key references auth.users(id),
  display_name text not null,
  role text not null check (role in ('owner','manager')),
  store_ids text[] not null,
  created_at timestamptz default now()
);
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references agent_users(id),
  created_at timestamptz default now()
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','briefing')),
  content text not null,
  created_at timestamptz default now()
);
-- 감사 로그: 모든 도구 호출 (입력·출력 요약·소요시간·오류)
create table tool_calls (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete set null,
  user_id uuid not null,
  tool text not null,
  input jsonb not null,
  output_summary jsonb,
  error text,
  duration_ms int,
  created_at timestamptz default now()
);
create table store_settings (
  store_id text primary key,
  store_name text,
  grace_minutes int default 5,
  five_plus boolean default false,
  briefing_hour int default 8
);
create table briefings (
  store_id text not null,
  work_date date not null,
  body text not null,
  issues jsonb not null,
  created_at timestamptz default now(),
  primary key (store_id, work_date)
);
-- RLS: agent_users/conversations/messages는 본인 것만. tool_calls/briefings는 서버(service key)만 쓰기.
```

## 7. M1-c. 에이전트 루프

`apps/web/lib/agent/loop.ts`

1. 입력: 사용자 메시지 + 최근 대화 20턴 + `ToolContext`.
2. Claude Messages API 호출 (`ANTHROPIC_MODEL`, 기본값은 환경변수로) — `tools` = 레지스트리가 역할별로 필터링한 도구 목록.
3. `tool_use`가 오면: zod 검증 → 실행 → `tool_calls`에 기록 → 결과를 `tool_result`로 돌려줌. **최대 6회** 반복, 초과 시 "질문을 나눠서 물어봐 주세요".
4. 최종 텍스트를 스트리밍으로 화면에 보내고 `messages`에 저장.
5. 숫자 가드(`guard.ts`): 답변에 나온 숫자(시간·분·원·회)가 이번 턴 도구 결과에 없으면 로그에 `unverified_number`로 표시한다. 베타 동안에는 차단하지 않고 측정만 한다.

시스템 프롬프트 핵심 (`systemPrompt.ts`):

```
너는 {store_name}의 AI 매니저다. 사장님/관리자의 근태 질문에 답한다.
- 오늘은 {today}(KST)다. "어제", "지난주" 같은 표현은 이 날짜 기준으로 YYYY-MM-DD로 바꿔 도구에 넘긴다.
- 숫자(시간, 횟수, 금액)는 반드시 도구 결과에서만 가져온다. 계산이 필요하면 도구를 다시 호출한다. 추측하지 않는다.
- 도구가 오류를 주면 그대로 설명하고 필요한 정보를 되묻는다 (예: 직원 이름이 여러 명일 때).
- 급여 금액은 "참고용 계산"이라고 밝힌다. 확정은 퍼펙트근태관리 화면에서 한다.
- 기록 수정, 직원 메시지 발송은 아직 할 수 없다고 안내하고, 퍼펙트근태관리에서 하는 방법을 알려준다.
- 존댓말, 짧게(3~5문장), 이모지 없음. 목록은 3개 이상일 때만.
```

## 8. M1-d. 채팅 화면·아침 브리핑·평가

**채팅 화면** (`app/chat`): 모바일 우선. 상단 매장 선택(여러 매장일 때), 대화 영역, 하단 입력창, 입력창 위 추천 질문 칩("지금 누가 근무 중?", "어제 이상 있었어?", "이번 주 지각", "이번 달 근무시간"). 답변 아래 작은 회색 글씨로 "퍼펙트근태관리 기준 · 09:02 조회".

**아침 브리핑** (`app/api/cron/briefing`): Vercel Cron 매일 KST 08:00(UTC 23:00). 매장마다 `detect_issues(어제)` → LLM으로 5줄 이내 요약 → `briefings` 저장 → 해당 매장 사용자들의 대화에 `role='briefing'` 메시지로 추가. 이상 건이 없으면 "어제는 특이사항 없었어요" 한 줄. 크론 경로는 `CRON_SECRET` 헤더로 보호.

**평가 (완료 기준의 핵심)**: `evals/golden.json`에 질문 30개 + 기대 도구 호출 + 기대 숫자를 적는다. FixtureSource 데이터로 `npm run eval` 실행 시:
- 도구 선택 정확도 ≥ 90%
- 기대 숫자가 답변에 포함 ≥ 95%
- manager 계정으로 급여 질문 시 금액 노출 0건

예시:
```json
{ "q": "이번 달 지각 제일 많은 사람?", "role": "owner",
  "expect_tools": ["get_period_stats"], "expect_in_answer": ["김민지", "3"] }
{ "q": "민지 9월 급여 얼마야?", "role": "manager",
  "expect_tools": [], "expect_not_in_answer": ["원"] }
```

## 9. 이번 범위 밖 (다음 단계, 지금 만들지 말 것)

| 단계 | 내용 | 전제 |
| --- | --- | --- |
| M2 | 쓰기 요청 도구(`request_correction`, `request_staff_message`, `request_payroll_confirm`) → 에이전트 DB `approvals` → 승인 시 **근태관리에 새로 만드는 쓰기 API** 호출. MVP의 권한 매트릭스·되돌리기 재사용 | 근태관리에 API 추가 결정, 노무 자문 |
| M2 | 카카오 i 오픈빌더 챗봇 채널 (같은 `loop.ts` 재사용) | 채널 @perfectai 스킬 서버 설정 |
| M3 | CCTV 솔루션 별도 구축 (기존 `perfecteyes-handoff`의 web/algo 기반) | 파일럿 매장 NVR 확인 |
| M4 | CCTV 커넥터 = 원격 MCP 서버, `registry.ts`에 URL만 추가 | M3 완료 |

`registry.ts`는 처음부터 "커넥터 목록을 합쳐 도구 목록을 만든다"는 구조로 만들어 둔다. 이번엔 로컬 커넥터 1개뿐이지만, M4에서 원격 MCP 커넥터를 붙일 때 에이전트 루프를 고치지 않기 위해서다.

## 10. 환경변수 (`apps/web/.env.example`)

```
ATTENDANCE_DB_URL=postgres://agent_reader:...@...pooler.supabase.com:5432/postgres   # 읽기 전용
ATTENDANCE_SOURCE=fixture        # fixture | postgres
NEXT_PUBLIC_SUPABASE_URL=        # 에이전트 DB
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # 에이전트 DB 전용 (근태관리 키 아님!)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
CRON_SECRET=
```

## 11. CLAUDE.md 초안 (루트에 복사)

```md
# 퍼펙트 AI 매니저 — 작업 규칙

## 절대 규칙
- 퍼펙트근태관리 DB에는 쓰지 않는다. 연결은 agent_reader 역할, agent.v_* 뷰만. service_role 키를 근태관리용으로 쓰지 않는다.
- 도구의 매장 범위(storeIds)와 역할은 서버 세션에서만 온다. LLM 인자로 받지 않는다.
- 숫자 계산은 packages/connector-attendance/src/domain에서만. 에이전트 코드에서 근무시간·급여를 계산하지 않는다.
- 시각은 KST 벽시계 문자열(YYYY-MM-DD, HH:mm). Date 객체 타임존 변환은 domain/time.ts만 사용.
- 새 도구를 추가하면 zod 스키마 + 단위 테스트 + golden.json 질문 1개 이상을 같이 추가한다.

## 명령
- npm test -w packages/connector-attendance
- npm run eval -w apps/web     (ATTENDANCE_SOURCE=fixture)
- npm run build -w apps/web

## 범위
- 이번 범위: 조회 도구 6종, 웹 채팅, 아침 브리핑. 쓰기·카톡·CCTV는 HANDOFF.md §9 참고, 만들지 않는다.
```

## 12. 작업 순서와 완료 기준 (Claude Code 한 세션씩)

| # | 작업 | 완료 기준 |
| --- | --- | --- |
| 1 | 모노레포 생성, MVP `domain/` 이식, FixtureSource | 이식한 테스트 전부 통과 |
| 2 | 도구 6종 + zod + 단위 테스트 | 도구별 정상·오류(`need_store`, `ambiguous_employee`, `forbidden`) 테스트 통과 |
| 3 | 근태관리 스키마 조사 → `attendance-schema-map.md` | 대표 확인 (코드 수정 없음) |
| 4 | `attendance-readonly.sql` + PostgresSource | 대표가 SQL 적용 후, 실제 매장 1곳에서 `get_day_records` 결과가 근태관리 화면과 일치 |
| 5 | 에이전트 DB 스키마 + 매직링크 로그인 + 역할 | owner/manager 계정으로 도구 목록이 다르게 나옴 |
| 6 | 에이전트 루프 + 채팅 UI (스트리밍) | 로컬에서 추천 질문 4개 정상 답변 |
| 7 | 골든셋 30개 + `npm run eval` | §8 기준 충족 |
| 8 | 아침 브리핑 크론 | 수동 호출 시 브리핑 메시지 생성, 비밀키 없으면 401 |
| 9 | Vercel 배포 + 베타 매장 1곳 | 대표 휴대폰에서 로그인 → 질문 → 답변 |

## 13. 미결정 (대표 확인 필요)

1. 로그인: 에이전트 DB 매직링크로 시작 vs 근태관리 계정 연동 — 3-1 조사 후 결정
2. 근태관리에 스케줄 데이터가 있는가 (없으면 §3-3)
3. 베타 매장 선정 (직원 3명 이상, 스케줄 등록된 곳 권장)
4. `ANTHROPIC_MODEL` 기본값과 월 비용 상한
5. 매장 설정(5인 이상, 지각 허용 분)의 원천: 근태관리에 있는지, 에이전트 DB에 둘지

## 14. Claude Code 첫 프롬프트 (복사해서 쓰세요)

```
HANDOFF.md를 읽고 §2 구조로 모노레포를 만들어줘.
perfect-attendance-agent-mvp.zip을 풀어서 src/lib의 detect/records/settlement/time/parseTime을
packages/connector-attendance/src/domain으로 옮기고, seed.ts는 FixtureSource로 바꿔줘.
기존 테스트가 새 위치에서 모두 통과하는 것까지가 이번 세션 범위야.
근태관리 DB 연결과 채팅 화면은 아직 만들지 마.
```

## 15. 이 프로젝트의 작업 방식

- 서브에이전트나 한 세션이 만든 결과는 **다시 실행해서 검증**한다. 숫자는 근태관리 화면과 대조한다.
- 가정은 가정이라고 적는다(예: "스케줄 있음 가정"). 합성·시드 데이터 결과는 "시드 기준"이라고 쓴다.
- 결정마다 고른 이유와 버린 대안을 남긴다.
- CLAUDE.md는 실패에서 배운 규칙만, 60줄 이내로 유지한다.
