-- Phase 2 of the MongoDB -> Supabase Postgres migration: Products.
-- Depends on 0001_users_employees.sql (users table, for product_reviews.user_id
-- and wishlist_items.user_id).

create table if not exists products (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text,
  description            text not null,
  category               text not null,
  collection             text,
  price                  numeric(12,2) not null check (price >= 0),
  discount_price         numeric(12,2) check (discount_price is null or discount_price >= 0),
  sku                    text,
  material               text,
  color                  text,
  room                   text,
  use_case               text,
  dimensions             text,
  tags                   text[] not null default '{}',
  images                 text[] not null default '{}',
  stock                  integer not null default 0 check (stock >= 0),
  low_stock_threshold    integer not null default 5 check (low_stock_threshold >= 0),
  sold                   integer not null default 0,
  average_rating         numeric(3,2) not null default 0,
  created_by             uuid references users(id),
  image_url              text,
  image_asset_id         text,
  featured               boolean not null default false,
  status                 text not null default 'active'
    check (status in ('active','draft','archived','inactive')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists products_updated_at on products;
create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

create unique index if not exists idx_products_slug on products(slug) where slug is not null;
create unique index if not exists idx_products_sku on products(sku) where sku is not null;
create index if not exists idx_products_status on products(status);
create index if not exists idx_products_status_collection on products(status, collection);
create index if not exists idx_products_status_category on products(status, category);
create index if not exists idx_products_status_material on products(status, material);
create index if not exists idx_products_status_color on products(status, color);

-- ── product_reviews (was Product.reviews[] embedded subdocument) ─────────────
create table if not exists product_reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  user_id     uuid references users(id),
  name        text not null,
  rating      integer not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists product_reviews_updated_at on product_reviews;
create trigger product_reviews_updated_at
  before update on product_reviews
  for each row execute function set_updated_at();

create index if not exists idx_product_reviews_product_id on product_reviews(product_id);

-- ── product_gallery_images (was Product.galleryImages[] embedded subdocument) ─
create table if not exists product_gallery_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  url         text,
  asset_id    text,
  alt_text    text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_product_gallery_images_product_id on product_gallery_images(product_id);

-- ── wishlist_items (was User.wishlist: [ObjectId ref Product]) ───────────────
create table if not exists wishlist_items (
  user_id     uuid not null references users(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

create index if not exists idx_wishlist_items_user_id on wishlist_items(user_id);
