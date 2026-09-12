import express from "express";
import {
  getCart,
  addCartItem,
  setCartItemQuantity,
  removeCartItem,
  clearCart,
  mergeCartItems,
} from "../models-pg/carts.js";
import { findProductById } from "../models-pg/products.js";
import { verifyUser } from "../middleware/AuthMiddleware.js";

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

router.use(verifyUser);

const normalizeQuantity = (value, fallback = 1) => {
  const quantity = Number(value ?? fallback);
  if (!Number.isFinite(quantity)) return fallback;
  return Math.max(0, Math.floor(quantity));
};

const productIdFromPayload = (payload = {}) =>
  String(
    payload.productId ||
      payload._id ||
      payload.id ||
      payload.item?.productId ||
      payload.item?._id ||
      payload.item?.id ||
      "",
  );

const isPurchasableProduct = (product) =>
  product && !["archived", "inactive", "draft"].includes(String(product.status || "active"));

const toProductPayload = (product) => {
  if (!product) return null;
  return {
    ...product,
    productId: String(product._id),
    image: product.imageUrl || product.images?.[0] || product.galleryImages?.[0]?.url || "",
    img: product.imageUrl || product.images?.[0] || product.galleryImages?.[0]?.url || "",
  };
};

const serializeCart = (cart) => {
  const items = (cart.items || []).map((item) => {
    const product = toProductPayload(item.product);
    return {
      ...(product || {
        id: item.productId,
        _id: item.productId,
        productId: item.productId,
        name: "Product unavailable",
        title: "Product unavailable",
        price: 0,
        stock: 0,
        status: "unavailable",
        unavailable: true,
      }),
      product,
      productId: item.productId,
      quantity: item.quantity,
      addedAt: item.addedAt,
      unavailable: !product,
    };
  });

  return { _id: cart._id, userId: cart.userId, items, updatedAt: cart.updatedAt };
};

const sendCart = async (res, userId, status = 200, extra = {}) => {
  const cart = serializeCart(await getCart(userId));
  return res.status(status).json({ success: true, cart, items: cart.items, ...extra });
};

const findPurchasableProduct = async (productId) => {
  if (!isValidId(productId)) return null;
  const product = await findProductById(productId);
  return isPurchasableProduct(product) ? product : null;
};

router.get("/", async (req, res, next) => {
  try {
    return sendCart(res, req.user.id);
  } catch (error) {
    return next(error);
  }
});

router.post("/items", async (req, res, next) => {
  try {
    const productId = productIdFromPayload(req.body);
    const quantity = normalizeQuantity(req.body.quantity ?? req.body.item?.quantity, 1);

    if (!isValidId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id." });
    }
    if (quantity < 1) {
      return res.status(400).json({ success: false, message: "Quantity must be at least 1." });
    }

    const product = await findPurchasableProduct(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }
    if (Number(product.stock) >= 0 && quantity > Number(product.stock)) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} item(s) available.` });
    }

    await addCartItem(req.user.id, productId, quantity);
    return sendCart(res, req.user.id, 200, { message: "Added to cart." });
  } catch (error) {
    return next(error);
  }
});

router.patch("/items/:productId", async (req, res, next) => {
  try {
    const { productId } = req.params;
    const quantity = normalizeQuantity(req.body.quantity, 0);

    if (!isValidId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id." });
    }

    if (quantity <= 0) {
      await removeCartItem(req.user.id, productId);
      return sendCart(res, req.user.id, 200, { message: "Removed from cart." });
    }

    const product = await findPurchasableProduct(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }
    if (Number(product.stock) >= 0 && quantity > Number(product.stock)) {
      return res.status(400).json({ success: false, message: `Only ${product.stock} item(s) available.` });
    }

    await setCartItemQuantity(req.user.id, productId, quantity);
    return sendCart(res, req.user.id, 200, { message: "Cart updated." });
  } catch (error) {
    return next(error);
  }
});

router.delete("/items/:productId", async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!isValidId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id." });
    }

    await removeCartItem(req.user.id, productId);
    return sendCart(res, req.user.id, 200, { message: "Removed from cart." });
  } catch (error) {
    return next(error);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    await clearCart(req.user.id);
    return sendCart(res, req.user.id, 200, { message: "Cart cleared." });
  } catch (error) {
    return next(error);
  }
});

router.post("/merge", async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body.items)
      ? req.body.items
      : Object.values(req.body.items || {});

    const normalizedItems = rawItems
      .map((rawItem) => ({
        productId: productIdFromPayload(rawItem),
        quantity: normalizeQuantity(rawItem.quantity, 1),
      }))
      .filter((item) => isValidId(item.productId) && item.quantity >= 1);

    const { skipped: invalidSkipped } = { skipped: rawItems.length - normalizedItems.length };
    const { skipped } = await mergeCartItems(req.user.id, normalizedItems, findPurchasableProduct);

    return sendCart(res, req.user.id, 200, {
      message: "Cart merged.",
      skipped: [...(invalidSkipped ? [{ reason: "invalid_product_or_quantity", count: invalidSkipped }] : []), ...skipped],
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
