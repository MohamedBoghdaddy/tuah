import {
  VALID_STATUSES,
  listAdminOrders as listAdminOrdersRows,
  findOrderById,
  createOrder as createOrderRow,
  updateOrder as updateOrderRow,
  updateOrderStatus as updateOrderStatusRow,
  cancelOrder as cancelOrderRow,
  generateOrderNumber,
} from "../models-pg/orders.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

const sanitize = (v) => (typeof v === "string" ? v.trim() : v);

const FIELD_MAP = {
  orderNumber: "order_number",
  customerName: "customer_name",
  customerEmail: "customer_email",
  notes: "notes",
  assignedEmployeeName: "assigned_employee_name",
  customerId: "customer_id",
  assignedEmployeeId: "assigned_employee_id",
  subtotal: "subtotal",
  tax: "tax",
  installationFee: "installation_fee",
  discount: "discount",
  total: "total",
  status: "status",
  paymentStatus: "payment_status",
  installationPreference: "installation_preference",
  estimatedDays: "estimated_days",
};

const buildOrderPayload = (body) => {
  const p = {};

  ["orderNumber", "customerName", "customerEmail", "notes", "assignedEmployeeName"].forEach((f) => {
    if (body[f] !== undefined) p[FIELD_MAP[f]] = sanitize(body[f]);
  });

  if (body.customerId !== undefined) p.customer_id = body.customerId || null;
  if (body.assignedEmployeeId !== undefined) p.assigned_employee_id = body.assignedEmployeeId || null;

  ["subtotal", "tax", "installationFee", "discount", "total"].forEach((f) => {
    if (body[f] !== undefined) p[FIELD_MAP[f]] = Number(body[f]) || 0;
  });

  if (body.status !== undefined) p.status = sanitize(body.status);
  if (body.paymentStatus !== undefined) p.payment_status = sanitize(body.paymentStatus);
  if (body.installationPreference !== undefined) p.installation_preference = sanitize(body.installationPreference);
  if (body.estimatedDays !== undefined) p.estimated_days = body.estimatedDays ? Number(body.estimatedDays) : null;

  if (body.deliveryAddress && typeof body.deliveryAddress === "object") {
    p.delivery_address = {
      line1: sanitize(body.deliveryAddress.line1) || "",
      city: sanitize(body.deliveryAddress.city) || "",
      country: sanitize(body.deliveryAddress.country) || "",
    };
  }

  return p;
};

const buildOrderItems = (body) => {
  if (!Array.isArray(body.items)) return undefined;
  return body.items.map((item) => ({
    productId: item.productId || null,
    name: sanitize(item.name) || "Item",
    quantity: Math.max(1, Number(item.quantity) || 1),
    unitPrice: Number(item.unitPrice) || 0,
    total: Number(item.total) || 0,
    imageUrl: item.imageUrl || "",
    sku: item.sku || "",
  }));
};

export const listAdminOrders = async (req, res) => {
  const { status, page = 1, limit = 100 } = req.query;
  const { orders, total } = await listAdminOrdersRows({ status, page, limit });
  return res.json({ success: true, count: orders.length, total, orders });
};

export const getAdminOrder = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  const order = await findOrderById(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });
  return res.json({ success: true, order });
};

export const createAdminOrder = async (req, res) => {
  try {
    const payload = buildOrderPayload(req.body);
    if (!payload.order_number) payload.order_number = generateOrderNumber();

    if (payload.status && !VALID_STATUSES.includes(payload.status)) {
      return res.status(400).json({ success: false, message: "Invalid order status." });
    }

    const order = await createOrderRow(payload, buildOrderItems(req.body) || []);
    return res.status(201).json({ success: true, order });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Order number already exists." });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAdminOrder = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  try {
    const payload = buildOrderPayload(req.body);
    if (payload.status && !VALID_STATUSES.includes(payload.status)) {
      return res.status(400).json({ success: false, message: "Invalid order status." });
    }

    const order = await updateOrderRow(req.params.id, payload, buildOrderItems(req.body));
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    return res.json({ success: true, order });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAdminOrderStatus = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  const status = typeof req.body.status === "string" ? req.body.status.trim() : "";
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
  }
  try {
    const order = await updateOrderStatusRow(req.params.id, status);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    return res.json({ success: true, order });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const cancelAdminOrder = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  try {
    const order = await cancelOrderRow(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    return res.json({ success: true, order, message: "Order cancelled." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
