/**
 * Customer account routes — all require isAuthenticated.
 * Customers can only access their own data.
 *
 *  Address book:    GET|POST /api/customer/addresses
 *                   PATCH|DELETE /api/customer/addresses/:id
 *                   PATCH /api/customer/addresses/:id/default
 *
 *  Payment methods: GET /api/customer/payment-methods
 *                   DELETE /api/customer/payment-methods/:id
 *                   PATCH /api/customer/payment-methods/:id/default
 *
 *  Wishlist:        GET /api/customer/wishlist
 *                   POST /api/customer/wishlist/:productId
 *                   DELETE /api/customer/wishlist/:productId
 */
import express from "express";
import { isAuthenticated } from "../middleware/AuthMiddleware.js";
import {
  listAddresses,
  createAddress,
  clearDefaultAddresses,
  updateAddressForUser,
  deleteAddressForUser,
  listActivePaymentMethods,
  clearDefaultPaymentMethods,
  updatePaymentMethodForUser,
} from "../models-pg/customer.js";
import {
  findProductById,
  listWishlist as listWishlistRows,
  addToWishlist as addToWishlistRow,
  removeFromWishlist as removeFromWishlistRow,
  clearWishlist as clearWishlistRow,
} from "../models-pg/products.js";

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);
const isValidProductId = isValidId;

router.use(isAuthenticated);

// ─── Addresses ────────────────────────────────────────────────────────────────

router.get("/addresses", asyncRoute(async (req, res) => {
  const addresses = await listAddresses(req.user.id);
  return res.json({ success: true, addresses });
}));

router.post("/addresses", asyncRoute(async (req, res) => {
  const { label, fullName, phone, line1, line2, city, state, country, postalCode, isDefaultShipping, isDefaultBilling } = req.body;
  if (!line1 || !city || !country) {
    return res.status(400).json({ success: false, message: "line1, city, and country are required." });
  }

  // Clear previous default if this one is default
  if (isDefaultShipping) await clearDefaultAddresses(req.user.id, "is_default_shipping");
  if (isDefaultBilling) await clearDefaultAddresses(req.user.id, "is_default_billing");

  const address = await createAddress({
    user_id: req.user.id, label, full_name: fullName, phone, line1, line2, city, state, country,
    postal_code: postalCode, is_default_shipping: !!isDefaultShipping, is_default_billing: !!isDefaultBilling,
  });
  return res.status(201).json({ success: true, address });
}));

const ADDRESS_FIELD_MAP = {
  label: "label", fullName: "full_name", phone: "phone", line1: "line1", line2: "line2",
  city: "city", state: "state", country: "country", postalCode: "postal_code",
  isDefaultShipping: "is_default_shipping", isDefaultBilling: "is_default_billing",
};

router.patch("/addresses/:id", asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid address id." });
  const updates = {};
  Object.entries(ADDRESS_FIELD_MAP).forEach(([bodyKey, column]) => {
    if (req.body[bodyKey] !== undefined) updates[column] = req.body[bodyKey];
  });
  const address = await updateAddressForUser(req.params.id, req.user.id, updates);
  if (!address) return res.status(404).json({ success: false, message: "Address not found." });
  return res.json({ success: true, address });
}));

router.delete("/addresses/:id", asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid address id." });
  const address = await deleteAddressForUser(req.params.id, req.user.id);
  if (!address) return res.status(404).json({ success: false, message: "Address not found." });
  return res.json({ success: true, message: "Address deleted." });
}));

router.patch("/addresses/:id/default", asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid address id." });
  const { type = "shipping" } = req.body;
  const field = type === "billing" ? "is_default_billing" : "is_default_shipping";
  await clearDefaultAddresses(req.user.id, field);
  const address = await updateAddressForUser(req.params.id, req.user.id, { [field]: true });
  if (!address) return res.status(404).json({ success: false, message: "Address not found." });
  return res.json({ success: true, address });
}));

// ─── Payment Methods (metadata only — no raw card data) ───────────────────────

router.get("/payment-methods", asyncRoute(async (req, res) => {
  const methods = await listActivePaymentMethods(req.user.id);
  return res.json({ success: true, paymentMethods: methods });
}));

router.delete("/payment-methods/:id", asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid payment method id." });
  const method = await updatePaymentMethodForUser(req.params.id, req.user.id, { status: "removed" });
  if (!method) return res.status(404).json({ success: false, message: "Payment method not found." });
  return res.json({ success: true, message: "Payment method removed." });
}));

router.patch("/payment-methods/:id/default", asyncRoute(async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid payment method id." });
  await clearDefaultPaymentMethods(req.user.id);
  const method = await updatePaymentMethodForUser(req.params.id, req.user.id, { is_default: true });
  if (!method) return res.status(404).json({ success: false, message: "Payment method not found." });
  return res.json({ success: true, paymentMethod: method });
}));

// ─── Wishlist (backed by Postgres wishlist_items — see models-pg/products.js) ─

router.get("/wishlist", asyncRoute(async (req, res) => {
  const products = await listWishlistRows(req.user.id);
  return res.json({ success: true, wishlist: products.filter((p) => p.status !== "archived") });
}));

router.post("/wishlist/:productId", asyncRoute(async (req, res) => {
  const { productId } = req.params;
  if (!isValidProductId(productId)) return res.status(400).json({ success: false, message: "Invalid product id." });
  const product = await findProductById(productId);
  if (!product || product.status === "archived") {
    return res.status(404).json({ success: false, message: "Product not found." });
  }
  await addToWishlistRow(req.user.id, product._id);
  return res.json({ success: true, message: `${product.name} added to wishlist.` });
}));

router.delete("/wishlist/:productId", asyncRoute(async (req, res) => {
  const { productId } = req.params;
  if (!isValidProductId(productId)) return res.status(400).json({ success: false, message: "Invalid product id." });
  await removeFromWishlistRow(req.user.id, productId);
  return res.json({ success: true, message: "Removed from wishlist." });
}));

router.delete("/wishlist", asyncRoute(async (req, res) => {
  await clearWishlistRow(req.user.id);
  return res.json({ success: true, message: "Wishlist cleared." });
}));

export default router;
