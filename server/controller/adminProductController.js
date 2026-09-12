import {
  listAdminProducts,
  findProductById,
  createProduct as createProductRow,
  updateProduct as updateProductRow,
  archiveProduct as archiveProductRow,
  updateProductStock as updateProductStockRow,
  updateProductStatus as updateProductStatusRow,
  ensureUniqueSlug,
  listPublicProducts as listPublicProductsRows,
  getPublicProductBySlugOrId as getPublicProductBySlugOrIdRow,
} from "../models-pg/products.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

const slugify = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const numberOr = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : NaN;
};

const sanitizeString = (value) =>
  typeof value === "string" ? value.trim() : value;

// Maps the camelCase body fields this API has always accepted to the
// snake_case columns in Postgres.
const FIELD_MAP = {
  name: "name",
  slug: "slug",
  description: "description",
  category: "category",
  collection: "collection",
  sku: "sku",
  material: "material",
  color: "color",
  room: "room",
  useCase: "use_case",
  dimensions: "dimensions",
  price: "price",
  discountPrice: "discount_price",
  stock: "stock",
  lowStockThreshold: "low_stock_threshold",
  featured: "featured",
  isFeatured: "featured",
  status: "status",
  images: "images",
  tags: "tags",
};

const buildProductPayload = (body, { partial = false } = {}) => {
  const payload = {};
  const stringFields = ["name", "description", "category", "collection", "sku", "material", "color", "room", "useCase", "dimensions"];

  stringFields.forEach((field) => {
    if (body[field] !== undefined) payload[FIELD_MAP[field]] = sanitizeString(body[field]);
  });

  if (body.slug !== undefined) payload.slug = slugify(body.slug);
  if (!partial && !payload.slug && payload.name) payload.slug = slugify(payload.name);
  if (payload.sku === "") delete payload.sku;
  if (payload.slug === "") delete payload.slug;

  ["price", "discountPrice", "stock", "lowStockThreshold"].forEach((field) => {
    if (body[field] !== undefined) payload[FIELD_MAP[field]] = numberOr(body[field], field === "stock" ? 0 : null);
  });

  if (body.featured !== undefined) payload.featured = Boolean(body.featured);
  if (body.isFeatured !== undefined) payload.featured = Boolean(body.isFeatured);
  if (body.status !== undefined) payload.status = sanitizeString(body.status);
  if (Array.isArray(body.images)) payload.images = body.images.filter(Boolean);
  if (Array.isArray(body.tags)) {
    payload.tags = body.tags.map(sanitizeString).filter(Boolean);
  } else if (typeof body.tags === "string") {
    payload.tags = body.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  return payload;
};

const validateProductPayload = (payload, { partial = false } = {}) => {
  const required = ["name", "description", "category", "price", "stock"];
  const bodyKeys = { name: payload.name, description: payload.description, category: payload.category, price: payload.price, stock: payload.stock };
  if (!partial) {
    const missing = required.filter((field) => bodyKeys[field] === undefined || bodyKeys[field] === "");
    if (missing.length) return `${missing.join(", ")} required.`;
  }

  if (payload.price !== undefined && (!Number.isFinite(payload.price) || payload.price < 0)) {
    return "Price must be a non-negative number.";
  }
  if (
    payload.discount_price !== undefined &&
    payload.discount_price !== null &&
    (!Number.isFinite(payload.discount_price) || payload.discount_price < 0)
  ) {
    return "Discount price must be a non-negative number.";
  }
  if (payload.stock !== undefined && (!Number.isFinite(payload.stock) || payload.stock < 0)) {
    return "Stock must be a non-negative number.";
  }
  if (
    payload.low_stock_threshold !== undefined &&
    payload.low_stock_threshold !== null &&
    (!Number.isFinite(payload.low_stock_threshold) || payload.low_stock_threshold < 0)
  ) {
    return "Low stock threshold must be a non-negative number.";
  }

  return null;
};

const handleDuplicate = (error, res) => {
  if (error?.code !== "23505") return false;
  res.status(409).json({ success: false, message: error.message });
  return true;
};

// Consumed by routes/commerceRoutes.js for the public storefront catalog.
export const listPublicProducts = (filters) => listPublicProductsRows(filters);
export const getPublicProductBySlugOrId = (slugOrId) => getPublicProductBySlugOrIdRow(slugOrId, { isValidId });

export const getAdminProducts = async (req, res) => {
  const { status, collection, category, q, page = 1, limit = 100 } = req.query;
  const { products, total } = await listAdminProducts({ status, collection, category, q, page, limit });
  return res.json({ success: true, count: products.length, total, products });
};

export const getAdminProduct = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product id." });
  }

  const product = await findProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found." });
  return res.json({ success: true, product });
};

export const createAdminProduct = async (req, res) => {
  try {
    const payload = buildProductPayload(req.body);
    const validationError = validateProductPayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    payload.slug = await ensureUniqueSlug(payload.slug || slugify(payload.name));
    if (payload.sku) payload.sku = payload.sku.toUpperCase();
    if (req.user?.id) payload.created_by = req.user.id;

    const product = await createProductRow(payload);
    return res.status(201).json({ success: true, product });
  } catch (error) {
    if (handleDuplicate(error, res)) return;
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdminProduct = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product id." });
  }

  try {
    const payload = buildProductPayload(req.body, { partial: true });
    const validationError = validateProductPayload(payload, { partial: true });
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    if (payload.name && !payload.slug && req.body.slug === undefined) {
      payload.slug = await ensureUniqueSlug(slugify(payload.name), req.params.id);
    } else if (payload.slug) {
      payload.slug = await ensureUniqueSlug(payload.slug, req.params.id);
    }
    if (payload.sku) payload.sku = payload.sku.toUpperCase();

    const product = await updateProductRow(req.params.id, payload);
    if (!product) return res.status(404).json({ success: false, message: "Product not found." });
    return res.json({ success: true, product });
  } catch (error) {
    if (handleDuplicate(error, res)) return;
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const archiveAdminProduct = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product id." });
  }

  const product = await archiveProductRow(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found." });
  return res.json({ success: true, product, message: "Product archived." });
};

export const updateAdminProductStock = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product id." });
  }
  const stock = numberOr(req.body.stock);
  if (!Number.isFinite(stock) || stock < 0) {
    return res.status(400).json({ success: false, message: "Stock must be a non-negative number." });
  }

  const product = await updateProductStockRow(req.params.id, stock);
  if (!product) return res.status(404).json({ success: false, message: "Product not found." });
  return res.json({ success: true, product });
};

export const updateAdminProductStatus = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid product id." });
  }

  const status = sanitizeString(req.body.status);
  if (!["active", "draft", "archived", "inactive"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid product status." });
  }

  const product = await updateProductStatusRow(req.params.id, status);
  if (!product) return res.status(404).json({ success: false, message: "Product not found." });
  return res.json({ success: true, product });
};
