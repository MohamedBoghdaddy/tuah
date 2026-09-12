-- Phase 4 of the MongoDB -> Supabase Postgres migration: Attendance + Leave.
-- Depends on 0001_users_employees.sql (employees table).

create table if not exists attendance_records (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references employees(id),
  employee_name          text,
  employee_email         text,
  department             text,
  date                   date not null,
  clock_in               timestamptz,
  clock_out              timestamptz,
  break_minutes          integer not null default 0 check (break_minutes >= 0),
  total_worked_minutes   integer not null default 0 check (total_worked_minutes >= 0),
  status                 text not null default 'present'
    check (status in ('present','absent','late','half_day','leave','holiday','remote')),
  source                 text not null default 'manual'
    check (source in ('manual','import','device','system')),
  notes                  text,
  approved_by            uuid references employees(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (employee_id, date)
);

drop trigger if exists attendance_records_updated_at on attendance_records;
create trigger attendance_records_updated_at
  before update on attendance_records
  for each row execute function set_updated_at();

create index if not exists idx_attendance_employee_id on attendance_records(employee_id);
create index if not exists idx_attendance_date on attendance_records(date);
create index if not exists idx_attendance_status on attendance_records(status);

create table if not exists leave_requests (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references employees(id),
  employee_name        text,
  employee_email       text,
  department           text,
  type                 text not null
    check (type in ('vacation','sick_leave','time_off','leave_early','unpaid_leave','remote_day','maternity_leave','paternity_leave','bereavement')),
  start_date           date not null,
  end_date             date not null,
  leave_early_time     text,
  hours_requested      numeric,
  reason               text,
  status               text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','escalated')),
  current_approver_id  uuid references employees(id),
  decided_by           uuid references employees(id),
  decided_at           timestamptz,
  rejection_reason     text,
  attachments          text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists leave_requests_updated_at on leave_requests;
create trigger leave_requests_updated_at
  before update on leave_requests
  for each row execute function set_updated_at();

create index if not exists idx_leave_requests_employee_id on leave_requests(employee_id);
create index if not exists idx_leave_requests_type on leave_requests(type);
create index if not exists idx_leave_requests_status on leave_requests(status);

create table if not exists leave_request_approval_steps (
  id               uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id) on delete cascade,
  step_name        text,
  assignee_id      uuid references employees(id),
  assignee_name    text,
  status           text not null default 'pending'
    check (status in ('pending','approved','rejected','skipped')),
  decided_at       timestamptz,
  comment          text,
  position         integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists idx_leave_approval_steps_request_id on leave_request_approval_steps(leave_request_id);
