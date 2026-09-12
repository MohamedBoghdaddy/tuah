import express from "express";
import { isAuthenticated } from "../middleware/AuthMiddleware.js";
import {
  createOrder,
  listOrdersForCustomer,
  findOrderForCustomer,
  cancelOrder,
  generateOrderNumber,
} from "../models-pg/orders.js";
import { findProductById } from "../models-pg/products.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

// ── POST /api/orders — customer checkout creates a real order ────────────────
router.post("/", isAuthenticated, asyncRoute(async (req, res) => {
  const { items = [], delivery = {}, payment = {}, totals = {}, customer = {} } = req.body;

  if (!items.length) {
    return res.status(400).json({ success: false, message: "Order must contain at least one item." });
  }

  // Resolve product details from Postgres (validate they exist and are active)
  const resolvedItems = [];
  for (const item of items) {
    const productId = item.productId || item.id;
    let name = item.name;
    let unitPrice = Number(item.price || item.unitPrice || 0);
    let imageUrl = item.imageUrl || "";
    let sku = item.sku || "";

    if (productId && isValidId(productId)) {
      const prod = await findProductById(productId);
      if (prod && prod.status !== "archived") {
        name = prod.name;
        unitPrice = prod.price;
        imageUrl = prod.imageUrl || "";
        sku = prod.sku || "";
      }
    }

    const qty = Math.max(1, Number(item.quantity || 1));
    resolvedItems.push({ productId: productId || null, name: name || "Product", quantity: qty, unitPrice, total: unitPrice * qty, imageUrl, sku });
  }

  const subtotal = resolvedItems.reduce((s, i) => s + i.total, 0);
  const tax = Number(totals.tax ?? Math.round(subtotal * 0.08));
  const installationFee = Number(totals.install ?? 450);
  const total = Number(totals.total ?? subtotal + tax + installationFee);

  const customerName = customer.name ||
    [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
    req.user.username || "Customer";

  const order = await createOrder({
    order_number: generateOrderNumber(),
    customer_id: req.user.id,
    customer_name: customerName,
    customer_email: req.user.email,
    subtotal,
    tax,
    installation_fee: installationFee,
    total,
    status: "new",
    payment_status: "pending",
    installation_preference: delivery.installType || "full",
    delivery_address: {
      line1: delivery.address || customer.address || "",
      city: delivery.city || customer.city || "",
      country: delivery.country || customer.country || "UK",
    },
    notes: req.body.notes || "",
  }, resolvedItems);

  return res.status(201).json({ success: true, order });
}));

// ── GET /api/orders/my — customer sees only their own orders ─────────────────
router.get("/my", isAuthenticated, asyncRoute(async (req, res) => {
  const orders = await listOrdersForCustomer(req.user.id, 50);
  return res.json({ success: true, orders, count: orders.length });
}));

// ── GET /api/orders/:id — customer sees one of their own orders ───────────────
router.get("/:id", isAuthenticated, asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  const order = await findOrderForCustomer(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });
  return res.json({ success: true, order });
}));

// ── PATCH /api/orders/:id/cancel — customer cancels own new order ─────────────
router.patch("/:id/cancel", isAuthenticated, asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid order id." });
  }
  const order = await findOrderForCustomer(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ success: false, message: "Order not found." });
  if (!["new", "confirmed"].includes(order.status)) {
    return res.status(409).json({ success: false, message: `Cannot cancel order in status: ${order.status}.` });
  }
  const cancelled = await cancelOrder(req.params.id);
  return res.json({ success: true, order: cancelled, message: "Order cancelled." });
}));

export default router;
