const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

export const toNumber = (value) => {
  if (value === "" || value === null || value === undefined) return NaN;
  const next = Number(value);
  return Number.isFinite(next) ? next : NaN;
};

export const sanitizeString = (value) => (typeof value === "string" ? value.trim() : value);

// Postgres RAISE EXCEPTION messages from our functions are prefixed with a
// stable machine-readable token (e.g. "insufficient_available_stock: ...").
// This turns that into the right HTTP status + a clean message, instead of
// every business-rule violation surfacing as a generic 500.
const BUSINESS_ERROR_STATUS = {
  insufficient_available_stock: 409,
  insufficient_on_hand_stock: 409,
  invalid_reservation_state: 409,
  reservation_not_active: 409,
  reservation_not_found: 404,
  over_receipt_not_allowed: 409,
  over_transfer: 409,
  transfer_not_active: 409,
  transfer_line_not_found: 404,
  receipt_not_active: 409,
  receipt_line_not_found: 404,
  missing_location: 422,
  invalid_movement: 400,
  invalid_reservation: 400,
  invalid_transfer_move: 400,
  invalid_receipt: 400,
};

export const mapInventoryError = (error) => {
  const message = error?.message || "Inventory operation failed.";
  const token = Object.keys(BUSINESS_ERROR_STATUS).find((key) => message.startsWith(key));
  if (token) {
    return { status: BUSINESS_ERROR_STATUS[token], message: message.slice(token.length + 1).trim() || message };
  }
  if (error?.code === "23505") return { status: 409, message: "That value must be unique." };
  if (error?.code === "23503") return { status: 409, message: "Referenced record does not exist." };
  if (error?.code === "23514") return { status: 400, message: "That change violates a data constraint." };
  return { status: 500, message };
};

export const sendInventoryError = (res, error, fallbackMessage) => {
  const { status, message } = mapInventoryError(error);
  return res.status(status).json({ success: false, message: message || fallbackMessage });
};
