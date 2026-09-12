# Tuwa Architecture: Supabase Postgres

Tuwa Commerce runs entirely on Supabase Postgres. MongoDB, previously the
business source of truth, was fully retired in an 8-phase migration (see
`server/supabase/migrations/0001` through `0009` for the schema history and
`server/scripts/migrate*ToSupabase.js` for the one-time data backfills that
accompanied each phase). The Express server (`server/server.js`) is
unchanged in shape — it's still the trusted API/BFF layer for auth,
permissions, checkout, and admin logic — only the database underneath it
changed.

## Postgres Tables (by domain)

- **Auth/People**: `users`, `employees`
- **Commerce**: `products`, `product_reviews`, `product_gallery_images`,
  `carts`, `cart_items`, `orders`, `order_items`, `wishlist_items`,
  `addresses`, `payment_methods`
- **Sales**: `leads`, `quotes`, `quote_items`
- **HR ops**: `attendance_records`, `leave_requests`,
  `leave_request_approval_steps`
- **ERP**: `erp_apps`, `departments`, `job_positions`, `erp_employees`,
  `erp_integration_status`, `erp_schema_relations`, `approval_requests`,
  `approval_request_steps`, `approval_steps`
- **Support**: `support_inquiries`
- **Storage-adjacent** (present since before the migration, unchanged):
  `image_assets`, `email_templates`, `email_outbox`, `email_logs`
- **Infra**: `sessions` (backs the guest cart's `express-session` store —
  see `server/services/supabaseSessionStore.js`)

## Data access pattern

Every table is read/written through the shared `supabaseAdmin` client
(`server/config/supabase.js`), using the `supabase-js` query builder
(`.from(table).select/insert/update/eq()...`) — no raw SQL driver, no ORM.
Each domain has a thin data-access module under `server/models-pg/` (e.g.
`products.js`, `orders.js`, `leave.js`) that controllers call into, mirroring
the shape the old Mongoose models used to provide.

## Storage & Email (unchanged from the original hybrid design)

- Storage buckets: `product-images`, `profile-images`, `employee-images`,
  `email-attachments`.
- Product image upload: Admin React UI → Express admin upload route →
  Supabase Storage → `image_assets` metadata → `products.image_url` /
  `image_asset_id`.
- Profile photo upload: same pattern against `users`.
- Employee invite: Admin React UI → Express invite route → Supabase Auth
  `inviteUserByEmail`, falling back to `email_outbox` → configured
  SMTP/Resend/SendGrid delivery attempt.
- Quote send: Express quote route → `quotes` lookup → `email_outbox` →
  configured provider delivery attempt → `quotes.last_email_status`.

## Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` is read only by `server/config/supabase.js`.
- React never receives or uses the Supabase service role key (it only ever
  gets the anon/publishable key, via `REACT_APP_SUPABASE_PUBLISHABLE_KEY`).
- Admin APIs are protected by the existing JWT auth and require the
  appropriate role/permission.
- User profile photo upload updates only the authenticated user.
- Client-provided storage paths are ignored; the backend generates safe
  paths.
- Quote and order totals are calculated on the backend.
