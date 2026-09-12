/**
 * Shared status → tone mapping, used by <StatusBadge> everywhere in the ERP/admin UI.
 *
 * Every page that renders a status pill (order status, payment status, attendance,
 * leave, invitation, stock level, ERP workflow, etc.) should resolve its color through
 * getStatusTone() instead of hard-coding its own hex/class map. This keeps the same
 * status word the same color everywhere in the product.
 *
 * Tones map 1:1 to the .badge-status utility classes in design-system.css:
 *   success | warning | danger | info | neutral
 */

const TONE_MAP = {
  // ── Success (final / positive states) ──────────────────────────────────
  paid: "success",
  completed: "success",
  complete: "success",
  received: "success",
  delivered: "success",
  active: "success",
  present: "success",
  approved: "success",
  sent: "success",
  resolved: "success",
  converted: "success",
  available: "success",
  in_stock: "success",
  ok: "success",
  confirmed: "success",
  paid_in_full: "success",

  // ── Warning (in-progress / needs attention) ────────────────────────────
  pending: "warning",
  low_stock: "warning",
  partially_paid: "warning",
  partially_received: "warning",
  queued: "warning",
  late: "warning",
  half_day: "warning",
  escalated: "warning",
  invited: "warning",
  busy: "warning",
  provider_not_configured: "warning",
  awaiting_approval: "warning",
  in_review: "warning",
  backordered: "warning",

  // ── Danger (blocked / failed / negative) ───────────────────────────────
  cancelled: "danger",
  canceled: "danger",
  failed: "danger",
  overdue: "danger",
  out_of_stock: "danger",
  rejected: "danger",
  absent: "danger",
  error: "danger",
  blocked: "danger",
  expired: "danger",
  refunded: "danger",

  // ── Info (active workflow / transit states) ────────────────────────────
  new: "info",
  in_production: "info",
  ready: "info",
  leave: "info",
  holiday: "info",
  remote: "info",
  processing: "info",
  in_transit: "info",
  shipped: "info",
  scheduled: "info",

  // ── Neutral (inactive / no status / archival) ──────────────────────────
  draft: "neutral",
  archived: "neutral",
  inactive: "neutral",
  none: "neutral",
  not_invited: "neutral",
  unassigned: "neutral",
};

/** Normalize any status-ish string ("In Production", "in-production") to a lookup key. */
const normalize = (status) =>
  String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** Returns one of: success | warning | danger | info | neutral. Defaults to "neutral". */
export const getStatusTone = (status) => TONE_MAP[normalize(status)] || "neutral";

/** Turns "in_production" into "In Production" for display. */
export const formatStatusLabel = (status) =>
  normalize(status)
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ") || "—";

const statusSemantics = { getStatusTone, formatStatusLabel };
export default statusSemantics;
