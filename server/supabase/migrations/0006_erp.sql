-- Phase 6 of the MongoDB -> Supabase Postgres migration: ERP.
-- Depends on 0001_users_employees.sql (users, employees tables).

create table if not exists erp_apps (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  layer             text not null check (layer in ('primary','secondary','optional')),
  icon              text default 'apps',
  purpose           text default '',
  depends_on        text[] not null default '{}',
  used_by           text[] not null default '{}',
  main_tables       text[] not null default '{}',
  connected_tables  text[] not null default '{}',
  workflow_summary  text default '',
  status            text not null default 'planned'
    check (status in ('active','planned','static','api-connected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists erp_apps_updated_at on erp_apps;
create trigger erp_apps_updated_at before update on erp_apps for each row execute function set_updated_at();

-- departments/erp_employees reference each other — create both, then ALTER.
create table if not exists departments (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  code                   text not null unique,
  description            text default '',
  manager_id             uuid,
  parent_department_id   uuid references departments(id),
  status                 text not null default 'active' check (status in ('active','inactive')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists departments_updated_at on departments;
create trigger departments_updated_at before update on departments for each row execute function set_updated_at();

create table if not exists job_positions (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  code              text not null unique,
  level             text not null check (level in ('executive','manager','team_lead','senior','junior','intern')),
  department_id     uuid references departments(id),
  description       text default '',
  permissions_role  text default 'viewer',
  status            text not null default 'active' check (status in ('active','inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists job_positions_updated_at on job_positions;
create trigger job_positions_updated_at before update on job_positions for each row execute function set_updated_at();

create table if not exists erp_employees (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references users(id),
  full_name         text not null,
  email             text not null,
  phone             text default '',
  avatar            text default '',
  employee_code     text not null unique,
  level             text not null check (level in ('executive','manager','team_lead','senior','junior','intern')),
  department_id     uuid references departments(id),
  job_position_id   uuid references job_positions(id),
  manager_id        uuid references erp_employees(id),
  status            text not null default 'active' check (status in ('active','inactive','invited')),
  assigned_modules  text[] not null default '{}',
  hire_date         date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists erp_employees_updated_at on erp_employees;
create trigger erp_employees_updated_at before update on erp_employees for each row execute function set_updated_at();

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'departments_manager_id_fkey') then
    alter table departments add constraint departments_manager_id_fkey foreign key (manager_id) references erp_employees(id);
  end if;
end $$;

create table if not exists erp_integration_status (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  status      text not null default 'not_configured'
    check (status in ('active','not_configured','degraded','error')),
  message     text default '',
  checked_at  timestamptz,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists erp_integration_status_updated_at on erp_integration_status;
create trigger erp_integration_status_updated_at before update on erp_integration_status for each row execute function set_updated_at();

create table if not exists erp_schema_relations (
  id            uuid primary key default gen_random_uuid(),
  app_slug      text not null,
  from_table    text not null,
  from_field    text not null,
  to_table      text not null,
  to_field      text not null,
  relation_type text not null
    check (relation_type in ('one-to-one','one-to-many','many-to-one','many-to-many','self-reference')),
  description   text default '',
  status        text not null default 'active' check (status in ('active','planned','deprecated')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_erp_schema_relations_app_from on erp_schema_relations(app_slug, from_table);

-- ── Approvals ──────────────────────────────────────────────────────────────────

create table if not exists approval_requests (
  id                     uuid primary key default gen_random_uuid(),
  title                  text,
  request_type           text not null,
  employee_id            uuid references employees(id),
  current_approver_id    uuid references employees(id),
  employee_name          text default '',
  current_approver_name  text default '',
  requested_by           text default '',
  department             text default '',
  status                 text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','escalated')),
  priority               text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  description            text default '',
  amount                 numeric,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists approval_requests_updated_at on approval_requests;
create trigger approval_requests_updated_at before update on approval_requests for each row execute function set_updated_at();

-- Embedded ApprovalRequest.steps[] from the Mongoose model.
create table if not exists approval_request_steps (
  id                  uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references approval_requests(id) on delete cascade,
  step_name           text,
  assignee            text,
  assignee_id         uuid references employees(id),
  status              text not null default 'pending' check (status in ('pending','approved','rejected','skipped')),
  position            integer not null default 0
);

create index if not exists idx_approval_request_steps_request_id on approval_request_steps(approval_request_id);

-- Standalone ApprovalStep collection — a separate audit-log-style approval
-- chain distinct from the embedded steps above (pre-existing redundancy
-- carried over from Mongo, not introduced by this migration).
create table if not exists approval_steps (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid references approval_requests(id),
  step_order    integer not null,
  approver_id   uuid references erp_employees(id),
  approver_role text default '',
  status        text not null default 'pending' check (status in ('pending','approved','rejected','skipped')),
  approved_at   timestamptz,
  rejected_at   timestamptz,
  notes         text default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_approval_steps_request_id on approval_steps(request_id);
