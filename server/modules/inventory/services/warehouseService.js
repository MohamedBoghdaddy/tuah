import * as warehousesRepo from "../repository/warehouses.repo.js";
import { sanitizeString } from "../utils.js";

export const listWarehouses = (filters) => warehousesRepo.listWarehouses(filters);

export const getWarehouse = (id) => warehousesRepo.findWarehouseById(id);

const validateWarehousePayload = (body, { partial = false } = {}) => {
  if (!partial) {
    if (!sanitizeString(body.code)) return "Warehouse code is required.";
    if (!sanitizeString(body.name)) return "Warehouse name is required.";
  }
  if (body.fulfillmentPriority !== undefined && !Number.isFinite(Number(body.fulfillmentPriority))) {
    return "Fulfillment priority must be a number.";
  }
  return null;
};

const buildPayload = (body) => {
  const payload = {};
  if (body.code !== undefined) payload.code = sanitizeString(body.code).toUpperCase();
  if (body.name !== undefined) payload.name = sanitizeString(body.name);
  if (body.isActive !== undefined) payload.is_active = Boolean(body.isActive);
  if (body.fulfillmentPriority !== undefined) payload.fulfillment_priority = Number(body.fulfillmentPriority);
  if (body.address !== undefined && typeof body.address === "object") payload.address = body.address;
  return payload;
};

export const createWarehouse = async (body) => {
  const error = validateWarehousePayload(body);
  if (error) return { error };

  const payload = buildPayload(body);
  if (body.isDefault) payload.is_default = true;

  const warehouse = await warehousesRepo.createWarehouse(payload);
  if (body.isDefault) await warehousesRepo.clearOtherDefaults(warehouse.id);
  return { warehouse };
};

export const updateWarehouse = async (id, body) => {
  const error = validateWarehousePayload(body, { partial: true });
  if (error) return { error };

  const payload = buildPayload(body);
  const warehouse = await warehousesRepo.updateWarehouse(id, payload);
  if (!warehouse) return { notFound: true };
  return { warehouse };
};

// Sets this warehouse as the default and clears every other one. Two admins
// racing to set different warehouses default is rare enough that "last
// write wins, DB partial-unique-index guards against two defaults ever
// coexisting" is an acceptable tradeoff here (unlike stock quantities,
// which always go through the locked RPC functions).
export const setDefaultWarehouse = async (id) => {
  const warehouse = await warehousesRepo.findWarehouseById(id);
  if (!warehouse) return { notFound: true };

  await warehousesRepo.clearOtherDefaults(id);
  const updated = await warehousesRepo.updateWarehouse(id, { is_default: true });
  return { warehouse: updated };
};
