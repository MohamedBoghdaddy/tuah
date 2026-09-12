-- Phase: Inventory / WMS module.
--
-- Transaction/movement-based inventory. `stock_balances` is a materialized
-- current-state table (on_hand, reserved) that is NEVER written directly by
-- application code — it is only ever mutated, under a row lock, by the
-- plpgsql functions at the bottom of this file. Every change to on_hand is
-- also appended to `stock_movements` (an immutable ledger), so the balance
-- table is always reconstructable/auditable from history.
--
-- available = on_hand - reserved (see stock_balances.available, a generated
-- column so callers never have to recompute it, and it can never drift).
--
-- Depends on: 0001_users_employees.sql (users), 0002_products.sql (products).

-- ─────────────────────────────────────────────────────────────────────────
-- Warehouses
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists warehouses (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  is_active             boolean not null default true,
  is_default            boolean not null default false,
  fulfillment_priority  integer not null default 100, -- lower = preferred first for fulfillment
  address               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Only one warehouse may be the default.
create unique index if not exists idx_warehouses_single_default
  on warehouses ((is_default)) where is_default;

create index if not exists idx_warehouses_is_active on warehouses(is_active);

drop trigger if exists warehouses_updated_at on warehouses;
create trigger warehouses_updated_at
  before update on warehouses
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Warehouse locations — optional Warehouse -> Zone -> Aisle -> Rack -> Bin
-- hierarchy via self-reference. A warehouse may skip straight to a single
-- flat "internal" location; no level is required.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists warehouse_locations (
  id                 uuid primary key default gen_random_uuid(),
  warehouse_id       uuid not null references warehouses(id) on delete cascade,
  parent_location_id uuid references warehouse_locations(id) on delete cascade,
  level              text not null default 'warehouse'
    check (level in ('warehouse','zone','aisle','rack','bin')),
  location_type      text not null default 'internal'
    check (location_type in ('internal','receiving','shipping','returns','quality_hold','damaged','scrap')),
  code               text not null,
  name               text not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (warehouse_id, code)
);

create index if not exists idx_warehouse_locations_warehouse on warehouse_locations(warehouse_id);
create index if not exists idx_warehouse_locations_parent on warehouse_locations(parent_location_id);
create index if not exists idx_warehouse_locations_type on warehouse_locations(warehouse_id, location_type);

drop trigger if exists warehouse_locations_updated_at on warehouse_locations;
create trigger warehouse_locations_updated_at
  before update on warehouse_locations
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Stock balances — materialized current state per (product, location).
-- Mutated ONLY by the functions below, always under `select ... for update`.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists stock_balances (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  location_id  uuid not null references warehouse_locations(id) on delete cascade,
  on_hand      numeric(14,3) not null default 0 check (on_hand >= 0),
  reserved     numeric(14,3) not null default 0 check (reserved >= 0),
  available    numeric(14,3) generated always as (on_hand - reserved) stored,
  updated_at   timestamptz not null default now(),
  unique (product_id, location_id),
  check (reserved <= on_hand)
);

create index if not exists idx_stock_balances_product on stock_balances(product_id);
create index if not exists idx_stock_balances_location on stock_balances(location_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Stock movements — append-only ledger. This is the source of truth for
-- "what happened"; stock_balances.on_hand is derivable from summing these.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists stock_movements (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  location_id     uuid not null references warehouse_locations(id),
  quantity        numeric(14,3) not null check (quantity <> 0), -- signed: + increases on_hand, - decreases
  balance_after   numeric(14,3) not null,                       -- on_hand snapshot after this movement
  movement_type   text not null check (movement_type in (
                    'supplier_receipt','customer_order','customer_return','supplier_return',
                    'warehouse_transfer','inventory_adjustment','manufacturing_consumption',
                    'manufacturing_output','damage','scrap','manual_correction'
                  )),
  reference_type  text, -- 'receipt' | 'transfer' | 'adjustment' | 'order' | 'reservation' | 'manual'
  reference_id    uuid,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_stock_movements_product_location on stock_movements(product_id, location_id, created_at desc);
create index if not exists idx_stock_movements_type on stock_movements(movement_type);
create index if not exists idx_stock_movements_reference on stock_movements(reference_type, reference_id);
create index if not exists idx_stock_movements_created_at on stock_movements(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Stock reservations — soft allocation against on_hand. Reserving/releasing
-- never touches stock_movements (nothing physically moved yet); only
-- consuming a reservation does, because that's when stock actually leaves.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id),
  location_id     uuid not null references warehouse_locations(id),
  quantity        numeric(14,3) not null check (quantity > 0),
  status          text not null default 'active' check (status in ('active','released','consumed')),
  reference_type  text not null, -- e.g. 'order'
  reference_id    uuid not null,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  released_at     timestamptz,
  consumed_at     timestamptz
);

create index if not exists idx_stock_reservations_product_location on stock_reservations(product_id, location_id);
create index if not exists idx_stock_reservations_status on stock_reservations(status);
create index if not exists idx_stock_reservations_reference on stock_reservations(reference_type, reference_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Stock adjustments — single-item corrections (damage, scrap, cycle count,
-- manual correction). Always produces a stock_movements row AND an
-- inventory_audit_log row (adjustments override counted stock outside the
-- normal receive/transfer/consume flows, so they're treated as high-risk
-- by definition rather than by a fuzzy size threshold).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists stock_adjustments (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id),
  location_id       uuid not null references warehouse_locations(id),
  quantity_delta    numeric(14,3) not null check (quantity_delta <> 0),
  quantity_before   numeric(14,3) not null,
  quantity_after    numeric(14,3) not null,
  reason            text not null check (reason in ('damage','scrap','manual_correction','cycle_count','other')),
  note              text,
  movement_id       uuid references stock_movements(id),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_stock_adjustments_product_location on stock_adjustments(product_id, location_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Transfers — draft -> ready -> in_progress -> completed | cancelled.
-- Header status transitions are validated in the application layer;
-- moving stock for a line is the part that needs DB-level atomicity
-- (fn_move_transfer_line below).
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists stock_transfer_number_seq;

create table if not exists stock_transfers (
  id                  uuid primary key default gen_random_uuid(),
  transfer_number     text not null unique
    default ('TRF-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('stock_transfer_number_seq')::text, 5, '0')),
  source_warehouse_id uuid not null references warehouses(id),
  source_location_id  uuid references warehouse_locations(id),
  dest_warehouse_id   uuid not null references warehouses(id),
  dest_location_id    uuid references warehouse_locations(id),
  status              text not null default 'draft'
    check (status in ('draft','ready','in_progress','completed','cancelled')),
  notes               text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (not (source_warehouse_id = dest_warehouse_id and source_location_id is not distinct from dest_location_id))
);

create index if not exists idx_stock_transfers_status on stock_transfers(status);
create index if not exists idx_stock_transfers_source on stock_transfers(source_warehouse_id);
create index if not exists idx_stock_transfers_dest on stock_transfers(dest_warehouse_id);

drop trigger if exists stock_transfers_updated_at on stock_transfers;
create trigger stock_transfers_updated_at
  before update on stock_transfers
  for each row execute function set_updated_at();

create table if not exists stock_transfer_lines (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references stock_transfers(id) on delete cascade,
  product_id     uuid not null references products(id),
  requested_qty  numeric(14,3) not null check (requested_qty > 0),
  moved_qty      numeric(14,3) not null default 0 check (moved_qty >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (moved_qty <= requested_qty)
);

create index if not exists idx_stock_transfer_lines_transfer on stock_transfer_lines(transfer_id);
create index if not exists idx_stock_transfer_lines_product on stock_transfer_lines(product_id);

drop trigger if exists stock_transfer_lines_updated_at on stock_transfer_lines;
create trigger stock_transfer_lines_updated_at
  before update on stock_transfer_lines
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Receipts — supplier receiving. `source_reference_id` is left as a bare
-- uuid (no FK yet) so this connects to Purchase Orders without a schema
-- change once the Purchasing module exists.
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists receipt_number_seq;

create table if not exists receipts (
  id                   uuid primary key default gen_random_uuid(),
  receipt_number       text not null unique
    default ('RCV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('receipt_number_seq')::text, 5, '0')),
  warehouse_id         uuid not null references warehouses(id),
  location_id          uuid references warehouse_locations(id),
  source_type          text not null default 'supplier' check (source_type in ('supplier','purchase_order','return')),
  source_reference_id  uuid,
  supplier_name        text, -- free text until a suppliers table exists (Purchasing module)
  status               text not null default 'draft' check (status in ('draft','partially_received','received','cancelled')),
  notes                text,
  created_by           uuid references users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_receipts_status on receipts(status);
create index if not exists idx_receipts_warehouse on receipts(warehouse_id);

drop trigger if exists receipts_updated_at on receipts;
create trigger receipts_updated_at
  before update on receipts
  for each row execute function set_updated_at();

create table if not exists receipt_lines (
  id             uuid primary key default gen_random_uuid(),
  receipt_id     uuid not null references receipts(id) on delete cascade,
  product_id     uuid not null references products(id),
  expected_qty   numeric(14,3) not null default 0 check (expected_qty >= 0),
  received_qty   numeric(14,3) not null default 0 check (received_qty >= 0),
  quality_hold   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_receipt_lines_receipt on receipt_lines(receipt_id);
create index if not exists idx_receipt_lines_product on receipt_lines(product_id);

drop trigger if exists receipt_lines_updated_at on receipt_lines;
create trigger receipt_lines_updated_at
  before update on receipt_lines
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Replenishment foundation — per product+warehouse reorder policy.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists product_inventory_settings (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  warehouse_id        uuid not null references warehouses(id) on delete cascade,
  min_stock           numeric(14,3) not null default 0,
  max_stock           numeric(14,3),
  reorder_point       numeric(14,3) not null default 0,
  reorder_qty         numeric(14,3) not null default 0,
  preferred_supplier  text, -- free text until a suppliers table exists (Purchasing module)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (product_id, warehouse_id),
  check (max_stock is null or max_stock >= min_stock)
);

create index if not exists idx_product_inventory_settings_warehouse on product_inventory_settings(warehouse_id);

drop trigger if exists product_inventory_settings_updated_at on product_inventory_settings;
create trigger product_inventory_settings_updated_at
  before update on product_inventory_settings
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Inventory audit log — dedicated trail for stock adjustments specifically
-- (transfers/receipts/reservations already carry full history via their own
-- status-tracked rows + the stock_movements ledger).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists inventory_audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  entity_type text not null,
  entity_id   uuid not null,
  actor_id    uuid references users(id),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inventory_audit_log_entity on inventory_audit_log(entity_type, entity_id);
create index if not exists idx_inventory_audit_log_created_at on inventory_audit_log(created_at desc);

-- ═══════════════════════════════════════════════════════════════════════
-- FUNCTIONS — the only code paths allowed to mutate stock_balances.
-- Each is called via supabase-js `.rpc()`; PostgREST executes the whole
-- function as one statement, so it runs inside its own implicit
-- transaction. `select ... for update` inside serializes concurrent
-- callers against the same (product, location) row instead of racing.
-- ═══════════════════════════════════════════════════════════════════════

-- Core primitive: apply a signed on_hand delta (and optional reserved delta)
-- to a product/location balance, atomically, and append a ledger row.
create or replace function fn_post_stock_movement(
  p_product_id     uuid,
  p_location_id    uuid,
  p_quantity_delta numeric,
  p_movement_type  text,
  p_reference_type text default null,
  p_reference_id   uuid default null,
  p_created_by     uuid default null,
  p_notes          text default null,
  p_reserved_delta numeric default 0
) returns stock_movements
language plpgsql
as $$
declare
  v_on_hand   numeric(14,3);
  v_reserved  numeric(14,3);
  v_new_on_hand numeric(14,3);
  v_new_reserved numeric(14,3);
  v_movement  stock_movements;
begin
  if p_quantity_delta = 0 then
    raise exception 'invalid_movement: quantity delta cannot be zero';
  end if;

  insert into stock_balances (product_id, location_id, on_hand, reserved)
    values (p_product_id, p_location_id, 0, 0)
    on conflict (product_id, location_id) do nothing;

  select on_hand, reserved into v_on_hand, v_reserved
    from stock_balances
    where product_id = p_product_id and location_id = p_location_id
    for update;

  v_new_on_hand := v_on_hand + p_quantity_delta;
  v_new_reserved := v_reserved + p_reserved_delta;

  if v_new_on_hand < 0 then
    raise exception 'insufficient_on_hand_stock: requested % but only % on hand', -p_quantity_delta, v_on_hand;
  end if;
  if v_new_reserved < 0 then
    raise exception 'invalid_reservation_state: reserved cannot go below zero';
  end if;
  if v_new_reserved > v_new_on_hand then
    raise exception 'invalid_reservation_state: reserved cannot exceed on hand';
  end if;

  update stock_balances
    set on_hand = v_new_on_hand, reserved = v_new_reserved, updated_at = now()
    where product_id = p_product_id and location_id = p_location_id;

  insert into stock_movements (
    product_id, location_id, quantity, balance_after, movement_type,
    reference_type, reference_id, created_by, notes
  ) values (
    p_product_id, p_location_id, p_quantity_delta, v_new_on_hand, p_movement_type,
    p_reference_type, p_reference_id, p_created_by, p_notes
  ) returning * into v_movement;

  return v_movement;
end;
$$;

-- Reserve stock: soft-allocate `quantity` against available (on_hand - reserved).
create or replace function fn_reserve_stock(
  p_product_id     uuid,
  p_location_id    uuid,
  p_quantity       numeric,
  p_reference_type text,
  p_reference_id   uuid,
  p_created_by     uuid default null
) returns stock_reservations
language plpgsql
as $$
declare
  v_on_hand  numeric(14,3);
  v_reserved numeric(14,3);
  v_available numeric(14,3);
  v_reservation stock_reservations;
begin
  if p_quantity <= 0 then
    raise exception 'invalid_reservation: quantity must be positive';
  end if;

  insert into stock_balances (product_id, location_id, on_hand, reserved)
    values (p_product_id, p_location_id, 0, 0)
    on conflict (product_id, location_id) do nothing;

  select on_hand, reserved into v_on_hand, v_reserved
    from stock_balances
    where product_id = p_product_id and location_id = p_location_id
    for update;

  v_available := v_on_hand - v_reserved;

  if p_quantity > v_available then
    raise exception 'insufficient_available_stock: requested % but only % available', p_quantity, v_available;
  end if;

  update stock_balances
    set reserved = v_reserved + p_quantity, updated_at = now()
    where product_id = p_product_id and location_id = p_location_id;

  insert into stock_reservations (
    product_id, location_id, quantity, status, reference_type, reference_id, created_by
  ) values (
    p_product_id, p_location_id, p_quantity, 'active', p_reference_type, p_reference_id, p_created_by
  ) returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Release an active reservation (order cancelled, hold expired, etc.)
-- without moving any physical stock.
create or replace function fn_release_reservation(
  p_reservation_id uuid,
  p_actor_id       uuid default null
) returns stock_reservations
language plpgsql
as $$
declare
  v_reservation stock_reservations;
begin
  select * into v_reservation from stock_reservations where id = p_reservation_id for update;

  if v_reservation.id is null then
    raise exception 'reservation_not_found: %', p_reservation_id;
  end if;
  if v_reservation.status <> 'active' then
    raise exception 'reservation_not_active: reservation % is %', p_reservation_id, v_reservation.status;
  end if;

  update stock_balances
    set reserved = reserved - v_reservation.quantity, updated_at = now()
    where product_id = v_reservation.product_id and location_id = v_reservation.location_id;

  update stock_reservations
    set status = 'released', released_at = now()
    where id = p_reservation_id
    returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Consume an active reservation: stock physically leaves (on_hand decreases)
-- and the hold is released in the same atomic step.
create or replace function fn_consume_reservation(
  p_reservation_id uuid,
  p_movement_type  text default 'customer_order',
  p_reference_type text default null,
  p_reference_id   uuid default null,
  p_actor_id       uuid default null,
  p_notes          text default null
) returns stock_reservations
language plpgsql
as $$
declare
  v_reservation stock_reservations;
begin
  select * into v_reservation from stock_reservations where id = p_reservation_id for update;

  if v_reservation.id is null then
    raise exception 'reservation_not_found: %', p_reservation_id;
  end if;
  if v_reservation.status <> 'active' then
    raise exception 'reservation_not_active: reservation % is %', p_reservation_id, v_reservation.status;
  end if;

  perform fn_post_stock_movement(
    v_reservation.product_id,
    v_reservation.location_id,
    -v_reservation.quantity,
    p_movement_type,
    coalesce(p_reference_type, v_reservation.reference_type),
    coalesce(p_reference_id, v_reservation.reference_id),
    p_actor_id,
    p_notes,
    -v_reservation.quantity -- also releases the hold in the same locked update
  );

  update stock_reservations
    set status = 'consumed', consumed_at = now()
    where id = p_reservation_id
    returning * into v_reservation;

  return v_reservation;
end;
$$;

-- Single-item stock adjustment (damage, scrap, cycle count, manual
-- correction). Always produces a movement + an audit log row.
create or replace function fn_execute_stock_adjustment(
  p_product_id   uuid,
  p_location_id  uuid,
  p_quantity_delta numeric,
  p_reason       text,
  p_note         text,
  p_actor_id     uuid
) returns stock_adjustments
language plpgsql
as $$
declare
  v_before numeric(14,3);
  v_movement stock_movements;
  v_adjustment stock_adjustments;
begin
  insert into stock_balances (product_id, location_id, on_hand, reserved)
    values (p_product_id, p_location_id, 0, 0)
    on conflict (product_id, location_id) do nothing;

  select on_hand into v_before
    from stock_balances
    where product_id = p_product_id and location_id = p_location_id
    for update;

  v_movement := fn_post_stock_movement(
    p_product_id, p_location_id, p_quantity_delta, 'inventory_adjustment',
    'adjustment', null, p_actor_id, p_note
  );

  insert into stock_adjustments (
    product_id, location_id, quantity_delta, quantity_before, quantity_after,
    reason, note, movement_id, created_by
  ) values (
    p_product_id, p_location_id, p_quantity_delta, v_before, v_movement.balance_after,
    p_reason, p_note, v_movement.id, p_actor_id
  ) returning * into v_adjustment;

  update stock_movements set reference_id = v_adjustment.id where id = v_movement.id;

  insert into inventory_audit_log (action, entity_type, entity_id, actor_id, details)
    values (
      'stock_adjustment', 'stock_adjustment', v_adjustment.id, p_actor_id,
      jsonb_build_object(
        'productId', p_product_id, 'locationId', p_location_id,
        'quantityDelta', p_quantity_delta, 'quantityBefore', v_before,
        'quantityAfter', v_movement.balance_after, 'reason', p_reason, 'note', p_note
      )
    );

  return v_adjustment;
end;
$$;

-- Move (part of) a transfer line's requested quantity from the transfer's
-- source location to its destination location. Only legal while the parent
-- transfer is 'ready' or 'in_progress'; auto-advances 'ready' -> 'in_progress'
-- on the first successful move.
create or replace function fn_move_transfer_line(
  p_line_id  uuid,
  p_quantity numeric,
  p_actor_id uuid
) returns stock_transfer_lines
language plpgsql
as $$
declare
  v_line stock_transfer_lines;
  v_transfer stock_transfers;
  v_source_location uuid;
  v_dest_location uuid;
begin
  if p_quantity <= 0 then
    raise exception 'invalid_transfer_move: quantity must be positive';
  end if;

  select * into v_line from stock_transfer_lines where id = p_line_id for update;
  if v_line.id is null then
    raise exception 'transfer_line_not_found: %', p_line_id;
  end if;

  select * into v_transfer from stock_transfers where id = v_line.transfer_id for update;
  if v_transfer.status not in ('ready', 'in_progress') then
    raise exception 'transfer_not_active: transfer % is %', v_transfer.id, v_transfer.status;
  end if;

  if v_line.moved_qty + p_quantity > v_line.requested_qty then
    raise exception 'over_transfer: line % already moved % of % requested',
      p_line_id, v_line.moved_qty, v_line.requested_qty;
  end if;

  -- Locations default to a warehouse-level "internal" location when the
  -- transfer only specifies a warehouse (simple, location-less transfer).
  v_source_location := coalesce(
    v_transfer.source_location_id,
    (select id from warehouse_locations
       where warehouse_id = v_transfer.source_warehouse_id and location_type = 'internal'
       order by created_at limit 1)
  );
  v_dest_location := coalesce(
    v_transfer.dest_location_id,
    (select id from warehouse_locations
       where warehouse_id = v_transfer.dest_warehouse_id and location_type = 'internal'
       order by created_at limit 1)
  );

  if v_source_location is null or v_dest_location is null then
    raise exception 'missing_location: warehouse has no internal location to transfer from/to';
  end if;

  perform fn_post_stock_movement(
    v_line.product_id, v_source_location, -p_quantity, 'warehouse_transfer',
    'transfer', v_transfer.id, p_actor_id, v_transfer.notes
  );
  perform fn_post_stock_movement(
    v_line.product_id, v_dest_location, p_quantity, 'warehouse_transfer',
    'transfer', v_transfer.id, p_actor_id, v_transfer.notes
  );

  update stock_transfer_lines
    set moved_qty = moved_qty + p_quantity
    where id = p_line_id
    returning * into v_line;

  if v_transfer.status = 'ready' then
    update stock_transfers set status = 'in_progress' where id = v_transfer.id;
  end if;

  return v_line;
end;
$$;

-- Receive (part of) a receipt line's expected quantity into the receipt's
-- location (or the warehouse's quality_hold location, if the line is
-- flagged for QA hold). Over-receipt is blocked unless explicitly allowed.
create or replace function fn_receive_line(
  p_line_id            uuid,
  p_quantity           numeric,
  p_actor_id           uuid,
  p_allow_over_receipt boolean default false
) returns receipt_lines
language plpgsql
as $$
declare
  v_receipt_line receipt_lines;
  v_receipt receipts;
  v_target_location uuid;
  v_all_received boolean;
  v_any_received boolean;
begin
  if p_quantity <= 0 then
    raise exception 'invalid_receipt: quantity must be positive';
  end if;

  select * into v_receipt_line from receipt_lines where id = p_line_id for update;
  if v_receipt_line.id is null then
    raise exception 'receipt_line_not_found: %', p_line_id;
  end if;

  select * into v_receipt from receipts where id = v_receipt_line.receipt_id for update;
  if v_receipt.status not in ('draft', 'partially_received') then
    raise exception 'receipt_not_active: receipt % is %', v_receipt.id, v_receipt.status;
  end if;

  if not p_allow_over_receipt
     and v_receipt_line.received_qty + p_quantity > v_receipt_line.expected_qty then
    raise exception 'over_receipt_not_allowed: line % would receive % of % expected',
      p_line_id, v_receipt_line.received_qty + p_quantity, v_receipt_line.expected_qty;
  end if;

  if v_receipt_line.quality_hold then
    select id into v_target_location
      from warehouse_locations
      where warehouse_id = v_receipt.warehouse_id and location_type = 'quality_hold'
      order by created_at limit 1;
  end if;
  v_target_location := coalesce(v_target_location, v_receipt.location_id);
  if v_target_location is null then
    select id into v_target_location
      from warehouse_locations
      where warehouse_id = v_receipt.warehouse_id and location_type = 'internal'
      order by created_at limit 1;
  end if;
  if v_target_location is null then
    raise exception 'missing_location: warehouse % has no receiving location', v_receipt.warehouse_id;
  end if;

  perform fn_post_stock_movement(
    v_receipt_line.product_id, v_target_location, p_quantity, 'supplier_receipt',
    'receipt', v_receipt.id, p_actor_id, v_receipt.notes
  );

  update receipt_lines
    set received_qty = received_qty + p_quantity
    where id = p_line_id
    returning * into v_receipt_line;

  select
    bool_and(received_qty >= expected_qty),
    bool_or(received_qty > 0)
    into v_all_received, v_any_received
    from receipt_lines where receipt_id = v_receipt.id;

  update receipts
    set status = case
      when v_all_received then 'received'
      when v_any_received then 'partially_received'
      else status
    end
    where id = v_receipt.id;

  return v_receipt_line;
end;
$$;
