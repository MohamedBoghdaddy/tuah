import * as locationsRepo from "../repository/locations.repo.js";
import * as warehousesRepo from "../repository/warehouses.repo.js";
import { LOCATION_LEVELS, LOCATION_TYPES } from "../constants.js";
import { isValidId, sanitizeString } from "../utils.js";

export const listLocations = (filters) => locationsRepo.listLocations(filters);

export const getLocation = (id) => locationsRepo.findLocationById(id);

const validatePayload = async (body, { partial = false } = {}) => {
  if (!partial) {
    if (!isValidId(body.warehouseId)) return "A valid warehouseId is required.";
    if (!sanitizeString(body.code)) return "Location code is required.";
    if (!sanitizeString(body.name)) return "Location name is required.";
    const warehouse = await warehousesRepo.findWarehouseById(body.warehouseId);
    if (!warehouse) return "Warehouse not found.";
  }
  if (body.level !== undefined && !LOCATION_LEVELS.includes(body.level)) {
    return `Level must be one of: ${LOCATION_LEVELS.join(", ")}.`;
  }
  if (body.locationType !== undefined && !LOCATION_TYPES.includes(body.locationType)) {
    return `Location type must be one of: ${LOCATION_TYPES.join(", ")}.`;
  }
  if (body.parentLocationId !== undefined && body.parentLocationId !== null) {
    if (!isValidId(body.parentLocationId)) return "parentLocationId must be a valid id.";
    const parent = await locationsRepo.findLocationById(body.parentLocationId);
    if (!parent) return "Parent location not found.";
    if (body.warehouseId && parent.warehouseId !== body.warehouseId) {
      return "Parent location must belong to the same warehouse.";
    }
  }
  return null;
};

const buildPayload = (body) => {
  const payload = {};
  if (body.warehouseId !== undefined) payload.warehouse_id = body.warehouseId;
  if (body.parentLocationId !== undefined) payload.parent_location_id = body.parentLocationId || null;
  if (body.level !== undefined) payload.level = body.level;
  if (body.locationType !== undefined) payload.location_type = body.locationType;
  if (body.code !== undefined) payload.code = sanitizeString(body.code).toUpperCase();
  if (body.name !== undefined) payload.name = sanitizeString(body.name);
  if (body.isActive !== undefined) payload.is_active = Boolean(body.isActive);
  return payload;
};

export const createLocation = async (body) => {
  const error = await validatePayload(body);
  if (error) return { error };
  const location = await locationsRepo.createLocation(buildPayload(body));
  return { location };
};

export const updateLocation = async (id, body) => {
  const error = await validatePayload(body, { partial: true });
  if (error) return { error };
  const location = await locationsRepo.updateLocation(id, buildPayload(body));
  if (!location) return { notFound: true };
  return { location };
};
