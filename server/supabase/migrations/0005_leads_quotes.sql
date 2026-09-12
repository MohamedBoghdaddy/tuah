-- Phase 5 of the MongoDB -> Supabase Postgres migration: Leads + Quotes.
-- Depends on 0001_users_employees.sql (users table) and the existing
-- email_outbox table from the original bootstrap schema.sql.

create table if not exists leads (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text not null,
  phone                 text,
  company               text,
  project_type          text,
  source                text not null default 'admin',
  status                text not null default 'new'
    check (status in ('new','contacted','qualified','proposal','won','lost','archived')),
  priority              text not null default 'medium'
    check (priority in ('low','medium','high','urgent')),
  estimated_value       numeric(12,2) not null default 0 check (estimated_value >= 0),
  assigned_to           uuid references users(id),
  notes                 text default '',
  tags                  text[] not null default '{}',
  created_by            uuid references users(id),
  converted_customer_id uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at
  before update on leads
  for each row execute function set_updated_at();

create index if not exists idx_leads_email on leads(email);
create index if not exists idx_leads_status_created_at on leads(status, created_at desc);

create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid references leads(id),
  customer_id       uuid references users(id),
  customer_name     text,
  customer_email    text,
  project           text,
  quote_number      text not null unique,
  status            text not null default 'draft'
    check (status in ('draft','pending','sent','accepted','rejected','expired','converted','cancelled')),
  subtotal          numeric(12,2) not null default 0 check (subtotal >= 0),
  discount          numeric(12,2) not null default 0 check (discount >= 0),
  tax               numeric(12,2) not null default 0 check (tax >= 0),
  total             numeric(12,2) not null default 0 check (total >= 0),
  valid_until       timestamptz,
  notes             text default '',
  created_by        uuid references users(id),
  email_outbox_id   uuid references email_outbox(id),
  last_email_status text not null default 'none'
    check (last_email_status in ('none','queued','sent','failed','provider_not_configured')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists quotes_updated_at on quotes;
create trigger quotes_updated_at
  before update on quotes
  for each row execute function set_updated_at();

create index if not exists idx_quotes_lead_id on quotes(lead_id);
create index if not exists idx_quotes_customer_id on quotes(customer_id);
create index if not exists idx_quotes_status on quotes(status);

create table if not exists quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  name        text not null,
  description text default '',
  quantity    integer not null default 1 check (quantity >= 1),
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0),
  total       numeric(12,2) not null default 0 check (total >= 0),
  position    integer not null default 0
);

create index if not exists idx_quote_items_quote_id on quote_items(quote_id);
