# 배포 가이드 (작업 #9)

퍼펙트 AI 매니저(에이전트)를 베타 매장 1곳에 올리는 런북. 세 시스템을 연결한다:
**에이전트 DB(Supabase, 신규) · 근태관리(Railway, 기존) · 에이전트 앱(Vercel, 신규).**

> 원칙: 근태관리 DB 는 절대 쓰지 않는다. 에이전트 DB 는 근태관리와 **별개 Supabase 프로젝트**다.

---

## 0. 사전 준비물
- 에이전트용 **새 Supabase 프로젝트** (근태관리와 분리)
- 근태관리 **Railway** 저장소 접근(읽기 라우트 추가·배포)
- **Vercel** 계정 + 이 모노레포를 담을 **GitHub** 저장소
- **ANTHROPIC_API_KEY** (크레딧 있는 것 — §미결정 4 모델·비용 상한 확정)

---

## 1. 에이전트 DB (Supabase 신규)

1. 새 프로젝트 생성 → **SQL Editor** 에서 `supabase/agent-schema.sql` 전체 실행 (테이블 6 + default_schedules + RLS).
2. **Authentication → Providers → Email** 활성화(매직링크). **URL Configuration** 에서
   - Site URL: `https://<앱도메인>` (예: `https://perfect-ai-manager.vercel.app`)
   - Redirect URLs 에 `https://<앱도메인>/auth/callback` 추가 (로컬 테스트하면 `http://localhost:3000/auth/callback` 도)
3. **매장 설정** 등록(SQL Editor, service_role):
   ```sql
   insert into store_settings (store_id, store_name, grace_minutes, five_plus, briefing_hour)
   values ('store_demo', '퍼펙트카페 판교점', 5, false, 8);
   ```
4. **기본 근무표**(스케줄 안 b — 지각·결근 판정용) 등록. `employee_id` 는 근태관리 id 와 동일해야 함(2단계에서 `/api/agent/employees` 로 확인):
   ```sql
   insert into default_schedules (store_id, employee_id, weekday, start_hm, end_hm) values
     ('store_demo','<emp id>',1,'09:00','18:00'), ('store_demo','<emp id>',2,'09:00','18:00');
   -- weekday 0=일 … 6=토. 미등록 시 지각류 도구는 "스케줄 등록 필요"로 응답.
   ```
5. **베타 사용자(대표) 등록** — 순서 주의:
   1) 앱 배포(3단계) 후 대표가 `/login` 에서 매직링크로 **1회 로그인** → `auth.users` 에 uid 생성
   2) SQL Editor: `select id, email from auth.users;` 로 uid 확인
   3) ```sql
      insert into agent_users (id, display_name, role, store_ids)
      values ('<uid>', '알렉스킴', 'owner', array['store_demo']);
      ```
   4) 앱 새로고침 → 홈에 역할별 도구 목록 표시(= 로그인·역할 동작 확인)
   - 관리자(manager) 는 `role='manager'` 로 넣으면 급여 도구가 목록에서 빠진다.

## 2. 근태관리 읽기 API (Railway 기존)
`integrations/README.md` 참고. 요약:
1. `integrations/attendance-agent-routes.ts` → 근태관리 `server/src/routes/agent.ts` 복사, `index.ts` 에서 `registerAgentRoutes(app, db)` 등록.
2. Railway Variables 에 `AGENT_READ_TOKEN=<강한 랜덤값>` 추가 → 배포.
3. 확인: `curl -H "x-agent-token: <TOKEN>" https://<근태관리>/api/agent/stores` → 매장 목록. `/api/agent/employees?store=store_demo` 로 employee id 확인(1-4단계에 사용).

## 3. 에이전트 앱 (Vercel)
- GitHub: **https://github.com/khj873-hub/perfect-ai-manager** (private, 푸시 완료).
- Vercel 프로젝트: **`perfect-ai-manager`** (id `prj_sFfWq70JAfAa9A2Dm3kgtKAgHyBn`, 팀 khj873-1573s-projects)
  가 이미 생성돼 있다(Root Directory `apps/web` 지정됨). **같은 이름으로 새로 만들지 말 것.**
  단, GitHub 저장소 **자동 연결이 실패**했다(Vercel 팀의 GitHub 통합이 이 private 저장소에 접근 권한 없음).

