import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "stock_reservations";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toReservationJSON = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    quantity: Number(row.quantity),
    status: row.status,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    releasedAt: row.released_at,
    consumedAt: row.consumed_at,
  };

// ── Atomic operations — all via the Postgres functions in 0010_inventory.sql ──

export const reserveStock = async ({ productId, locationId, quantity, referenceType, referenceId, createdBy }) => {
  const { data, error } = await supabaseAdmin.rpc("fn_reserve_stock", {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity: quantity,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_created_by: createdBy || null,
  });
  throwIfError(error, "Failed to reserve stock.");
  return toReservationJSON(data);
};

export const releaseReservation = async (reservationId, actorId) => {
  const { data, error } = await supabaseAdmin.rpc("fn_release_reservation", {
    p_reservation_id: reservationId,
    p_actor_id: actorId || null,
  });
  throwIfError(error, "Failed to release reservation.");
  return toReservationJSON(data);
};

export const consumeReservation = async (
  reservationId,
  { movementType = "customer_order", referenceType, referenceId, actorId, notes } = {}
) => {
  const { data, error } = await supabaseAdmin.rpc("fn_consume_reservation", {
    p_reservation_id: reservationId,
    p_movement_type: movementType,
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null,
    p_actor_id: actorId || null,
    p_notes: notes || null,
  });
  throwIfError(error, "Failed to consume reservation.");
  return toReservationJSON(data);
};

// ── Reads ────────────────────────────────────────────────────────────────

export const findReservationById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to load reservation.");
  return toReservationJSON(data);
};

export const listReservations = async ({ productId, locationId, status, referenceType, referenceId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (pageNum - 1) * pageSize;

  let query = supabaseAdmin
    .from(TABLE)
    .select("*, products(id, name, sku)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (productId) query = query.eq("product_id", productId);
  if (locationId) query = query.eq("location_id", locationId);
  if (status) query = query.eq("status", status);
  if (referenceType) query = query.eq("reference_type", referenceType);
  if (referenceId) query = query.eq("reference_id", referenceId);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list reservations.");
  return {
    reservations: (data || []).map((row) => ({
      ...toReservationJSON(row),
      product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
    })),
    total: count || 0,
  };
};
