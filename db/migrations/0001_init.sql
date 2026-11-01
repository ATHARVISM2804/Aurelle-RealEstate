-- Aurelle: projects, chat, leads, bookings, dashboard auth.
-- Every business row carries project_id; projects belong to an org, so client #2 is data, not code.
-- Enumerations are text + CHECK (easier to migrate than Postgres enums).

create extension if not exists pg_trgm;
create extension if not exists citext;

-- ---------- orgs, projects, facts, inventory ----------
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  slug text not null,
  name text not null,
  timezone text not null default 'Asia/Dubai',
  currency text not null default 'AED',
  settings jsonb not null default '{}',
  active_facts_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);
create unique index projects_slug on projects(slug);

create table project_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  version int not null,
  facts jsonb not null,
  allowed_numbers jsonb not null default '[]',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
alter table projects add constraint projects_active_facts_fk foreign key (active_facts_id) references project_facts(id);

create table units (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  code text not null,                 -- "08-C", "15-P2"
  level int not null,
  plan text not null,                 -- INVENTORY.from key: oneBhk, twoBhk, ...
  name text not null,                 -- "1 BHK", "3 BHK Penthouse"
  type text,                          -- "Typical" / "Penthouse"
  position text,                      -- "North-east corner"
  areas jsonb not null default '{}',  -- {apartment, balcony, total} sq ft
  price_from numeric,
  status text not null default 'available' check (status in ('available','reserved','sold')),
  plan_img text,
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);
create index units_lookup on units(project_id, plan, status, level);

