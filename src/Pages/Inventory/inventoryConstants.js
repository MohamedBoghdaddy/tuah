// Frontend mirror of server/modules/inventory/constants.js — keep in sync.

export const LOCATION_LEVELS = ["warehouse", "zone", "aisle", "rack", "bin"];

export const LOCATION_TYPES = ["internal", "receiving", "shipping", "returns", "quality_hold", "damaged", "scrap"];

export const MOVEMENT_TYPES = [
  "supplier_receipt",
  "customer_order",
  "customer_return",
  "supplier_return",
  "warehouse_transfer",
  "inventory_adjustment",
  "manufacturing_consumption",
  "manufacturing_output",
  "damage",
  "scrap",
  "manual_correction",
];

export const ADJUSTMENT_REASONS = ["damage", "scrap", "manual_correction", "cycle_count", "other"];

export const TRANSFER_STATUSES = ["draft", "ready", "in_progress", "completed", "cancelled"];

export const TRANSFER_STATUS_TRANSITIONS = {
  draft: ["ready", "cancelled"],
  ready: ["in_progress", "draft", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const RECEIPT_STATUSES = ["draft", "partially_received", "received", "cancelled"];

export const RECEIPT_STATUS_TRANSITIONS = {
  draft: ["cancelled"],
  partially_received: ["cancelled"],
  received: [],
  cancelled: [],
};

const formatLabel = (value) =>
  String(value)
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

export const formatEnumLabel = formatLabel;
