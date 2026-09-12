import * as settingsRepo from "../repository/settings.repo.js";
import { isValidId, toNumber, sanitizeString } from "../utils.js";

export const listSettings = (filters) => settingsRepo.listSettings(filters);

export const listCandidates = (filters) => settingsRepo.listReplenishmentCandidates(filters);

export const upsertSettings = async (body) => {
  if (!isValidId(body.productId)) return { error: "A valid productId is required." };
  if (!isValidId(body.warehouseId)) return { error: "A valid warehouseId is required." };

  const minStock = toNumber(body.minStock ?? 0);
  const reorderPoint = toNumber(body.reorderPoint ?? 0);
  const reorderQty = toNumber(body.reorderQty ?? 0);
  const maxStock = body.maxStock === null || body.maxStock === undefined || body.maxStock === "" ? null : toNumber(body.maxStock);

  if (!(minStock >= 0)) return { error: "minStock must be zero or more." };
  if (!(reorderPoint >= 0)) return { error: "reorderPoint must be zero or more." };
  if (!(reorderQty >= 0)) return { error: "reorderQty must be zero or more." };
  if (maxStock !== null && (!Number.isFinite(maxStock) || maxStock < minStock)) {
    return { error: "maxStock must be zero or more and greater than or equal to minStock." };
  }

  const settings = await settingsRepo.upsertSettings({
    productId: body.productId,
    warehouseId: body.warehouseId,
    minStock,
    maxStock,
    reorderPoint,
    reorderQty,
    preferredSupplier: sanitizeString(body.preferredSupplier),
  });
  return { settings };
};
