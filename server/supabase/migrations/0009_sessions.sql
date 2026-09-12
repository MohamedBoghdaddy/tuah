-- Phase 8 (Cutover) of the MongoDB -> Supabase Postgres migration: the
-- express-session store itself, replacing connect-mongodb-session. Backs the
-- guest cart (`req.session.cart` in routes/commerceRoutes.js).

create table if not exists sessions (
  sid     text primary key,
  sess    jsonb not null,
  expire  timestamptz not null
);

create index if not exists idx_sessions_expire on sessions(expire);
