import express from "express";
import {
  listWishlist,
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
  findProductById,
} from "../models-pg/products.js";
import { verifyUser } from "../middleware/AuthMiddleware.js";

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

router.use(verifyUser);

const isWishableProduct = (product) =>
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

const sendWishlist = async (res, userId, status = 200, extra = {}) => {
  const products = await listWishlist(userId);
  const wishlist = products.map(toProductPayload);
  return res.status(status).json({
    success: true,
    wishlist,
    items: wishlist,
    ...extra,
  });
};

const findWishableProduct = async (productId) => {
  if (!isValidId(productId)) return null;
  const product = await findProductById(productId);
  return isWishableProduct(product) ? product : null;
};

router.get("/", async (req, res, next) => {
  try {
    return sendWishlist(res, req.user.id);
  } catch (error) {
    return next(error);
  }
});

router.post("/items", async (req, res, next) => {
  try {
    const productId = productIdFromPayload(req.body);
    if (!isValidId(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product id." });
    }

    const product = await findWishableProduct(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found." });
    }

    await addToWishlist(req.user.id, product._id);
    return sendWishlist(res, req.user.id, 200, {
      message: `${product.name} added to wishlist.`,
    });
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

    await removeFromWishlist(req.user.id, productId);
    return sendWishlist(res, req.user.id, 200, { message: "Removed from wishlist." });
  } catch (error) {
    return next(error);
  }
});

router.delete("/", async (req, res, next) => {
  try {
    await clearWishlist(req.user.id);
    return sendWishlist(res, req.user.id, 200, { message: "Wishlist cleared." });
  } catch (error) {
    return next(error);
  }
});

router.post("/merge", async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body.items)
      ? req.body.items
      : Object.values(req.body.items || {});
    const skipped = [];

    for (const rawItem of rawItems) {
      const productId = productIdFromPayload(rawItem);
      if (!isValidId(productId)) {
        skipped.push({ productId, reason: "invalid_product" });
        continue;
      }

      const product = await findWishableProduct(productId);
      if (!product) {
        skipped.push({ productId, reason: "product_not_found" });
        continue;
      }

      await addToWishlist(req.user.id, product._id);
    }

    return sendWishlist(res, req.user.id, 200, {
      message: "Wishlist merged.",
      skipped,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
