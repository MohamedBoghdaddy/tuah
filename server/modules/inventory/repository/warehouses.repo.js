import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "warehouses";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toWarehouseJSON = (row) =>
  row && {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    isDefault: row.is_default,
    fulfillmentPriority: row.fulfillment_priority,
    address: row.address || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const listWarehouses = async ({ includeInactive = true } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*").order("fulfillment_priority", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  throwIfError(error, "Failed to list warehouses.");
  return (data || []).map(toWarehouseJSON);
};

export const findWarehouseById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to load warehouse.");
  return toWarehouseJSON(data);
};

export const getDefaultWarehouse = async () => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("is_default", true).maybeSingle();
  throwIfError(error, "Failed to load default warehouse.");
  return toWarehouseJSON(data);
};

export const createWarehouse = async (payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select().single();
  throwIfError(error, "Failed to create warehouse.");
  return toWarehouseJSON(data);
};

export const updateWarehouse = async (id, payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update(payload).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update warehouse.");
  return toWarehouseJSON(data);
};

// Clears every other warehouse's is_default flag before the caller sets a
// new one — the partial unique index also guards this at the DB level.
export const clearOtherDefaults = async (exceptId) => {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ is_default: false })
    .neq("id", exceptId)
    .eq("is_default", true);
  throwIfError(error, "Failed to clear previous default warehouse.");
};
