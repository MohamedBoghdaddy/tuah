import * as adjustmentsRepo from "../repository/adjustments.repo.js";
import { ADJUSTMENT_REASONS } from "../constants.js";
import { isValidId, sanitizeString, toNumber } from "../utils.js";

export const listAdjustments = (filters) => adjustmentsRepo.listAdjustments(filters);

export const createAdjustment = async (body, actorId) => {
  if (!isValidId(body.productId)) return { error: "A valid productId is required." };
  if (!isValidId(body.locationId)) return { error: "A valid locationId is required." };

  const quantityDelta = toNumber(body.quantityDelta);
  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    return { error: "quantityDelta must be a non-zero number." };
  }
  if (!ADJUSTMENT_REASONS.includes(body.reason)) {
    return { error: `reason must be one of: ${ADJUSTMENT_REASONS.join(", ")}.` };
  }
  const note = sanitizeString(body.note);
  if (!note) return { error: "A note is required for every stock adjustment." };

  const adjustment = await adjustmentsRepo.executeAdjustment({
    productId: body.productId,
    locationId: body.locationId,
    quantityDelta,
    reason: body.reason,
    note,
    actorId,
  });
  return { adjustment };
};
