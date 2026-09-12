-- Phase 1 of the MongoDB -> Supabase Postgres migration: Users, Employees, Auth.
-- Safe to run standalone (idempotent) against a project that already has the
-- bootstrap schema from server/supabase/schema.sql applied.
--
-- Scope note: `users.wishlist` (Mongo: ObjectId[] ref Product) is intentionally
-- NOT created here — products still live in MongoDB until the Products/Cart
-- migration phase. It will become a `wishlist_items` join table once
-- `products` exists in Postgres.

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── employees ────────────────────────────────────────────────────────────────
-- Created before `users` so `users.employee_id` can reference it directly.
-- `employees.user_id` -> users(id) is added via ALTER after `users` exists,
-- since the two tables reference each other.
create table if not exists employees (
  id                        uuid primary key default gen_random_uuid(),
  fname                     text not null,
  lname                     text not null,
  email                     text not null unique,
  department                text not null,
  job_title                 text,
  seniority_level           text,
  phone                     text,
  password                  text not null,
  role                      text not null default 'readonly'
    check (role in ('readonly','admin','manager','designer','operations','HR','accountant','super_admin')),
  permissions               text[] not null default '{}',
  denied_permissions        text[] not null default '{}',
  manager_id                uuid references employees(id),
  user_id                   uuid,
  level                     integer not null default 0,
  profile_photo_url         text,
  profile_photo_asset_id    text,
  status                    text not null default 'active'
    check (status in ('active','inactive','invited','suspended')),
  invited_at                timestamptz,
  invitation_email_status   text not null default 'none'
    check (invitation_email_status in ('none','pending','queued','sent','failed','provider_not_configured')),
  invitation_email_outbox_id text,
  supabase_auth_user_id     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists employees_updated_at on employees;
create trigger employees_updated_at
  before update on employees
  for each row execute function set_updated_at();

create index if not exists idx_employees_status on employees(status);
create index if not exists idx_employees_department on employees(department);

-- ── users ────────────────────────────────────────────────────────────────────
create table if not exists users (
  id                        uuid primary key default gen_random_uuid(),
  username                  text not null unique,
  email                     text not null unique,
  password                  text not null,
  gender                    text not null,
  first_name                text not null,
  middle_name               text,
  last_name                 text not null,
  role                      text not null default 'customer'
    check (role in ('customer','employee','manager','designer','operations','HR','accountant','admin','super_admin')),
  permissions               text[] not null default '{}',
  denied_permissions        text[] not null default '{}',
  department                text,
  manager_id                uuid references users(id),
  employee_id               uuid references employees(id),
  level                     integer not null default 0,
  receive_notifications     boolean not null default true,
  profile_photo             text,
  profile_photo_url         text,
  profile_photo_asset_id    text,
  job_title                 text,
  seniority_level           text,
  phone                     text,
  status                    text not null default 'active'
    check (status in ('active','inactive','invited','suspended')),
  invited_at                timestamptz,
  invitation_email_status   text not null default 'none'
    check (invitation_email_status in ('none','pending','queued','sent','failed','provider_not_configured')),
  invitation_email_outbox_id text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists users_updated_at on users;
create trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

create index if not exists idx_users_role on users(role);

-- Now that `users` exists, wire up the other half of the users <-> employees link.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'employees_user_id_fkey'
  ) then
    alter table employees
      add constraint employees_user_id_fkey
      foreign key (user_id) references users(id);
  end if;
end $$;
