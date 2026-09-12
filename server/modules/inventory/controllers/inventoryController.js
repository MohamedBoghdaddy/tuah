// Thin HTTP layer for the inventory/WMS module — validates nothing itself
// beyond id-shape checks; all business validation lives in services/*.
import * as warehouseService from "../services/warehouseService.js";
import * as locationService from "../services/locationService.js";
import * as stockService from "../services/stockService.js";
import * as reservationService from "../services/reservationService.js";
import * as adjustmentService from "../services/adjustmentService.js";
import * as transferService from "../services/transferService.js";
import * as receiptService from "../services/receiptService.js";
import * as replenishmentService from "../services/replenishmentService.js";
import { isValidId, sendInventoryError } from "../utils.js";

const actorId = (req) => req.actor?.id;

const badId = (res, label = "id") => res.status(400).json({ success: false, message: `Invalid ${label}.` });

// ── Warehouses ──────────────────────────────────────────────────────────
export const listWarehouses = async (req, res) => {
  const warehouses = await warehouseService.listWarehouses({ includeInactive: req.query.includeInactive !== "false" });
  res.json({ success: true, warehouses });
};

export const getWarehouse = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "warehouse id");
  const warehouse = await warehouseService.getWarehouse(req.params.id);
  if (!warehouse) return res.status(404).json({ success: false, message: "Warehouse not found." });
  res.json({ success: true, warehouse });
};

export const createWarehouse = async (req, res) => {
  try {
    const result = await warehouseService.createWarehouse(req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, warehouse: result.warehouse });
  } catch (error) {
    sendInventoryError(res, error, "Failed to create warehouse.");
  }
};

export const updateWarehouse = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "warehouse id");
  try {
    const result = await warehouseService.updateWarehouse(req.params.id, req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Warehouse not found." });
    res.json({ success: true, warehouse: result.warehouse });
  } catch (error) {
    sendInventoryError(res, error, "Failed to update warehouse.");
  }
};

export const setDefaultWarehouse = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "warehouse id");
  try {
    const result = await warehouseService.setDefaultWarehouse(req.params.id);
    if (result.notFound) return res.status(404).json({ success: false, message: "Warehouse not found." });
    res.json({ success: true, warehouse: result.warehouse });
  } catch (error) {
    sendInventoryError(res, error, "Failed to set default warehouse.");
  }
};

// ── Locations ───────────────────────────────────────────────────────────
export const listLocations = async (req, res) => {
  const { warehouseId, locationType, includeInactive } = req.query;
  const locations = await locationService.listLocations({
    warehouseId,
    locationType,
    includeInactive: includeInactive !== "false",
  });
  res.json({ success: true, locations });
};

export const getLocation = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "location id");
  const location = await locationService.getLocation(req.params.id);
  if (!location) return res.status(404).json({ success: false, message: "Location not found." });
  res.json({ success: true, location });
};

export const createLocation = async (req, res) => {
  try {
    const result = await locationService.createLocation(req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, location: result.location });
  } catch (error) {
    sendInventoryError(res, error, "Failed to create location.");
  }
};

export const updateLocation = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "location id");
  try {
    const result = await locationService.updateLocation(req.params.id, req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Location not found." });
    res.json({ success: true, location: result.location });
  } catch (error) {
    sendInventoryError(res, error, "Failed to update location.");
  }
};

// ── Stock (overview, balances, movements, product detail) ─────────────
export const getOverview = async (req, res) => {
  try {
    const overview = await stockService.getOverview();
    res.json({ success: true, overview });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load inventory overview.");
  }
};

export const listBalances = async (req, res) => {
  try {
    const { productId, locationId, warehouseId, page, limit } = req.query;
    const { balances, total } = await stockService.listBalances({ productId, locationId, warehouseId, page, limit });
    res.json({ success: true, balances, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load stock balances.");
  }
};

export const listMovements = async (req, res) => {
  try {
    const { productId, locationId, warehouseId, movementType, referenceType, referenceId, dateFrom, dateTo, page, limit } = req.query;
    const { movements, total } = await stockService.listMovements({
      productId, locationId, warehouseId, movementType, referenceType, referenceId, dateFrom, dateTo, page, limit,
    });
    res.json({ success: true, movements, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load movement history.");
  }
};

export const getProductInventoryDetail = async (req, res) => {
  if (!isValidId(req.params.productId)) return badId(res, "product id");
  try {
    const detail = await stockService.getProductInventoryDetail(req.params.productId);
    res.json({ success: true, ...detail });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load product inventory detail.");
  }
};

// ── Reservations ────────────────────────────────────────────────────────
export const listReservations = async (req, res) => {
  try {
    const { productId, locationId, status, referenceType, referenceId, page, limit } = req.query;
    const { reservations, total } = await reservationService.listReservations({
      productId, locationId, status, referenceType, referenceId, page, limit,
    });
    res.json({ success: true, reservations, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to list reservations.");
  }
};

export const reserveStock = async (req, res) => {
  try {
    const result = await reservationService.reserveStock(req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, reservation: result.reservation });
  } catch (error) {
    sendInventoryError(res, error, "Failed to reserve stock.");
  }
};

export const releaseReservation = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "reservation id");
  try {
    const result = await reservationService.releaseReservation(req.params.id, actorId(req));
    res.json({ success: true, reservation: result.reservation });
  } catch (error) {
    sendInventoryError(res, error, "Failed to release reservation.");
  }
};

export const consumeReservation = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "reservation id");
  try {
    const result = await reservationService.consumeReservation(req.params.id, req.body || {}, actorId(req));
    res.json({ success: true, reservation: result.reservation });
  } catch (error) {
    sendInventoryError(res, error, "Failed to consume reservation.");
  }
};

// ── Adjustments ─────────────────────────────────────────────────────────
export const listAdjustments = async (req, res) => {
  try {
    const { productId, locationId, reason, page, limit } = req.query;
    const { adjustments, total } = await adjustmentService.listAdjustments({ productId, locationId, reason, page, limit });
    res.json({ success: true, adjustments, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to list stock adjustments.");
  }
};

export const createAdjustment = async (req, res) => {
  try {
    const result = await adjustmentService.createAdjustment(req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, adjustment: result.adjustment });
  } catch (error) {
    sendInventoryError(res, error, "Failed to create stock adjustment.");
  }
};

// ── Transfers ───────────────────────────────────────────────────────────
export const listTransfers = async (req, res) => {
  try {
    const { status, warehouseId, page, limit } = req.query;
    const { transfers, total } = await transferService.listTransfers({ status, warehouseId, page, limit });
    res.json({ success: true, transfers, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to list transfers.");
  }
};

export const getTransfer = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "transfer id");
  try {
    const transfer = await transferService.getTransfer(req.params.id);
    if (!transfer) return res.status(404).json({ success: false, message: "Transfer not found." });
    res.json({ success: true, transfer });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load transfer.");
  }
};

export const createTransfer = async (req, res) => {
  try {
    const result = await transferService.createTransfer(req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, transfer: result.transfer });
  } catch (error) {
    sendInventoryError(res, error, "Failed to create transfer.");
  }
};

export const addTransferLine = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "transfer id");
  try {
    const result = await transferService.addLine(req.params.id, req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Transfer not found." });
    res.status(201).json({ success: true, line: result.line });
  } catch (error) {
    sendInventoryError(res, error, "Failed to add transfer line.");
  }
};

