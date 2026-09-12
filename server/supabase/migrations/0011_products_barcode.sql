-- Adds a barcode (EAN/UPC) field to products, alongside the existing sku.
-- Depends on: 0002_products.sql.

alter table products add column if not exists barcode text;

create unique index if not exists idx_products_barcode on products(barcode) where barcode is not null;
