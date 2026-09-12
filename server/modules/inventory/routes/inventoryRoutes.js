import express from "express";
import { isAuthenticated, requirePermission } from "../../../middleware/AuthMiddleware.js";
import * as ctrl from "../controllers/inventoryController.js";

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.use(isAuthenticated);

// ── Warehouses ──────────────────────────────────────────────────────────
router.get("/warehouses", requirePermission("inventory.read"), asyncRoute(ctrl.listWarehouses));
router.get("/warehouses/:id", requirePermission("inventory.read"), asyncRoute(ctrl.getWarehouse));
router.post("/warehouses", requirePermission("warehouses.manage"), asyncRoute(ctrl.createWarehouse));
router.patch("/warehouses/:id", requirePermission("warehouses.manage"), asyncRoute(ctrl.updateWarehouse));
router.patch("/warehouses/:id/set-default", requirePermission("warehouses.manage"), asyncRoute(ctrl.setDefaultWarehouse));

// ── Locations ───────────────────────────────────────────────────────────
router.get("/locations", requirePermission("inventory.read"), asyncRoute(ctrl.listLocations));
router.get("/locations/:id", requirePermission("inventory.read"), asyncRoute(ctrl.getLocation));
router.post("/locations", requirePermission("warehouses.manage"), asyncRoute(ctrl.createLocation));
router.patch("/locations/:id", requirePermission("warehouses.manage"), asyncRoute(ctrl.updateLocation));

// ── Stock overview / balances / movements ──────────────────────────────
router.get("/overview", requirePermission("inventory.read"), asyncRoute(ctrl.getOverview));
router.get("/balances", requirePermission("inventory.read"), asyncRoute(ctrl.listBalances));
router.get("/movements", requirePermission("inventory.read"), asyncRoute(ctrl.listMovements));
router.get("/products/:productId/detail", requirePermission("inventory.read"), asyncRoute(ctrl.getProductInventoryDetail));

// ── Reservations ────────────────────────────────────────────────────────
router.get("/reservations", requirePermission("inventory.read"), asyncRoute(ctrl.listReservations));
router.post("/reservations", requirePermission("inventory.reservations.manage"), asyncRoute(ctrl.reserveStock));
router.patch("/reservations/:id/release", requirePermission("inventory.reservations.manage"), asyncRoute(ctrl.releaseReservation));
router.patch("/reservations/:id/consume", requirePermission("inventory.reservations.manage"), asyncRoute(ctrl.consumeReservation));

// ── Adjustments ─────────────────────────────────────────────────────────
router.get("/adjustments", requirePermission("inventory.read"), asyncRoute(ctrl.listAdjustments));
router.post("/adjustments", requirePermission("inventory.adjust"), asyncRoute(ctrl.createAdjustment));

// ── Transfers ───────────────────────────────────────────────────────────
router.get("/transfers", requirePermission("inventory.read"), asyncRoute(ctrl.listTransfers));
router.get("/transfers/:id", requirePermission("inventory.read"), asyncRoute(ctrl.getTransfer));
router.post("/transfers", requirePermission("inventory.transfer"), asyncRoute(ctrl.createTransfer));
router.post("/transfers/:id/lines", requirePermission("inventory.transfer"), asyncRoute(ctrl.addTransferLine));
router.delete("/transfers/:id/lines/:lineId", requirePermission("inventory.transfer"), asyncRoute(ctrl.removeTransferLine));
router.patch("/transfers/:id/status", requirePermission("inventory.transfer"), asyncRoute(ctrl.setTransferStatus));
router.post("/transfers/:id/lines/:lineId/move", requirePermission("inventory.transfer"), asyncRoute(ctrl.moveTransferLine));

// ── Receipts ────────────────────────────────────────────────────────────
router.get("/receipts", requirePermission("inventory.read"), asyncRoute(ctrl.listReceipts));
router.get("/receipts/:id", requirePermission("inventory.read"), asyncRoute(ctrl.getReceipt));
router.post("/receipts", requirePermission("inventory.receive"), asyncRoute(ctrl.createReceipt));
router.post("/receipts/:id/lines", requirePermission("inventory.receive"), asyncRoute(ctrl.addReceiptLine));
router.delete("/receipts/:id/lines/:lineId", requirePermission("inventory.receive"), asyncRoute(ctrl.removeReceiptLine));
router.patch("/receipts/:id/status", requirePermission("inventory.receive"), asyncRoute(ctrl.setReceiptStatus));
router.post("/receipts/:id/lines/:lineId/receive", requirePermission("inventory.receive"), asyncRoute(ctrl.receiveLine));

// ── Replenishment ───────────────────────────────────────────────────────
router.get("/settings", requirePermission("inventory.read"), asyncRoute(ctrl.listSettings));
router.put("/settings", requirePermission("inventory.settings.manage"), asyncRoute(ctrl.upsertSettings));
router.get("/replenishment", requirePermission("inventory.read"), asyncRoute(ctrl.listReplenishmentCandidates));

export default router;
