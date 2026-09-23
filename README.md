# 퍼펙트 AI 매니저

운영 중인 **퍼펙트근태관리**(Fastify + SQLite, Railway)를 **읽기 전용**으로 읽고, 사장님·관리자와
**웹 채팅**으로 대화하는 AI 매니저. "지금 누가 근무 중?", "이번 주 지각", "이번 달 급여 대략?"에
답하고, 매일 아침 전날 근태 브리핑을 보낸다. 숫자는 도구(코드)가 계산하고 LLM 은 설명만 한다.

## 구조 (npm workspaces 모노레포)
- `packages/connector-attendance` — 순수 TS 도메인 로직 + 조회 도구 6종 + 데이터 소스 어댑터
- `apps/web` — Next.js 15 채팅 앱 + 에이전트 루프 + 아침 브리핑 크론
- `supabase/agent-schema.sql` — 에이전트 DB(근태관리와 분리)
- `integrations/` — 근태관리에 추가할 읽기 전용 API

## 명령
```bash
npm install
npm test                 # 커넥터 + 웹 단위 테스트
npm run eval -w @perfect-ai-manager/web   # 골든셋 평가
npm run build -w @perfect-ai-manager/web  # Next 빌드
npm run dev  -w @perfect-ai-manager/web   # 로컬 (키 없으면 MockLlm, fixture 데이터)
```

## 문서
- 배포: [`docs/DEPLOY.md`](docs/DEPLOY.md) · 1단계 요약: [`docs/PHASE1-HANDOFF.md`](docs/PHASE1-HANDOFF.md)
- 근태관리 연동: [`integrations/README.md`](integrations/README.md) · 스키마: [`docs/attendance-schema-map.md`](docs/attendance-schema-map.md)
- 작업 규칙: [`CLAUDE.md`](CLAUDE.md) · 원 명세: [`HANDOFF.md`](HANDOFF.md)
