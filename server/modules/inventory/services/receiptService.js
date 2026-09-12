import * as receiptsRepo from "../repository/receipts.repo.js";
import * as warehousesRepo from "../repository/warehouses.repo.js";
import { RECEIPT_STATUS_TRANSITIONS, RECEIPT_STATUSES } from "../constants.js";
import { isValidId, sanitizeString, toNumber } from "../utils.js";

export const listReceipts = (filters) => receiptsRepo.listReceipts(filters);

export const getReceipt = async (id) => {
  const receipt = await receiptsRepo.findReceiptById(id);
  if (!receipt) return null;
  const lines = await receiptsRepo.listReceiptLines(id);
  return { ...receipt, lines };
};

export const createReceipt = async (body, actorId) => {
  if (!isValidId(body.warehouseId)) return { error: "A valid warehouseId is required." };
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { error: "At least one line (productId + expectedQty) is required." };
  }
  for (const line of body.lines) {
    if (!isValidId(line.productId)) return { error: "Each line needs a valid productId." };
    if (!(toNumber(line.expectedQty) >= 0)) return { error: "Each line's expectedQty must be zero or more." };
  }

  const warehouse = await warehousesRepo.findWarehouseById(body.warehouseId);
  if (!warehouse) return { error: "Warehouse not found." };

  const receipt = await receiptsRepo.createReceipt({
    warehouse_id: body.warehouseId,
    location_id: body.locationId || null,
    source_type: body.sourceType || "supplier",
    source_reference_id: body.sourceReferenceId || null,
    supplier_name: sanitizeString(body.supplierName) || null,
    notes: sanitizeString(body.notes) || null,
    created_by: actorId,
  });

  const lines = [];
  for (const line of body.lines) {
    lines.push(
      await receiptsRepo.addReceiptLine(receipt.id, {
        productId: line.productId,
        expectedQty: toNumber(line.expectedQty),
        qualityHold: Boolean(line.qualityHold),
      })
    );
  }

  return { receipt: { ...receipt, lines } };
};

export const addLine = async (receiptId, body) => {
  const receipt = await receiptsRepo.findReceiptById(receiptId);
  if (!receipt) return { notFound: true };
  if (receipt.status !== "draft") return { error: "Lines can only be added while the receipt is in draft." };
  if (!isValidId(body.productId)) return { error: "A valid productId is required." };
  if (!(toNumber(body.expectedQty) >= 0)) return { error: "expectedQty must be zero or more." };

  const line = await receiptsRepo.addReceiptLine(receiptId, {
    productId: body.productId,
    expectedQty: toNumber(body.expectedQty),
    qualityHold: Boolean(body.qualityHold),
  });
  return { line };
};

export const removeLine = async (receiptId, lineId) => {
  const receipt = await receiptsRepo.findReceiptById(receiptId);
  if (!receipt) return { notFound: true };
  if (receipt.status !== "draft") return { error: "Lines can only be removed while the receipt is in draft." };
  await receiptsRepo.removeReceiptLine(lineId);
  return {};
};

export const setStatus = async (id, nextStatus) => {
  if (!RECEIPT_STATUSES.includes(nextStatus)) {
    return { error: `Status must be one of: ${RECEIPT_STATUSES.join(", ")}.` };
  }
  const receipt = await receiptsRepo.findReceiptById(id);
  if (!receipt) return { notFound: true };

  const allowed = RECEIPT_STATUS_TRANSITIONS[receipt.status] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: `Cannot move a receipt from '${receipt.status}' to '${nextStatus}'.` };
  }

  const updated = await receiptsRepo.updateReceiptStatus(id, nextStatus);
  return { receipt: updated };
};

// The atomic, stock-moving operation — delegates to fn_receive_line, which
// posts the movement, updates received_qty, and auto-advances the header
// status (draft -> partially_received -> received).
export const receiveLine = async (receiptId, lineId, body, actorId) => {
  const receipt = await receiptsRepo.findReceiptById(receiptId);
  if (!receipt) return { notFound: true };
  const quantity = toNumber(body.quantity);
  if (!(quantity > 0)) return { error: "quantity must be a positive number." };

  const line = await receiptsRepo.receiveLine(lineId, quantity, actorId, Boolean(body.allowOverReceipt));
  return { line };
};
