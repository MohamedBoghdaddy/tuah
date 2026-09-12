import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "stock_transfers";
const LINES_TABLE = "stock_transfer_lines";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

const WAREHOUSE_EMBED = "source_warehouse:warehouses!stock_transfers_source_warehouse_id_fkey(id, name, code), dest_warehouse:warehouses!stock_transfers_dest_warehouse_id_fkey(id, name, code)";

export const toTransferJSON = (row) =>
  row && {
    id: row.id,
    transferNumber: row.transfer_number,
    sourceWarehouseId: row.source_warehouse_id,
    sourceLocationId: row.source_location_id,
    destWarehouseId: row.dest_warehouse_id,
    destLocationId: row.dest_location_id,
    sourceWarehouse: row.source_warehouse ? { id: row.source_warehouse.id, name: row.source_warehouse.name, code: row.source_warehouse.code } : undefined,
    destWarehouse: row.dest_warehouse ? { id: row.dest_warehouse.id, name: row.dest_warehouse.name, code: row.dest_warehouse.code } : undefined,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const toTransferLineJSON = (row) =>
  row && {
    id: row.id,
    transferId: row.transfer_id,
    productId: row.product_id,
    product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
    requestedQty: Number(row.requested_qty),
    movedQty: Number(row.moved_qty),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const listTransfers = async ({ status, warehouseId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (pageNum - 1) * pageSize;

  let query = supabaseAdmin
    .from(TABLE)
    .select(`*, ${WAREHOUSE_EMBED}`, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (status) query = query.eq("status", status);
  if (warehouseId) query = query.or(`source_warehouse_id.eq.${warehouseId},dest_warehouse_id.eq.${warehouseId}`);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list transfers.");
  return { transfers: (data || []).map(toTransferJSON), total: count || 0 };
};

export const findTransferById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select(`*, ${WAREHOUSE_EMBED}`).eq("id", id).maybeSingle();
  throwIfError(error, "Failed to load transfer.");
  return toTransferJSON(data);
};

export const listTransferLines = async (transferId) => {
  const { data, error } = await supabaseAdmin
    .from(LINES_TABLE)
    .select("*, products(id, name, sku)")
    .eq("transfer_id", transferId)
    .order("created_at", { ascending: true });
  throwIfError(error, "Failed to load transfer lines.");
  return (data || []).map(toTransferLineJSON);
};

export const createTransfer = async (payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select(`*, ${WAREHOUSE_EMBED}`).single();
  throwIfError(error, "Failed to create transfer.");
  return toTransferJSON(data);
};

export const addTransferLine = async (transferId, { productId, requestedQty }) => {
  const { data, error } = await supabaseAdmin
    .from(LINES_TABLE)
    .insert({ transfer_id: transferId, product_id: productId, requested_qty: requestedQty })
    .select("*, products(id, name, sku)")
    .single();
  throwIfError(error, "Failed to add transfer line.");
  return toTransferLineJSON(data);
};

export const removeTransferLine = async (lineId) => {
  const { error } = await supabaseAdmin.from(LINES_TABLE).delete().eq("id", lineId);
  throwIfError(error, "Failed to remove transfer line.");
};

export const updateTransferStatus = async (id, status) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update({ status }).eq("id", id).select(`*, ${WAREHOUSE_EMBED}`).maybeSingle();
  throwIfError(error, "Failed to update transfer status.");
  return toTransferJSON(data);
};

// ── Atomic operation — via fn_move_transfer_line ────────────────────────
export const moveTransferLine = async (lineId, quantity, actorId) => {
  const { data, error } = await supabaseAdmin.rpc("fn_move_transfer_line", {
    p_line_id: lineId,
    p_quantity: quantity,
    p_actor_id: actorId,
  });
  throwIfError(error, "Failed to move stock for transfer line.");
  return toTransferLineJSON(data);
};
