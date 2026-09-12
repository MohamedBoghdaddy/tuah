import * as transfersRepo from "../repository/transfers.repo.js";
import * as warehousesRepo from "../repository/warehouses.repo.js";
import { TRANSFER_STATUS_TRANSITIONS, TRANSFER_STATUSES } from "../constants.js";
import { isValidId, sanitizeString, toNumber } from "../utils.js";

export const listTransfers = (filters) => transfersRepo.listTransfers(filters);

export const getTransfer = async (id) => {
  const transfer = await transfersRepo.findTransferById(id);
  if (!transfer) return null;
  const lines = await transfersRepo.listTransferLines(id);
  return { ...transfer, lines };
};

export const createTransfer = async (body, actorId) => {
  if (!isValidId(body.sourceWarehouseId)) return { error: "A valid sourceWarehouseId is required." };
  if (!isValidId(body.destWarehouseId)) return { error: "A valid destWarehouseId is required." };
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { error: "At least one line (productId + requestedQty) is required." };
  }
  for (const line of body.lines) {
    if (!isValidId(line.productId)) return { error: "Each line needs a valid productId." };
    if (!(toNumber(line.requestedQty) > 0)) return { error: "Each line's requestedQty must be a positive number." };
  }

  const [sourceWarehouse, destWarehouse] = await Promise.all([
    warehousesRepo.findWarehouseById(body.sourceWarehouseId),
    warehousesRepo.findWarehouseById(body.destWarehouseId),
  ]);
  if (!sourceWarehouse) return { error: "Source warehouse not found." };
  if (!destWarehouse) return { error: "Destination warehouse not found." };
  if (
    body.sourceWarehouseId === body.destWarehouseId &&
    (body.sourceLocationId || null) === (body.destLocationId || null)
  ) {
    return { error: "Source and destination cannot be the same location." };
  }

  const transfer = await transfersRepo.createTransfer({
    source_warehouse_id: body.sourceWarehouseId,
    source_location_id: body.sourceLocationId || null,
    dest_warehouse_id: body.destWarehouseId,
    dest_location_id: body.destLocationId || null,
    notes: sanitizeString(body.notes) || null,
    created_by: actorId,
  });

  const lines = [];
  for (const line of body.lines) {
    lines.push(await transfersRepo.addTransferLine(transfer.id, { productId: line.productId, requestedQty: toNumber(line.requestedQty) }));
  }

  return { transfer: { ...transfer, lines } };
};

export const addLine = async (transferId, body) => {
  const transfer = await transfersRepo.findTransferById(transferId);
  if (!transfer) return { notFound: true };
  if (transfer.status !== "draft") return { error: "Lines can only be added while the transfer is in draft." };
  if (!isValidId(body.productId)) return { error: "A valid productId is required." };
  if (!(toNumber(body.requestedQty) > 0)) return { error: "requestedQty must be a positive number." };

  const line = await transfersRepo.addTransferLine(transferId, { productId: body.productId, requestedQty: toNumber(body.requestedQty) });
  return { line };
};

export const removeLine = async (transferId, lineId) => {
  const transfer = await transfersRepo.findTransferById(transferId);
  if (!transfer) return { notFound: true };
  if (transfer.status !== "draft") return { error: "Lines can only be removed while the transfer is in draft." };
  await transfersRepo.removeTransferLine(lineId);
  return {};
};

export const setStatus = async (id, nextStatus, actorId) => {
  if (!TRANSFER_STATUSES.includes(nextStatus)) {
    return { error: `Status must be one of: ${TRANSFER_STATUSES.join(", ")}.` };
  }
  const transfer = await transfersRepo.findTransferById(id);
  if (!transfer) return { notFound: true };

  const allowed = TRANSFER_STATUS_TRANSITIONS[transfer.status] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: `Cannot move a transfer from '${transfer.status}' to '${nextStatus}'.` };
  }

  if (nextStatus === "ready") {
    const lines = await transfersRepo.listTransferLines(id);
    if (lines.length === 0) return { error: "Add at least one line before marking the transfer ready." };
  }

  const updated = await transfersRepo.updateTransferStatus(id, nextStatus);
  void actorId; // reserved for a future audit trail on status changes
  return { transfer: updated };
};

// The atomic, stock-moving operation — delegates the actual balance
// mutation + ledger entry + status auto-advance to fn_move_transfer_line.
export const moveLine = async (transferId, lineId, body, actorId) => {
  const transfer = await transfersRepo.findTransferById(transferId);
  if (!transfer) return { notFound: true };
  const quantity = toNumber(body.quantity);
  if (!(quantity > 0)) return { error: "quantity must be a positive number." };

  const line = await transfersRepo.moveTransferLine(lineId, quantity, actorId);
  return { line };
};
