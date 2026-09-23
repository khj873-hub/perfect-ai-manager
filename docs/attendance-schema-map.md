# 퍼펙트근태관리 스키마 조사 → 커넥터 표준 매핑 (작업 #3, 초안)

- 목적: HANDOFF §3-1 — 근태관리 실제 스키마를 **읽기만** 해서 커넥터 표준 필드에 매핑. 이 표가 확정돼야 뷰(§3-2)를 만든다.
- 상태: **초안 — 대표 확인 필요.** 코드 수정 없음(읽기 전용 조사).
- 조사 대상: 로컬 `Desktop/Agent_AI/perfect-attendance-edu` (`server/src/db.ts` 스키마 정의 + `routes/*`).

> ✅ **스택 확정 (2026-09-24 재확인)**: 퍼펙트근태관리는 **Fastify + better-sqlite3(SQLite) + Railway** 다.
> (`server/src/db.ts` better-sqlite3, DB=`../data/attendance.db`; `railway.json` NIXPACKS; deps 에 pg/postgres/supabase 없음. 인증=PIN + 선택 Google OAuth.)
> HANDOFF §0 의 "Next.js + Supabase" 표기는 **오기**였다. 아래 스키마(§1·§2)는 실제 db.ts 기준이라 **매핑은 확정**이다.
>
> 🔴 **바뀌는 것 — 접근 방식 (§3-2 전면 수정 필요, 대표 결정 1순위)**
> HANDOFF §3-2 는 Postgres 전제(`agent_reader` **역할**, `agent.v_*` **스키마/뷰**, **Session pooler** 연결, `statement_timeout`)인데 **SQLite 에는 역할·스키마·네트워크 접속이 없다.** 별도 앱(에이전트)이 Railway 안 SQLite 파일에 읽기 전용으로 직접 붙는 건 불가능하다. → **§3-A 접근법 결정** 참조.

---

## 1. 발견한 테이블 (edu / SQLite 기준)

| 테이블 | 핵심 컬럼 | 커넥터에서의 의미 |
|---|---|---|
| `businesses` | id, **slug**(unique), name, manager_pin, owner_user_id→users, lat/lng/radius_meters, home_mode, time_off_enabled, leave_pay_calc_mode, weekly_holiday_includes_leave, **weekly_holiday_threshold_hours**(기본15), **week_start_day**(기본1=월) | **매장(store/사업장)**. 다점포=여러 row, 식별자는 `slug`(text) |
| `users` | id, provider(google/kakao), provider_id, email, name, last_login_at | 로그인 사용자(사장). `businesses.owner_user_id`로 매장 소유 |
| `employees` | id, **business_id**→businesses, name, **hourly_rate**(기본10320), color, access_token, pay_enabled, pay_includes_holiday, created_at | **직원**. ⚠️ active/퇴사 컬럼 없음, phone/pin 없음 |
| `attendance` | id, **employee_id**, **clock_in**(TEXT), **clock_out**(TEXT, nullable), memo, created_at | **출퇴근** — ⚠️ **세션행**(한 행에 in+out), punch(in/out 별도 행) 아님 |
| `time_off` | employee_id, date, type(annual/unpaid/sick/family), portion, half_period | 휴가. 급여 계산에 관련(연차/무급 등) |
| `sessions` | token, slug, expires_at | 로그인 세션 |

---

## 2. 커넥터 표준 필드 매핑 (HANDOFF §3-1 표)