export const removeTransferLine = async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.lineId)) return badId(res, "id");
  try {
    const result = await transferService.removeLine(req.params.id, req.params.lineId);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Transfer not found." });
    res.json({ success: true });
  } catch (error) {
    sendInventoryError(res, error, "Failed to remove transfer line.");
  }
};

export const setTransferStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "transfer id");
  try {
    const result = await transferService.setStatus(req.params.id, req.body.status, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Transfer not found." });
    res.json({ success: true, transfer: result.transfer });
  } catch (error) {
    sendInventoryError(res, error, "Failed to update transfer status.");
  }
};

export const moveTransferLine = async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.lineId)) return badId(res, "id");
  try {
    const result = await transferService.moveLine(req.params.id, req.params.lineId, req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Transfer not found." });
    res.json({ success: true, line: result.line });
  } catch (error) {
    sendInventoryError(res, error, "Failed to move stock for transfer line.");
  }
};

// ── Receipts ────────────────────────────────────────────────────────────
export const listReceipts = async (req, res) => {
  try {
    const { status, warehouseId, page, limit } = req.query;
    const { receipts, total } = await receiptService.listReceipts({ status, warehouseId, page, limit });
    res.json({ success: true, receipts, total });
  } catch (error) {
    sendInventoryError(res, error, "Failed to list receipts.");
  }
};

export const getReceipt = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "receipt id");
  try {
    const receipt = await receiptService.getReceipt(req.params.id);
    if (!receipt) return res.status(404).json({ success: false, message: "Receipt not found." });
    res.json({ success: true, receipt });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load receipt.");
  }
};

export const createReceipt = async (req, res) => {
  try {
    const result = await receiptService.createReceipt(req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.status(201).json({ success: true, receipt: result.receipt });
  } catch (error) {
    sendInventoryError(res, error, "Failed to create receipt.");
  }
};

export const addReceiptLine = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "receipt id");
  try {
    const result = await receiptService.addLine(req.params.id, req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Receipt not found." });
    res.status(201).json({ success: true, line: result.line });
  } catch (error) {
    sendInventoryError(res, error, "Failed to add receipt line.");
  }
};

export const removeReceiptLine = async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.lineId)) return badId(res, "id");
  try {
    const result = await receiptService.removeLine(req.params.id, req.params.lineId);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Receipt not found." });
    res.json({ success: true });
  } catch (error) {
    sendInventoryError(res, error, "Failed to remove receipt line.");
  }
};

export const setReceiptStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return badId(res, "receipt id");
  try {
    const result = await receiptService.setStatus(req.params.id, req.body.status);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Receipt not found." });
    res.json({ success: true, receipt: result.receipt });
  } catch (error) {
    sendInventoryError(res, error, "Failed to update receipt status.");
  }
};

export const receiveLine = async (req, res) => {
  if (!isValidId(req.params.id) || !isValidId(req.params.lineId)) return badId(res, "id");
  try {
    const result = await receiptService.receiveLine(req.params.id, req.params.lineId, req.body, actorId(req));
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    if (result.notFound) return res.status(404).json({ success: false, message: "Receipt not found." });
    res.json({ success: true, line: result.line });
  } catch (error) {
    sendInventoryError(res, error, "Failed to receive stock.");
  }
};

// ── Replenishment ───────────────────────────────────────────────────────
export const listSettings = async (req, res) => {
  const { warehouseId, productId } = req.query;
  const settings = await replenishmentService.listSettings({ warehouseId, productId });
  res.json({ success: true, settings });
};

export const upsertSettings = async (req, res) => {
  try {
    const result = await replenishmentService.upsertSettings(req.body);
    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json({ success: true, settings: result.settings });
  } catch (error) {
    sendInventoryError(res, error, "Failed to save replenishment settings.");
  }
};

export const listReplenishmentCandidates = async (req, res) => {
  try {
    const candidates = await replenishmentService.listCandidates({ warehouseId: req.query.warehouseId });
    res.json({ success: true, candidates });
  } catch (error) {
    sendInventoryError(res, error, "Failed to load replenishment candidates.");
  }
};
