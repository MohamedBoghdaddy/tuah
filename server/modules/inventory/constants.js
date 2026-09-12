// Single source of truth for the inventory domain's controlled vocabularies.
// Mirrors the `check` constraints in server/supabase/migrations/0010_inventory.sql —
// keep the two in sync if either changes.

export const LOCATION_LEVELS = ["warehouse", "zone", "aisle", "rack", "bin"];

export const LOCATION_TYPES = [
  "internal",
  "receiving",
  "shipping",
  "returns",
  "quality_hold",
  "damaged",
  "scrap",
];

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

export const RESERVATION_STATUSES = ["active", "released", "consumed"];

export const ADJUSTMENT_REASONS = ["damage", "scrap", "manual_correction", "cycle_count", "other"];

export const TRANSFER_STATUSES = ["draft", "ready", "in_progress", "completed", "cancelled"];

// Legal transfer header transitions (application-enforced; line moves are
// DB-enforced separately via fn_move_transfer_line's own status check).
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

export const RECEIPT_SOURCE_TYPES = ["supplier", "purchase_order", "return"];