**대표가 대시보드에서 마무리:**
1. Vercel → 프로젝트 `perfect-ai-manager` → **Settings → Git** → **Connect** `khj873-hub/perfect-ai-manager`.
   - 요청 시 **Vercel GitHub App 을 khj873-hub 계정/저장소에 인가**(Install & Authorize). 이게 404의 원인.
2. **Settings → Build & Deployment** 에서 Root Directory = `apps/web` 확인. (transpilePackages 로 커넥터 TS 처리됨)
3. **Settings → Environment Variables** 에 §환경변수 체크리스트 전부 입력.
4. **Deploy**(Deployments → Redeploy 또는 main 에 푸시). 이후 main 푸시마다 자동 배포.
5. **Cron**: `apps/web/vercel.json` 의 `0 23 * * *`(UTC = KST 08:00) 자동 등록. `CRON_SECRET` 설정 시 Vercel 이 크론 호출에 `Authorization: Bearer` 를 붙인다.

> 환경변수 없이 배포해도 빌드는 통과하며 `/chat` 은 fixture 데모(MockLlm)로 동작한다(로그인·실데이터는 env 필요).

## 4. 스모크 테스트 (완료 기준)
1. 대표 휴대폰에서 `https://<앱도메인>/login` → 매직링크 로그인 → `/chat` 에서 추천 질문 4개 답변 확인.
2. **#4 대조**: `/chat` 에서 "어제 김민지 출근 시각?" 등 → 결과가 **근태관리 화면 숫자와 일치**하는지 확인.
3. **브리핑**: 수동 트리거 `curl -H "authorization: Bearer <CRON_SECRET>" https://<앱도메인>/api/cron/briefing` → 브리핑 생성 확인(다음날 08:00 자동).

---

## 환경변수 체크리스트

### 근태관리 (Railway)
| 변수 | 값 | 비고 |
|---|---|---|
| `AGENT_READ_TOKEN` | 강한 랜덤값 | 읽기 API 인증. 에이전트의 `ATTENDANCE_API_TOKEN` 과 동일 |

### 에이전트 앱 (Vercel) — `apps/web/.env.example` 기준
| 변수 | 필수 | 값 출처 |
|---|---|---|
| `ATTENDANCE_SOURCE` | ✅ | `http` (운영). 로컬 데모는 `fixture` |
| `ATTENDANCE_API_URL` | http일 때 | 근태관리 Railway URL |
| `ATTENDANCE_API_TOKEN` | http일 때 | 근태관리 `AGENT_READ_TOKEN` 과 동일 |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | 에이전트 Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 에이전트 Supabase anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 에이전트 Supabase service_role 키(서버 전용) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic 키(에이전트 응답) |
| `ANTHROPIC_MODEL` | 권장 | 미결정 4 — 모델·비용 상한 확정(미설정 시 기본값) |
| `CRON_SECRET` | ✅ | 강한 랜덤값. 브리핑 크론 보호 |
| `NEXT_PUBLIC_SITE_URL` | ✅ | `https://<앱도메인>` (매직링크 콜백) |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` 는 **에이전트 DB** 키다. **근태관리 키를 절대 여기 넣지 않는다.** 근태관리 접근은 오직 `ATTENDANCE_API_*`(읽기 API) 뿐이다.

---

## 롤백·장애 격리
- 근태관리 장애 → 에이전트는 읽기 API 실패로 해당 도구만 오류 응답(근태관리 데이터 자체는 안전).
- 에이전트 장애 → 근태관리는 무영향(별도 배포·DB).
- 키/토큰 유출 시: `AGENT_READ_TOKEN`·`CRON_SECRET`·Supabase 키 회전.
