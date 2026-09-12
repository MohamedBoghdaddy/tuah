// Read-side data access for stock_balances / stock_movements. These tables
// are never written to directly here — only fn_post_stock_movement and its
// callers (reservations/adjustments/transfers/receipts repos) mutate them,
// via RPC. This file is select-only.
import { supabaseAdmin } from "../../../config/supabase.js";

const BALANCES_TABLE = "stock_balances";
const MOVEMENTS_TABLE = "stock_movements";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

const LOCATION_EMBED = "warehouse_locations(id, name, code, location_type, warehouse_id, warehouses(id, name, code))";
const PRODUCT_EMBED = "products(id, name, sku, image_url)";

export const toBalanceJSON = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku, imageUrl: row.products.image_url } : undefined,
    locationId: row.location_id,
    location: row.warehouse_locations
      ? {
          id: row.warehouse_locations.id,
          name: row.warehouse_locations.name,
          code: row.warehouse_locations.code,
          locationType: row.warehouse_locations.location_type,
          warehouseId: row.warehouse_locations.warehouse_id,
          warehouse: row.warehouse_locations.warehouses
            ? { id: row.warehouse_locations.warehouses.id, name: row.warehouse_locations.warehouses.name, code: row.warehouse_locations.warehouses.code }
            : undefined,
        }
      : undefined,
    onHand: Number(row.on_hand),
    reserved: Number(row.reserved),
    available: Number(row.available),
    updatedAt: row.updated_at,
  };

export const listBalances = async ({ productId, locationId, warehouseId, page = 1, limit = 50 } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (pageNum - 1) * pageSize;

  let query = supabaseAdmin
    .from(BALANCES_TABLE)
    .select(`*, ${PRODUCT_EMBED}, ${LOCATION_EMBED}`, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (productId) query = query.eq("product_id", productId);
  if (locationId) query = query.eq("location_id", locationId);
  if (warehouseId) query = query.eq("warehouse_locations.warehouse_id", warehouseId);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list stock balances.");
  return { balances: (data || []).map(toBalanceJSON), total: count || 0 };
};

export const getBalancesForProduct = async (productId) => {
  const { data, error } = await supabaseAdmin
    .from(BALANCES_TABLE)
    .select(`*, ${LOCATION_EMBED}`)
    .eq("product_id", productId);
  throwIfError(error, "Failed to load product stock balances.");
  return (data || []).map(toBalanceJSON);
};

export const toMovementJSON = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
    locationId: row.location_id,
    location: row.warehouse_locations
      ? { id: row.warehouse_locations.id, name: row.warehouse_locations.name, code: row.warehouse_locations.code, warehouseId: row.warehouse_locations.warehouse_id }
      : undefined,
    quantity: Number(row.quantity),
    balanceAfter: Number(row.balance_after),
    movementType: row.movement_type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };

export const listMovements = async ({
  productId,
  locationId,
  warehouseId,
  movementType,
  referenceType,
  referenceId,
  dateFrom,
  dateTo,
  page = 1,
  limit = 50,
} = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (pageNum - 1) * pageSize;

  let query = supabaseAdmin
    .from(MOVEMENTS_TABLE)
    .select(`*, ${PRODUCT_EMBED}, warehouse_locations(id, name, code, warehouse_id)`, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (productId) query = query.eq("product_id", productId);
  if (locationId) query = query.eq("location_id", locationId);
  if (warehouseId) query = query.eq("warehouse_locations.warehouse_id", warehouseId);
  if (movementType) query = query.eq("movement_type", movementType);
  if (referenceType) query = query.eq("reference_type", referenceType);
  if (referenceId) query = query.eq("reference_id", referenceId);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list stock movements.");
  return { movements: (data || []).map(toMovementJSON), total: count || 0 };
};

// ── Overview aggregates — all real counts, no fabricated numbers ──────────

export const countWarehouses = async ({ activeOnly = false } = {}) => {
  let query = supabaseAdmin.from("warehouses").select("id", { count: "exact", head: true });
  if (activeOnly) query = query.eq("is_active", true);
  const { count, error } = await query;
  throwIfError(error, "Failed to count warehouses.");
  return count || 0;
};

export const countLocations = async () => {
  const { count, error } = await supabaseAdmin.from("warehouse_locations").select("id", { count: "exact", head: true });
  throwIfError(error, "Failed to count locations.");
  return count || 0;
};

export const sumOnHandValue = async () => {
  // PostgREST can't SUM(on_hand * price) server-side without a view/RPC, so
  // this pulls balances + prices and reduces client-side — fine at current
  // catalogue sizes (same approach already used for low-stock in products.js).
  const { data, error } = await supabaseAdmin
    .from(BALANCES_TABLE)
    .select("on_hand, products(price)")
    .gt("on_hand", 0);
  throwIfError(error, "Failed to compute on-hand inventory value.");
  return (data || []).reduce((sum, row) => sum + Number(row.on_hand) * Number(row.products?.price || 0), 0);
};

export const countActiveReservations = async () => {
  const { count, error } = await supabaseAdmin
    .from("stock_reservations")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  throwIfError(error, "Failed to count active reservations.");
  return count || 0;
};

export const countOpenTransfers = async () => {
  const { count, error } = await supabaseAdmin
    .from("stock_transfers")
    .select("id", { count: "exact", head: true })
    .in("status", ["draft", "ready", "in_progress"]);
  throwIfError(error, "Failed to count open transfers.");
  return count || 0;
};

export const countOpenReceipts = async () => {
  const { count, error } = await supabaseAdmin
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .in("status", ["draft", "partially_received"]);
  throwIfError(error, "Failed to count open receipts.");
  return count || 0;
};

// Incoming: sum of not-yet-received quantity on open receipt lines.
export const sumIncomingByProduct = async (productIds = []) => {
  let query = supabaseAdmin
    .from("receipt_lines")
    .select("product_id, expected_qty, received_qty, receipts!inner(status)")
    .in("receipts.status", ["draft", "partially_received"]);
  if (productIds.length) query = query.in("product_id", productIds);
  const { data, error } = await query;
  throwIfError(error, "Failed to compute incoming stock.");
  const totals = {};
  (data || []).forEach((line) => {
    const remaining = Number(line.expected_qty) - Number(line.received_qty);
    if (remaining > 0) totals[line.product_id] = (totals[line.product_id] || 0) + remaining;
  });
  return totals;
};

// Outgoing: sum of not-yet-moved quantity on open (ready/in_progress) transfer lines.
export const sumOutgoingByProduct = async (productIds = []) => {
  let query = supabaseAdmin
    .from("stock_transfer_lines")
    .select("product_id, requested_qty, moved_qty, stock_transfers!inner(status)")
    .in("stock_transfers.status", ["ready", "in_progress"]);
  if (productIds.length) query = query.in("product_id", productIds);
  const { data, error } = await query;
  throwIfError(error, "Failed to compute outgoing stock.");
  const totals = {};
  (data || []).forEach((line) => {
    const remaining = Number(line.requested_qty) - Number(line.moved_qty);
    if (remaining > 0) totals[line.product_id] = (totals[line.product_id] || 0) + remaining;
  });
  return totals;
};
