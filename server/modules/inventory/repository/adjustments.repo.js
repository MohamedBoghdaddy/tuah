import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "stock_adjustments";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toAdjustmentJSON = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    quantityDelta: Number(row.quantity_delta),
    quantityBefore: Number(row.quantity_before),
    quantityAfter: Number(row.quantity_after),
    reason: row.reason,
    note: row.note,
    movementId: row.movement_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };

export const executeAdjustment = async ({ productId, locationId, quantityDelta, reason, note, actorId }) => {
  const { data, error } = await supabaseAdmin.rpc("fn_execute_stock_adjustment", {
    p_product_id: productId,
    p_location_id: locationId,
    p_quantity_delta: quantityDelta,
    p_reason: reason,
    p_note: note || null,
    p_actor_id: actorId,
  });
  throwIfError(error, "Failed to execute stock adjustment.");
  return toAdjustmentJSON(data);
};

export const listAdjustments = async ({ productId, locationId, reason, page = 1, limit = 50 } = {}) => {
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
  if (reason) query = query.eq("reason", reason);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list stock adjustments.");
  return {
    adjustments: (data || []).map((row) => ({
      ...toAdjustmentJSON(row),
      product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
    })),
    total: count || 0,
  };
};
