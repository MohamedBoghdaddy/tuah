// Postgres (Supabase) data-access layer for `products`, replacing model/productsmodel.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "products";
const REVIEWS_TABLE = "product_reviews";
const GALLERY_TABLE = "product_gallery_images";
const WISHLIST_TABLE = "wishlist_items";

export const isProductsDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

const withDuplicateCheck = (error, message) => {
  if (error?.code === "23505") {
    const key = /slug/i.test(error.message || "")
      ? "Slug"
      : /sku/i.test(error.message || "")
        ? "SKU"
        : /barcode/i.test(error.message || "")
          ? "Barcode"
          : "Field";
    const err = new Error(`${key} must be unique.`);
    err.code = "23505";
    return err;
  }
  return new Error(error?.message || message);
};

const SELECT_WITH_RELATIONS = "*, product_reviews(*), product_gallery_images(*)";

// Maps a Postgres row (with embedded product_reviews/product_gallery_images
// from a PostgREST relation select) back to the exact camelCase shape the
// frontend and other controllers already expect from the old Mongoose model.
export const toProductJSON = (row) => {
  if (!row) return null;
  const reviews = (row.product_reviews || []).map((r) => ({
    _id: r.id,
    user: r.user_id,
    name: r.name,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  const galleryImages = (row.product_gallery_images || [])
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((g) => ({ _id: g.id, url: g.url, assetId: g.asset_id, altText: g.alt_text }));

  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    collection: row.collection,
    price: row.price,
    discountPrice: row.discount_price,
    sku: row.sku,
    barcode: row.barcode,
    material: row.material,
    color: row.color,
    room: row.room,
    useCase: row.use_case,
    dimensions: row.dimensions,
    tags: row.tags || [],
    images: row.images || [],
    stock: row.stock,
    lowStockThreshold: row.low_stock_threshold,
    sold: row.sold,
    reviews,
    averageRating: row.average_rating,
    createdBy: row.created_by,
    imageUrl: row.image_url,
    imageAssetId: row.image_asset_id,
    galleryImages,
    featured: row.featured,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const escapePostgrestValue = (value) => String(value).replace(/[(),]/g, "");

export const ensureUniqueSlug = async (baseSlug, existingId = null) => {
  const fallback = baseSlug || `product-${Date.now()}`;
  let candidate = fallback;
  let suffix = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabaseAdmin.from(TABLE).select("id").eq("slug", candidate);
    if (existingId) query = query.neq("id", existingId);
    const { data, error } = await query.maybeSingle();
    throwIfError(error, "Failed to check slug uniqueness.");
    if (!data) return candidate;
    candidate = `${fallback}-${suffix}`;
    suffix += 1;
  }
};

export const findProductById = async (id) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SELECT_WITH_RELATIONS)
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "Failed to look up product.");
  return toProductJSON(data);
};

export const getPublicProductBySlugOrId = async (slugOrId, { isValidId } = {}) => {
  const column = isValidId?.(slugOrId) ? "id" : "slug";
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SELECT_WITH_RELATIONS)
    .eq(column, slugOrId)
    .eq("status", "active")
    .maybeSingle();
  throwIfError(error, "Failed to look up product.");
  return toProductJSON(data);
};

const SORT_MAP = {
  newest: [["featured", false], ["created_at", false]],
  price_asc: [["price", true], ["created_at", false]],
  price_desc: [["price", false], ["created_at", false]],
  name_asc: [["name", true]],
  featured: [["featured", false], ["created_at", false]],
};

