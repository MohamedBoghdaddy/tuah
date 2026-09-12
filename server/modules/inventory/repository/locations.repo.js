import { supabaseAdmin } from "../../../config/supabase.js";

const TABLE = "warehouse_locations";

const throwIfError = (error, fallback) => {
  if (error) throw new Error(error.message || fallback);
};

export const toLocationJSON = (row) =>
  row && {
    id: row.id,
    warehouseId: row.warehouse_id,
    parentLocationId: row.parent_location_id,
    level: row.level,
    locationType: row.location_type,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const listLocations = async ({ warehouseId, locationType, includeInactive = true } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*").order("code", { ascending: true });
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  if (locationType) query = query.eq("location_type", locationType);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  throwIfError(error, "Failed to list warehouse locations.");
  return (data || []).map(toLocationJSON);
};

export const findLocationById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to load location.");
  return toLocationJSON(data);
};

export const findDefaultLocationForWarehouse = async (warehouseId, locationType = "internal") => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("warehouse_id", warehouseId)
    .eq("location_type", locationType)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  throwIfError(error, "Failed to load default location.");
  return toLocationJSON(data);
};

export const createLocation = async (payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select().single();
  throwIfError(error, "Failed to create location.");
  return toLocationJSON(data);
};

export const updateLocation = async (id, payload) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update(payload).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update location.");
  return toLocationJSON(data);
};
