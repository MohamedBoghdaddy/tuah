-- Phase 8 prerequisite for the MongoDB -> Supabase Postgres migration:
-- customer addresses + payment methods. These were deliberately scoped out
-- of every earlier phase (never named in the plan) but must move now for
-- Mongo to actually be retired in the Cutover phase.

create table if not exists addresses (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references users(id) on delete cascade,
  label                text default 'Home',
  full_name            text default '',
  phone                text default '',
  line1                text default '',
  line2                text default '',
  city                 text default '',
  state                text default '',
  country              text default '',
  postal_code          text default '',
  is_default_shipping  boolean not null default false,
  is_default_billing   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists addresses_updated_at on addresses;
create trigger addresses_updated_at before update on addresses for each row execute function set_updated_at();

create index if not exists idx_addresses_user_id on addresses(user_id);

-- Metadata only — never raw card numbers or CVV. Raw card processing
-- requires a PCI-compliant provider (Stripe, etc.), same as the original
-- Mongo model's design.
create table if not exists payment_methods (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references users(id) on delete cascade,
  provider                    text default 'manual',
  provider_customer_id        text,
  provider_payment_method_id  text,
  brand                       text default '',
  last4                       text default '',
  exp_month                   integer,
  exp_year                    integer,
  is_default                  boolean not null default false,
  status                      text not null default 'active' check (status in ('active','expired','removed')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

drop trigger if exists payment_methods_updated_at on payment_methods;
create trigger payment_methods_updated_at before update on payment_methods for each row execute function set_updated_at();

create index if not exists idx_payment_methods_user_id on payment_methods(user_id);