export const listPublicProducts = async (filters = {}) => {
  const {
    search, q, category, collection, minPrice, maxPrice, material, color,
    room, useCase, inStock, sort = "newest", page, limit,
  } = filters;
  const searchText = String(search || q || "").trim();

  let query = supabaseAdmin.from(TABLE).select(SELECT_WITH_RELATIONS).eq("status", "active");

  if (collection) {
    const value = escapePostgrestValue(String(collection).trim());
    const singular = value.replace(/s$/i, "");
    query = query.or(`collection.ilike.${singular},collection.ilike.${singular}s,category.ilike.${singular},category.ilike.${singular}s`);
  }
  if (category) query = query.ilike("category", escapePostgrestValue(String(category).trim()));
  if (material) query = query.ilike("material", escapePostgrestValue(String(material).trim()));
  if (color) query = query.ilike("color", escapePostgrestValue(String(color).trim()));
  if (room || useCase) {
    const value = escapePostgrestValue(String(room || useCase).trim());
    query = query.or(`room.ilike.${value},use_case.ilike.${value}`);
  }
  if (searchText) {
    const like = `%${escapePostgrestValue(searchText)}%`;
    query = query.or(
      `name.ilike.${like},description.ilike.${like},category.ilike.${like},collection.ilike.${like},material.ilike.${like},color.ilike.${like}`,
    );
  }

  const min = Number(minPrice);
  const max = Number(maxPrice);
  if (Number.isFinite(min) && min >= 0) query = query.gte("price", min);
  if (Number.isFinite(max) && max >= 0) query = query.lte("price", max);

  if (String(inStock) === "true") query = query.gt("stock", 0);
  if (String(inStock) === "false") query = query.lte("stock", 0);

  const sortSpec = SORT_MAP[sort] || SORT_MAP.newest;
  sortSpec.forEach(([column, ascending]) => {
    query = query.order(column, { ascending });
  });

  if (page || limit) {
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 24));
    const from = (pageNumber - 1) * limitNumber;
    query = query.range(from, from + limitNumber - 1);
  }

  const { data, error } = await query;
  throwIfError(error, "Failed to list products.");
  return (data || []).map(toProductJSON);
};

export const listAdminProducts = async ({ status, collection, category, q, page = 1, limit = 100 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select(SELECT_WITH_RELATIONS, { count: "exact" }).order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (collection) query = query.ilike("collection", escapePostgrestValue(String(collection).trim()));
  if (category) query = query.ilike("category", escapePostgrestValue(String(category).trim()));
  if (q) {
    const like = `%${escapePostgrestValue(String(q))}%`;
    query = query.or(`name.ilike.${like},sku.ilike.${like},description.ilike.${like}`);
  }

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(200, Math.max(1, Number(limit) || 100));
  const from = (pageNumber - 1) * limitNumber;
  query = query.range(from, from + limitNumber - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list products.");
  return { products: (data || []).map(toProductJSON), total: count || 0 };
};

export const createProduct = async (fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(fields).select(SELECT_WITH_RELATIONS).single();
  if (error) throw withDuplicateCheck(error, "Failed to create product.");
  return toProductJSON(data);
};

export const updateProduct = async (id, updates) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(updates)
    .eq("id", id)
    .select(SELECT_WITH_RELATIONS)
    .maybeSingle();
  if (error) throw withDuplicateCheck(error, "Failed to update product.");
  return toProductJSON(data);
};

// Legacy unfiltered list/delete, used only by the deprecated productscontroller.js
// public-CRUD surface (adminProductController.js is the canonical admin path).
export const listAllProductsRaw = async () => {
  const { data, error } = await supabaseAdmin.from(TABLE).select(SELECT_WITH_RELATIONS);
  throwIfError(error, "Failed to list products.");
  return (data || []).map(toProductJSON);
};

export const deleteProductById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).delete().eq("id", id).select("id").maybeSingle();
  throwIfError(error, "Failed to delete product.");
  return data;
};

export const archiveProduct = (id) => updateProduct(id, { status: "archived" });
export const updateProductStock = (id, stock) => updateProduct(id, { stock });
export const updateProductStatus = (id, status) => updateProduct(id, { status });

// ── Reviews ──────────────────────────────────────────────────────────────────

