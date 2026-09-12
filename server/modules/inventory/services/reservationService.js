import * as reservationsRepo from "../repository/reservations.repo.js";
import { isValidId, sanitizeString, toNumber } from "../utils.js";

export const listReservations = (filters) => reservationsRepo.listReservations(filters);

export const reserveStock = async (body, actorId) => {
  if (!isValidId(body.productId)) return { error: "A valid productId is required." };
  if (!isValidId(body.locationId)) return { error: "A valid locationId is required." };
  const quantity = toNumber(body.quantity);
  if (!(quantity > 0)) return { error: "Quantity must be a positive number." };
  const referenceType = sanitizeString(body.referenceType);
  if (!referenceType) return { error: "referenceType is required (e.g. 'order')." };
  if (!isValidId(body.referenceId)) return { error: "A valid referenceId is required." };

  const reservation = await reservationsRepo.reserveStock({
    productId: body.productId,
    locationId: body.locationId,
    quantity,
    referenceType,
    referenceId: body.referenceId,
    createdBy: actorId,
  });
  return { reservation };
};

export const releaseReservation = async (id, actorId) => {
  const reservation = await reservationsRepo.releaseReservation(id, actorId);
  return { reservation };
};

export const consumeReservation = async (id, body, actorId) => {
  const reservation = await reservationsRepo.consumeReservation(id, {
    movementType: body.movementType || "customer_order",
    referenceType: body.referenceType,
    referenceId: body.referenceId,
    actorId,
    notes: body.notes,
  });
  return { reservation };
};
