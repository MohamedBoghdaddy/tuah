-- Phase 7 of the MongoDB -> Supabase Postgres migration: Support inquiries.
-- No foreign keys — simplest table in the migration.

create table if not exists support_inquiries (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  name          text not null,
  email         text not null,
  phone         text,
  type          text not null
    check (type in ('Order Issue','Delivery Question','Product Inquiry','Return / Exchange','Account Help','Trade Program','Other')),
  order_number  text,
  message       text not null,
  status        text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  source        text not null default 'support_portal' check (source in ('contact_page','support_portal','trade_program')),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists support_inquiries_updated_at on support_inquiries;
create trigger support_inquiries_updated_at
  before update on support_inquiries
  for each row execute function set_updated_at();

create index if not exists idx_support_inquiries_email_created_at on support_inquiries(email, created_at desc);
create index if not exists idx_support_inquiries_type_status on support_inquiries(type, status);