const recomputeAverageRating = async (productId) => {
  const { data, error } = await supabaseAdmin.from(REVIEWS_TABLE).select("rating").eq("product_id", productId);
  throwIfError(error, "Failed to recompute average rating.");
  const ratings = data || [];
  const average = ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : 0;
  await supabaseAdmin.from(TABLE).update({ average_rating: average }).eq("id", productId);
  return average;
};

export const addProductReview = async (productId, { userId, name, rating, comment }) => {
  const { error } = await supabaseAdmin.from(REVIEWS_TABLE).insert({
    product_id: productId, user_id: userId || null, name, rating, comment: comment || null,
  });
  throwIfError(error, "Failed to add review.");
  await recomputeAverageRating(productId);
  return findProductById(productId);
};

// ── Gallery images ───────────────────────────────────────────────────────────

export const addGalleryImages = async (productId, images) => {
  if (!images.length) return findProductById(productId);
  const { data: existing } = await supabaseAdmin
    .from(GALLERY_TABLE)
    .select("position")
    .eq("product_id", productId)
    .order("position", { ascending: false })
    .limit(1);
  const startPosition = (existing?.[0]?.position ?? -1) + 1;

  const rows = images.map((img, i) => ({
    product_id: productId,
    url: img.url,
    asset_id: img.assetId,
    alt_text: img.altText || null,
    position: startPosition + i,
  }));
  const { error } = await supabaseAdmin.from(GALLERY_TABLE).insert(rows);
  throwIfError(error, "Failed to save gallery images.");
  return findProductById(productId);
};

// ── Analytics helpers ────────────────────────────────────────────────────────

export const countActiveProducts = async () => {
  const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).eq("status", "active");
  throwIfError(error, "Failed to count products.");
  return count || 0;
};

// Low-stock: stock <= low_stock_threshold. PostgREST's query builder can't
// compare two columns directly, so this filters client-side after a narrow select.
export const countLowStockActiveProducts = async () => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("stock, low_stock_threshold")
    .eq("status", "active");
  throwIfError(error, "Failed to count low-stock products.");
  return (data || []).filter((p) => p.stock <= p.low_stock_threshold).length;
};

export const listLowStockActiveProducts = async (limit = 10) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("status", "active");
  throwIfError(error, "Failed to list low-stock products.");
  return (data || [])
    .filter((p) => p.stock <= (p.low_stock_threshold ?? 5))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, limit)
    .map(toProductJSON);
};

export const countProductsExcludingStatus = async (status) => {
  const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).neq("status", status);
  throwIfError(error, "Failed to count products.");
  return count || 0;
};

// ── Wishlist ─────────────────────────────────────────────────────────────────

export const listWishlist = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from(WISHLIST_TABLE)
    .select(`created_at, products(${SELECT_WITH_RELATIONS})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  throwIfError(error, "Failed to load wishlist.");
  return (data || [])
    .map((row) => toProductJSON(row.products))
    .filter((p) => p && p.status !== "archived");
};

export const isInWishlist = async (userId, productId) => {
  const { data, error } = await supabaseAdmin
    .from(WISHLIST_TABLE)
    .select("user_id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();
  throwIfError(error, "Failed to check wishlist.");
  return Boolean(data);
};

export const addToWishlist = async (userId, productId) => {
  const { error } = await supabaseAdmin
    .from(WISHLIST_TABLE)
    .upsert({ user_id: userId, product_id: productId }, { onConflict: "user_id,product_id" });
  throwIfError(error, "Failed to add to wishlist.");
};

export const removeFromWishlist = async (userId, productId) => {
  const { error } = await supabaseAdmin.from(WISHLIST_TABLE).delete().eq("user_id", userId).eq("product_id", productId);
  throwIfError(error, "Failed to remove from wishlist.");
};

export const clearWishlist = async (userId) => {
  const { error } = await supabaseAdmin.from(WISHLIST_TABLE).delete().eq("user_id", userId);
  throwIfError(error, "Failed to clear wishlist.");
};
