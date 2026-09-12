import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "product_inventory_settings";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toSettingsJSON = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    minStock: Number(row.min_stock),
    maxStock: row.max_stock === null ? null : Number(row.max_stock),
    reorderPoint: Number(row.reorder_point),
    reorderQty: Number(row.reorder_qty),
    preferredSupplier: row.preferred_supplier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const listSettings = async ({ warehouseId, productId } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*, products(id, name, sku)");
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  throwIfError(error, "Failed to list replenishment settings.");
  return (data || []).map((row) => ({
    ...toSettingsJSON(row),
    product: row.products ? { id: row.products.id, name: row.products.name, sku: row.products.sku } : undefined,
  }));
};

export const upsertSettings = async ({ productId, warehouseId, minStock, maxStock, reorderPoint, reorderQty, preferredSupplier }) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert(
      {
        product_id: productId,
        warehouse_id: warehouseId,
        min_stock: minStock,
        max_stock: maxStock ?? null,
        reorder_point: reorderPoint,
        reorder_qty: reorderQty,
        preferred_supplier: preferredSupplier || null,
      },
      { onConflict: "product_id,warehouse_id" }
    )
    .select()
    .single();
  throwIfError(error, "Failed to save replenishment settings.");
  return toSettingsJSON(data);
};

// Products whose current on_hand (summed across the warehouse's locations)
// is at or below their reorder point for that warehouse. Real, derived —
// no fabricated thresholds.
export const listReplenishmentCandidates = async ({ warehouseId } = {}) => {
  let settingsQuery = supabaseAdmin.from(TABLE).select("*, products(id, name, sku)");
  if (warehouseId) settingsQuery = settingsQuery.eq("warehouse_id", warehouseId);
  const { data: settings, error: settingsError } = await settingsQuery;
  throwIfError(settingsError, "Failed to load replenishment settings.");
  if (!settings?.length) return [];

  const warehouseIds = [...new Set(settings.map((s) => s.warehouse_id))];
  const { data: locations, error: locationsError } = await supabaseAdmin
    .from("warehouse_locations")
    .select("id, warehouse_id")
    .in("warehouse_id", warehouseIds);
  throwIfError(locationsError, "Failed to load warehouse locations.");

  const locationToWarehouse = new Map((locations || []).map((l) => [l.id, l.warehouse_id]));
  const locationIds = [...locationToWarehouse.keys()];
  if (!locationIds.length) return [];

  const { data: balances, error: balancesError } = await supabaseAdmin
    .from("stock_balances")
    .select("product_id, location_id, on_hand")
    .in("location_id", locationIds);
  throwIfError(balancesError, "Failed to load stock balances.");

  // Sum on_hand per (product, warehouse).
  const onHandByProductWarehouse = new Map();
  (balances || []).forEach((row) => {
    const warehouseId2 = locationToWarehouse.get(row.location_id);
    const key = `${row.product_id}:${warehouseId2}`;
    onHandByProductWarehouse.set(key, (onHandByProductWarehouse.get(key) || 0) + Number(row.on_hand));
  });

  return settings
    .map((s) => {
      const onHand = onHandByProductWarehouse.get(`${s.product_id}:${s.warehouse_id}`) || 0;
      return {
        ...toSettingsJSON(s),
        product: s.products ? { id: s.products.id, name: s.products.name, sku: s.products.sku } : undefined,
        onHand,
      };
    })
    .filter((row) => row.onHand <= row.reorderPoint);
};
