-- Phase 3 of the MongoDB -> Supabase Postgres migration: Cart + Orders.
-- Depends on 0001_users_employees.sql and 0002_products.sql.

create table if not exists carts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists carts_updated_at on carts;
create trigger carts_updated_at
  before update on carts
  for each row execute function set_updated_at();

create table if not exists cart_items (
  id          uuid primary key default gen_random_uuid(),
  cart_id     uuid not null references carts(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  quantity    integer not null default 1 check (quantity >= 1),
  added_at    timestamptz not null default now(),
  unique (cart_id, product_id)
);

create index if not exists idx_cart_items_cart_id on cart_items(cart_id);

create table if not exists orders (
  id                      uuid primary key default gen_random_uuid(),
  order_number            text not null unique,
  customer_id             uuid references users(id),
  customer_name           text default '',
  customer_email          text default '',
  subtotal                numeric(12,2) not null default 0 check (subtotal >= 0),
  tax                     numeric(12,2) not null default 0 check (tax >= 0),
  installation_fee        numeric(12,2) not null default 0 check (installation_fee >= 0),
  discount                numeric(12,2) not null default 0 check (discount >= 0),
  total                   numeric(12,2) not null default 0 check (total >= 0),
  status                  text not null default 'new'
    check (status in ('new','confirmed','in_production','ready','delivered','cancelled')),
  payment_status          text not null default 'pending'
    check (payment_status in ('pending','paid','failed','refunded')),
  assigned_employee_id    uuid references employees(id),
  assigned_employee_name  text default '',
  delivery_address        jsonb not null default '{}'::jsonb,
  installation_preference text not null default 'full'
    check (installation_preference in ('full','delivery_only','self_install')),
  estimated_days          integer,
  notes                   text default '',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists orders_updated_at on orders;
create trigger orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_status_created_at on orders(status, created_at desc);

create table if not exists order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid references products(id),
  name        text not null,
  quantity    integer not null default 1 check (quantity >= 1),
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0),
  total       numeric(12,2) not null default 0 check (total >= 0),
  image_url   text default '',
  sku         text default ''
);

create index if not exists idx_order_items_order_id on order_items(order_id);
