-- 퍼펙트 AI 매니저 — 에이전트 DB 스키마 (HANDOFF §6)
-- 새 Supabase 프로젝트의 SQL Editor 에서 실행. 근태관리 DB 와 완전히 분리된 별도 프로젝트다.
-- 에이전트가 만드는 데이터(사용자·대화·로그·브리핑)만 여기 저장한다.

create table if not exists agent_users (
  id uuid primary key references auth.users(id),
  display_name text not null,
  role text not null check (role in ('owner','manager')),
  store_ids text[] not null,               -- 근태관리의 store id(slug) 목록
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references agent_users(id),
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','briefing')),
  content text not null,
  created_at timestamptz default now()
);

-- 감사 로그: 모든 도구 호출 (입력·출력 요약·소요시간·오류)
create table if not exists tool_calls (
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

create table if not exists store_settings (
  store_id text primary key,               -- 근태관리 store id(slug)
  store_name text,
  grace_minutes int default 5,             -- 지각 허용(분) — 근태관리에 없어 여기서 관리(§3-1)
  five_plus boolean default false,         -- 상시 5인 이상(연장 가산) — 근태관리에 없음
  briefing_hour int default 8
);

-- 매장별 기본 근무표 (스케줄 안 b) — 근태관리에 스케줄이 없어 지각·조퇴·결근 판정용으로 둔다.
-- employee_id 는 근태관리 employee id 와 동일해야 한다. weekday 0=일 … 6=토, 시각은 "HH:mm".
create table if not exists default_schedules (
  store_id    text not null,
  employee_id text not null,
  weekday     int  not null check (weekday between 0 and 6),
  start_hm    text not null,
  end_hm      text not null,
  primary key (store_id, employee_id, weekday)
);

create table if not exists briefings (
  store_id text not null,
  work_date date not null,
  body text not null,
  issues jsonb not null,
  created_at timestamptz default now(),
  primary key (store_id, work_date)
);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- agent_users/conversations/messages 는 본인 것만. tool_calls/briefings/store_settings 는
-- 서버(service_role 키)만 쓰기. 읽기는 본인·소속 매장 범위로 제한.
alter table agent_users   enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table tool_calls    enable row level security;
alter table store_settings enable row level security;
alter table briefings     enable row level security;
alter table default_schedules enable row level security;

-- 본인 프로필만 조회 (역할·store_ids 는 서버가 service_role 로 심는다)
create policy agent_users_self_select on agent_users
  for select using (id = auth.uid());

-- 대화: 본인 것만 CRUD
create policy conversations_own on conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 메시지: 본인 대화의 메시지만
create policy messages_own on messages
  for all using (conversation_id in (select id from conversations where user_id = auth.uid()))
  with check (conversation_id in (select id from conversations where user_id = auth.uid()));

-- 감사 로그: 본인 것 읽기만 허용, 쓰기는 service_role(RLS 우회)만
create policy tool_calls_own_select on tool_calls
  for select using (user_id = auth.uid());

-- 매장 설정·브리핑: 소속 매장만 읽기, 쓰기는 service_role 만
create policy store_settings_member_select on store_settings
  for select using (store_id = any (select store_ids from agent_users where id = auth.uid()));

create policy briefings_member_select on briefings
  for select using (store_id = any (select store_ids from agent_users where id = auth.uid()));

create policy default_schedules_member_select on default_schedules
  for select using (store_id = any (select store_ids from agent_users where id = auth.uid()));

-- 참고: service_role 키로 접근하면 RLS 를 우회하므로 tool_calls/briefings/store_settings 쓰기와
-- 브리핑 크론 삽입, agent_users 온보딩(대표 수동 등록)은 모두 서버에서 처리한다(§5·§6).
