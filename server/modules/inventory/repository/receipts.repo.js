import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "receipts";
const LINES_TABLE = "receipt_lines";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toReceiptJSON = (row) =>
  row && {
    id: row.id,
    receiptNumber: row.receipt_number,
    warehouseId: row.warehouse_id,
    warehouse: row.warehouses ? { id: row.warehouses.id, name: row.warehouses.name, code: row.warehouses.code } : undefined,
    locationId: row.location_id,
    sourceType: row.source_type,
    sourceReferenceId: row.source_reference_id,
    supplierName: row.supplier_name,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const toReceiptLineJSON = (row) =>
  row && {
    id: row.id,
    receiptId: row.receipt_id,
    productId: row.product_id,
    product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
    expectedQty: Number(row.expected_qty),
    receivedQty: Number(row.received_qty),
    qualityHold: row.quality_hold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const listReceipts = async ({ status, warehouseId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (pageNum - 1) * pageSize;

  let query = supabaseAdmin
    .from(TABLE)
    .select("*, warehouses(id, name, code)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (status) query = query.eq("status", status);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list receipts.");
  return { receipts: (data || []).map(toReceiptJSON), total: count || 0 };
};

export const findReceiptById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*, warehouses(id, name, code)").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to load receipt.");
  return toReceiptJSON(data);
};

export const listReceiptLines = async (receiptId) => {
  const { data, error } = await supabaseAdmin
    .from(LINES_TABLE)
    .select("*, products(id, name, sku)")
    .eq("receipt_id", receiptId)
    .order("created_at", { ascending: true });
  throwIfError(error, "Failed to load receipt lines.");
  return (data || []).map(toReceiptLineJSON);
};

export const createReceipt = async (payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select("*, warehouses(id, name, code)").single();
  throwIfError(error, "Failed to create receipt.");
  return toReceiptJSON(data);
};

export const addReceiptLine = async (receiptId, { productId, expectedQty, qualityHold = false }) => {
  const { data, error } = await supabaseAdmin
    .from(LINES_TABLE)
    .insert({ receipt_id: receiptId, product_id: productId, expected_qty: expectedQty, quality_hold: qualityHold })
    .select("*, products(id, name, sku)")
    .single();
  throwIfError(error, "Failed to add receipt line.");
  return toReceiptLineJSON(data);
};

export const removeReceiptLine = async (lineId) => {
  const { error } = await supabaseAdmin.from(LINES_TABLE).delete().eq("id", lineId);
  throwIfError(error, "Failed to remove receipt line.");
};

export const updateReceiptStatus = async (id, status) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update({ status }).eq("id", id).select("*, warehouses(id, name, code)").maybeSingle();
  throwIfError(error, "Failed to update receipt status.");
  return toReceiptJSON(data);
};

// ── Atomic operation — via fn_receive_line ──────────────────────────────
export const receiveLine = async (lineId, quantity, actorId, allowOverReceipt = false) => {
  const { data, error } = await supabaseAdmin.rpc("fn_receive_line", {
    p_line_id: lineId,
    p_quantity: quantity,
    p_actor_id: actorId,
    p_allow_over_receipt: allowOverReceipt,
  });
  throwIfError(error, "Failed to receive stock for receipt line.");
  return toReceiptLineJSON(data);
};