| 커넥터 표준 필드 | 근태관리 실제 (edu 기준) | 비고 / 대표 확인 |
|---|---|---|
| store: id, name | `businesses.slug`(id로 사용 권장), `businesses.name` | id는 INTEGER `businesses.id`도 있으나 **텍스트 `slug`가 store_id로 적합**. 다점포 구조 O(현재 기본 단일 `slug='default'`). **운영도 slug 체계인지 확인** |
| employee: id, store_id, name, hourly_wage, active | `employees.id`, `employees.business_id`, `employees.name`, `employees.hourly_rate`, **active=??** | ⚠️ **active/deleted_at 컬럼 없음** — 퇴사 처리는 **하드 DELETE**(`DELETE FROM employees`). 즉 "비활성 직원" 개념이 없음. → 뷰에서 `active=true` 고정할지, 운영에 소프트삭제가 있는지 **확인 필요** |
| shift: employee_id, date, start, end | **없음 (스케줄/근무표 테이블 자체가 없음)** | 🔴 **§3-3 발동.** grep 결과 schedule/shift/근무표 개념 전무. → **지각·조퇴·결근·오늘 근무예정 판정 불가**(§4 참조) |
| punch: employee_id, type(in/out), at, device | `attendance` (clock_in + clock_out **한 행**), **type 없음**, **device 없음** | ⚠️ 모델 불일치: 커넥터/도메인은 in·out **별도 행 + type**. → 뷰/PostgresSource(작업#4)에서 세션행을 in/out 두 행으로 펼치거나 도메인을 세션 모델로 조정. **device 없음 → 대리 출퇴근(proxy_suspect) 감지 불가** |
| owner/manager 계정 → store 매핑 | owner=`users`(OAuth)+`businesses.owner_user_id`; manager=`businesses.manager_pin`(PIN, 개별 계정 아님) | §5 로그인 연동(미결정 1)에 직접 영향. 운영도 OAuth(google/kakao)+PIN 구조인지 확인 |
| 급여 설정: 5인 이상 여부, 휴게 규칙 | `businesses`에 **fivePlus 없음, grace_minutes 없음**. 있는 것: weekly_holiday_threshold_hours, week_start_day, leave_pay_calc_mode | 🔴 커넥터 도메인이 쓰는 `store.fivePlus`·`store.graceMinutes` **원천 없음** → **에이전트 DB `store_settings`로**(미결정 5) |

---

## 3. 시각·형식 (뷰 설계 §3-2 에 직접 영향)

- `attendance.clock_in`/`clock_out`: `new Date(Date.now()+9h).toISOString().replace('T',' ').slice(0,19)` → **`"YYYY-MM-DD HH:MM:SS"` KST 벽시계 TEXT** (타임존 접미사 없음), 초 단위. 날짜 필터는 `clock_in LIKE 'YYYY-MM%'`.
- `created_at`: `datetime('now','localtime')` (KST 로컬).
- **함의**: HANDOFF §3-2 의 뷰 예시는 `timestamptz` + `at time zone 'Asia/Seoul'` 변환을 가정한다. **edu는 이미 KST 로컬 문자열이라 변환이 불필요**하다. 운영이 Supabase(`timestamptz`)라면 §3-2 뷰대로 변환, edu식(로컬 TEXT)이면 그대로 노출. → **운영의 시각 저장 타입 확인 필수.**
- 커넥터 도메인은 날짜 `YYYY-MM-DD`, 시각 `HH:mm`(분)만 사용 → 초 단위는 뷰에서 `HH:mm`로 잘라준다.

---

## 4. 커넥터 도구에 미치는 영향 (스케줄 부재가 핵심)

현재 도구(작업 #2)와 대조:

| 도구 | 스케줄 없이 동작? | 비고 |
|---|---|---|
| `list_employees` | ✅ | employees 그대로 |
| `get_day_records` (출퇴근·인정근무분) | ⚠️ 부분 | clock_in/out은 있음. 단 **"예정"(shift) 없음** → scheduled=null, 인정근무분은 스케줄 없이 전체 근무로 계산할지 정책 필요 |
| `get_today_status` (근무중/예정) | ⚠️ 부분 | "근무중/퇴근"은 attendance로 가능, **"예정"은 스케줄 없어 불가** |
| `get_period_stats` (지각·조퇴·결근) | 🔴 | 지각·조퇴·결근은 **전부 스케줄 대비 판정** → 스케줄 없으면 `schedule_unavailable`. 근무시간 합계만 가능 |
| `detect_issues` | 🔴 | late/early/absent/missing 전부 스케줄 의존. **대리(proxy)는 device 없어 불가**. 스케줄 없으면 사실상 빈 결과/`schedule_unavailable` |
| `get_payroll_preview` | ⚠️ | 근무시간 기반 계산은 가능하나, 도메인 정산이 shift(주 소정근로)로 주휴를 계산 → 스케줄 없으면 주휴 산정 방식 재정의 필요 |

→ **스케줄 데이터가 근태관리에 없다는 사실이 M0~M1 기능 범위를 좌우한다.** 도구 자체는 이미 `schedule_unavailable`을 반환하도록 설계돼 있음(작업 #2).

---

## 3-A. 접근 방식 결정 — SQLite 를 에이전트가 어떻게 읽나 (대표 결정 1순위)

SQLite 는 로컬 파일이라 외부 앱이 직접 못 붙는다. 세 가지 안:

| 안 | 내용 | 근태관리 변경 | 평가 |
|---|---|---|---|
| **A. 읽기 전용 HTTP API** | 근태관리 Fastify 에 `/api/agent/*` 읽기 전용 엔드포인트(agent 토큰 인증, PII 제외) 추가 → 커넥터에 `HttpSource`(fetch 기반 AttendanceSource) 구현 | 소(읽기 라우트 몇 개 추가) | **권장**. SQLite 로컬 파일엔 이게 가장 현실적·안전. HANDOFF 의 "뷰만 추가"는 Postgres 전제라 불가하니, 최소 개입 대안 |
| B. Railway Postgres 로 이전 | 근태관리 DB 를 SQLite→Postgres 로 마이그레이션 후 원래 §3-2(agent_reader+뷰) 적용. 이 경우 `PostgresSource`(이미 작성됨) 사용 | 대(마이그레이션) | MVP 엔 과함. 다점포·규모 커지면 재검토 |
| C. SQLite 파일 복제/스냅샷 | Railway 볼륨의 db 파일을 주기 복제해 에이전트가 읽음 | 소 | 취약·지연·정합성 문제. 비권장 |

- **A 선택 시**: 이미 만든 `PostgresSource` 대신 `HttpSource` 를 커넥터에 추가한다(같은 AttendanceSource 인터페이스라 도구·루프는 그대로). 근태관리에 붙일 읽기 라우트 스펙(매장·기간 필터, PII 제외, agent 토큰)은 A 확정 후 설계.
- **B 선택 시**: `PostgresSource` + `attendance-readonly.sql`(뷰) 그대로 진행.

## 5. 대표 확인 요청

1. **접근 방식 A/B/C 중 무엇?** (§3-A) — 권장 A(읽기 전용 HTTP API). 이게 정해져야 #4 착수 가능.
2. **스케줄(근무표) 데이터가 있습니까?** SQLite 조사 결과 **스케줄 테이블 없음**(§3-3 발동).
   → **안 b 구현 완료**: 에이전트 DB `default_schedules`(store_id·employee_id·weekday·start·end) + 커넥터 `withDefaultSchedule` 래퍼가 조회 윈도우에 펼쳐 shifts 합성 → 지각·조퇴·결근 판정 가능. **매장별 기본 근무표를 등록하면** 작동, 미등록이면 `schedule_unavailable`(안 a). 대표 확인: 이 방식으로 갈지 + 매장별 기본 근무표 값(요일×직원×시간).
   - 있으면: 테이블·컬럼을 알려주세요 → shift 매핑 완성, 지각/조퇴/결근/예정 도구 정상화.
   - 없으면(edu처럼): (a) 지각류 도구가 `schedule_unavailable` 반환 + 에이전트가 "스케줄 등록 필요" 안내, **또는** (b) 에이전트 DB에 매장별 기본 근무표(요일×직원×시간)를 두기 — 어느 쪽으로 갈지.
3. **직원 active/퇴사 표시 방식** — 운영에 소프트삭제(`deleted_at` 등)가 있나요? 없으면 뷰의 `active`는 true 고정.
4. **로그인 연동** (미결정 1) — 에이전트는 매직링크로 시작하되, 근태관리 OAuth(google/kakao)/PIN과 SSO 여부. `owner_user_id`↔에이전트 사용자 매핑을 쓸지.
5. **매장 설정 원천** (미결정 5) — `graceMinutes`(지각 허용 분)·`fivePlus`(5인 이상)는 근태관리에 없음. 에이전트 DB `store_settings`에 두는 것으로 확정해도 될지. (근태관리엔 weekly_holiday_threshold_hours·week_start_day가 있으니 정산 시 참고 가능)
6. **출퇴근 모델** — attendance가 세션행(clock_in+clock_out 한 행)입니다. 뷰에서 in/out 두 행으로 펼쳐 커넥터 punch 모델에 맞출지, 아니면 도메인을 세션 모델로 바꿀지(작업 #4 설계). 하루 다중 세션(휴게 후 재출근) 허용 여부도 확인.
7. **대리 출퇴근 감지** — attendance에 device 정보가 없어 proxy_suspect 불가. 이 이상탐지는 제외할지, 향후 CCTV(M3+)로 넘길지.

---

## 6. 다음 단계 (접근법 확정 후)

- **A(HTTP API) 확정 시**: 근태관리 Fastify 에 agent 읽기 라우트 추가(대표) → 커넥터에 `HttpSource` 구현 → 레지스트리 배선 → 실매장 1곳 `get_day_records` 대조. (`PostgresSource`·`attendance-readonly.sql` 은 미사용/보류)
- **B(Postgres 이전) 확정 시**: `attendance-readonly.sql`(agent_reader 역할 + `agent.v_*` 뷰) 확정 → `PostgresSource`(이미 있음) 연결 → 대조.
- 어느 쪽이든 **스케줄 유무(§5-2) 결정**이 지각류 도구 동작 범위를 정하므로 착수 전 필수.
- HANDOFF §3-1 규칙(뷰는 확정 후) 유지 — 접근법·스케줄 미확정 상태에서 SQL/소스 배선을 만들지 않는다.