-- ---------- dashboard users + auth ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null,
  password_hash text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table memberships (
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  role text not null check (role in ('owner','manager','agent','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);
create index memberships_project on memberships(project_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  email citext not null,
  role text not null check (role in ('owner','manager','agent','viewer')),
  token_hash bytea not null unique,
  invited_by uuid references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash bytea not null unique,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_user on auth_sessions(user_id);

-- ---------- leads ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text,
  phone_e164 text,
  email citext,
  lang text,
  source text, medium text, campaign text,
  attribution jsonb not null default '{}',   -- utm_*, fbclid/fbc/fbp, gclid, referrer, landing
  fields jsonb not null default '{}',        -- {budget:{value,min,max,source:'ai'|'rep'|'form',evidence}, ...}
  is_broker boolean not null default false,
  stage text not null default 'new'
    check (stage in ('new','contacted','qualified','visit_booked','visited','negotiation','booked','lost')),
  stage_changed_at timestamptz not null default now(),
  lost_reason text,
  owner_id uuid references users(id),
  score int not null default 0,
  band text not null default 'cold' check (band in ('hot','warm','cold')),
  score_reasons jsonb not null default '{}',
  one_liner text,
  next_action text,
  first_response_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index leads_phone on leads(project_id, phone_e164) where phone_e164 is not null and deleted_at is null;
create index leads_band on leads(project_id, band, last_activity_at desc);
create index leads_stage on leads(project_id, stage, stage_changed_at);
create index leads_owner on leads(project_id, owner_id);
create index leads_created on leads(project_id, created_at);

create table lead_reads (
  user_id uuid not null references users(id),
  lead_id uuid not null references leads(id),
  read_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);
create index lead_reads_lead on lead_reads(lead_id);

create table lead_scores (
  id bigserial primary key,
  lead_id uuid not null references leads(id),
  score int not null, band text not null,
  fit int, intent int, reach int,
  reasons jsonb not null default '{}',
  inputs_hash text,
  created_at timestamptz not null default now()
);
create index lead_scores_lead on lead_scores(lead_id, created_at);

-- ---------- visitors, chat, behaviour ----------
create table visitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  anon_id text not null,
  first_touch jsonb not null default '{}',
  last_touch jsonb not null default '{}',
  sessions_7d int not null default 1,
  lead_id uuid references leads(id),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (project_id, anon_id)
);
create index visitors_lead on visitors(lead_id);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  visitor_id uuid not null references visitors(id),
  lead_id uuid references leads(id),
  token_hash bytea not null,
  ref_code text not null unique,
  lang text,
  facts_version int,
  model text,
  status text not null default 'open' check (status in ('open','closed')),
  turnstile_at timestamptz,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  user_msgs int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_micros bigint not null default 0,
  guardrail_hits int not null default 0,
  summarized_at timestamptz,
  flagged boolean not null default false,
  ip_hash text
);
create index chat_sessions_recent on chat_sessions(project_id, last_message_at desc);
create index chat_sessions_lead on chat_sessions(lead_id);
create index chat_sessions_visitor on chat_sessions(visitor_id);
create index chat_sessions_started on chat_sessions(project_id, started_at);

create table messages (
  id bigserial primary key,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  project_id uuid not null references projects(id),
  role text not null check (role in ('user','assistant','tool','note','agent')),
  content text not null default '',
  content_redacted text,
  cards jsonb,
  tool_calls jsonb,
  guardrail jsonb,
  tokens_in int, tokens_out int, latency_ms int,
  client_id uuid,
  created_at timestamptz not null default now(),
  unique (session_id, client_id)
);
create index messages_session on messages(session_id, id);

create table events (
  id bigserial primary key,
  project_id uuid not null references projects(id),
  visitor_id uuid not null references visitors(id) on delete cascade,
  session_id uuid references chat_sessions(id) on delete set null,
  type text not null,
  props jsonb not null default '{}',
  url text,
  at timestamptz not null default now()
);
create index events_visitor on events(visitor_id, at);
create index events_type on events(project_id, type, at);
create index events_session on events(session_id) where session_id is not null;

create table summaries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  model text,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index summaries_lead on summaries(lead_id, created_at desc);
create index summaries_session on summaries(session_id, created_at desc);

-- append-only: one row per purpose per decision, with the exact text shown
create table consents (
  id bigserial primary key,
  project_id uuid not null references projects(id),
  lead_id uuid references leads(id),
  visitor_id uuid references visitors(id),
  purpose text not null check (purpose in ('call','whatsapp','email','marketing')),
  granted boolean not null,
  text_version text not null,
  text_snapshot text not null,
  source text not null check (source in ('chat','form','dashboard')),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index consents_lead on consents(lead_id, purpose, created_at desc);

-- ---------- booking ----------
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  kind text not null check (kind in ('site_visit','video_call')),
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_local time not null,
  end_local time not null,
  slot_minutes smallint not null default 45,
  capacity smallint not null default 1,
  location text,
  valid_from date,
  valid_to date
);
create index availability_rules_project on availability_rules(project_id, kind);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  kind text check (kind in ('site_visit','video_call')),        -- null = both
  date date not null,
  closed boolean not null default true,
  start_local time, end_local time,
  note text
);
create index availability_exceptions_project on availability_exceptions(project_id, date);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  lead_id uuid not null references leads(id),
  session_id uuid references chat_sessions(id) on delete set null,
  kind text not null check (kind in ('site_visit','video_call')),
  unit_code text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  seat smallint not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','reminded','checked_in','done','no_show','cancelled','rescheduled')),
  assigned_to uuid references users(id),
  manage_token_hash bytea not null,
  ics_seq int not null default 0,
  reminded_at timestamptz,
  outcome_note text,
  created_via text not null check (created_via in ('chat','dashboard','form')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- the real double-booking guard: one active booking per seat per slot
create unique index bookings_seat on bookings(project_id, kind, starts_at, seat)
  where status in ('confirmed','reminded','checked_in');
create index bookings_time on bookings(project_id, starts_at);
create index bookings_lead on bookings(lead_id);
create index bookings_session on bookings(session_id) where session_id is not null;
create index bookings_token on bookings(manage_token_hash);
create index bookings_due on bookings(starts_at) where status = 'confirmed' and reminded_at is null;
create index bookings_created on bookings(project_id, created_at);

-- ---------- dashboard collaboration ----------
create table notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index notes_lead on notes(lead_id, created_at);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  lead_id uuid references leads(id),
  user_id uuid references users(id),
  kind text not null check (kind in ('hot_lead','human_requested','booking','booking_changed','no_show','cap')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create index alerts_project on alerts(project_id, created_at desc);
create index alerts_lead on alerts(lead_id);

create table saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  name text not null,
  filters jsonb not null default '{}',
  position int not null default 0
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count bigint not null default 0,             -- bigint: the spend counter stores micro-dollars
  primary key (key, window_start)
);
create index rate_limits_window on rate_limits(window_start);

create table audit_log (
  id bigserial primary key,
  org_id uuid,
  project_id uuid,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  ip_hash text,
  at timestamptz not null default now()
);
create index audit_log_project on audit_log(project_id, at desc);
create index audit_log_entity on audit_log(entity, entity_id);

-- hook for later phases (Meta Conversions API, WhatsApp Business); nothing writes here yet
create table integration_outbox (
  id bigserial primary key,
  project_id uuid not null references projects(id),
  kind text not null check (kind in ('meta_capi','whatsapp')),
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
