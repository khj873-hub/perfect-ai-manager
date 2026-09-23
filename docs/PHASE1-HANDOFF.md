# 퍼펙트 AI 매니저 — 1단계(M0~M1) 완료 핸드오프

작성 기준: 조회 도구 6종 + 웹 채팅 + 아침 브리핑까지. 원 명세는 루트 `HANDOFF.md`.

## 30초 요약
운영 중인 **퍼펙트근태관리(Fastify+SQLite+Railway)** 를 **읽기 전용**으로 읽고, 사장님과 **웹 채팅**으로 대화하는 AI 매니저. "지금 누가 근무 중?", "이번 달 근무시간", "이번 달 급여 대략?"에 답하고 매일 아침 브리핑을 보낸다. **숫자는 도구(코드)가 계산, LLM 은 설명만.** 근태관리는 읽기 API 만 추가하고 나머지는 안 건드린다.

## 작업 현황 (원 명세 §12)
| # | 작업 | 상태 |
|---|---|---|
| 1 | 모노레포 + MVP 도메인 이식 + FixtureSource | ✅ |
| 2 | 조회 도구 6종 + zod + 단위 테스트 | ✅ |
| 3 | 근태관리 스키마 조사 → `docs/attendance-schema-map.md` | ✅ (스택 확정: Fastify+SQLite) |
| 4 | 실데이터 연결 (접근법 A: 읽기 API + HttpSource) | ✅ 코드 완료 · ⏳ 대표 배포+실매장 대조 대기 |
| 5 | 에이전트 DB 스키마 + 매직링크 로그인 + 역할 | ✅ |
| 6 | 에이전트 루프 + 채팅 UI(스트리밍) | ✅ |
| 7 | 골든셋 30 + `npm run eval` | ✅ 오프라인 PASS · ⏳ 실 Claude 수치는 크레딧 복구 후 |
| 8 | 아침 브리핑 크론 | ✅ |
| 9 | Vercel 배포 + 베타 매장 | ⏳ `docs/DEPLOY.md` 대로 대표 진행 |
| + | 기본 근무표(스케줄 안 b) | ✅ (근태관리에 스케줄 없어 추가 구현) |

## 구조
```
apps/web (Next.js 15, Vercel)
  ├─ app/           로그인(매직링크)·홈(역할별 도구)·/chat·/api/chat·/api/cron/briefing
  ├─ lib/agent/     loop · llm(Anthropic|Mock) · registry · systemPrompt · guard · briefing
  ├─ lib/db/        profiles · service · schedule
  └─ evals/         golden.json(30) · run.ts
packages/connector-attendance (순수 TS)
  ├─ domain/        detect·records·settlement·time·parseTime·types·permissions (숫자 계산은 여기서만)
  ├─ tools/         조회 도구 6종 + zod + 컨텍스트/에러
  └─ adapter/       AttendanceSource · FixtureSource · HttpSource · withDefaultSchedule · PostgresSource(B용)
supabase/           agent-schema.sql (에이전트 DB)
integrations/       attendance-agent-routes.ts (근태관리에 추가할 읽기 API)
docs/               attendance-schema-map · DEPLOY · PHASE1-HANDOFF
```
데이터 흐름: 근태관리 읽기 API → `HttpSource`(세션행→punch) → `withDefaultSchedule`(기본 근무표로 shifts 합성) → 도메인 계산 → 도구 → 에이전트 루프 → 채팅.

## 검증
- 커넥터 테스트 **42** (rules·detect·tools·httpSource·withDefaultSchedule), 웹 테스트 **13** (registry·loop·briefing) — 전부 통과.
- `npm run eval` 오프라인(MockLlm) **PASS**: 도구 선택 100% · 기대 문구 100% · manager 급여 노출 0.
- `next build` ✅ (7 라우트 + 미들웨어 + cron), 양 패키지 `tsc --noEmit` 0.
- 실 Claude: 채팅 4개 질문 HTTP 스모크 확인(초기), 브리핑 라우트 401/200 확인.

## 핵심 결정 (요약)
- 근태관리 = **Fastify+SQLite+Railway**(명세의 "Supabase"는 오기). SQLite 는 외부 직접 접속 불가 → **읽기 전용 HTTP API + HttpSource**(접근법 A).
- 근태관리에 **스케줄 테이블 없음** → 에이전트 DB `default_schedules` + `withDefaultSchedule` 로 지각·결근 판정(안 b). 미등록 매장은 `schedule_unavailable`.
- 매장 범위·역할은 **서버 세션(ctx)** 에서만. LLM 이 store_id 를 지어내지 못하도록 도구 스키마에서 store_id 제거.
- 급여 도구는 **owner 전용**(레지스트리 제외 + 실행 재확인). manager 급여 질문에 금액 노출 0(테스트).
- 숫자는 **domain/ 계산만**. 브리핑 요약도 결정적 템플릿(무료·재현).

## 대표 남은 액션
1. **#9 배포**: `docs/DEPLOY.md` (Supabase 신규 + agent-schema.sql, 근태관리 읽기 API+토큰, Vercel 배포+환경변수).
2. **#4 완료**: 배포 후 실매장 1곳에서 `get_day_records` 결과가 근태관리 화면과 일치하는지 대조.
3. **기본 근무표 등록**: `default_schedules` 에 매장별 근무표(안 b) — 지각/결근 판정 원하면.
4. **미결정 4**: `ANTHROPIC_MODEL` 기본값·월 비용 상한.
5. **크레딧**: 실 Claude 골든셋 재측정(`npm run eval`)은 API 크레딧 복구 후.

## 범위 밖(다음 단계, 원 명세 §9)
- **M2**: 쓰기 요청 도구(정정·직원 메시지·정산 확정) → 승인 → 근태관리 쓰기 API / 카카오 i 오픈빌더 채널
- **M3/M4**: CCTV 솔루션(별도 `perfecteyes`) → CCTV 커넥터를 `registry.ts` 에 추가 (레지스트리는 이미 커넥터 합성 구조)
- 지금 만들지 말 것. `registry.ts` 는 커넥터 목록을 합치는 구조로 이미 준비됨.
