// Postgres (Supabase) data-access layer for `carts`/`cart_items`, replacing model/Cart.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";
import { toProductJSON } from "./products.js";

export const isCartsDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

const ITEMS_SELECT = "id, quantity, added_at, products(*, product_reviews(*), product_gallery_images(*))";

const toCartJSON = (cartRow, itemRows) => ({
  _id: cartRow.id,
  userId: cartRow.user_id,
  items: (itemRows || []).map((item) => ({
    productId: item.products?.id || null,
    quantity: item.quantity,
    addedAt: item.added_at,
    product: toProductJSON(item.products),
  })),
  updatedAt: cartRow.updated_at,
});

const getOrCreateCartRow = async (userId) => {
  const { data: existing, error: findError } = await supabaseAdmin
    .from("carts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(findError, "Failed to load cart.");
  if (existing) return existing;

  const { data: created, error: createError } = await supabaseAdmin
    .from("carts")
    .insert({ user_id: userId })
    .select()
    .single();
  throwIfError(createError, "Failed to create cart.");
  return created;
};

export const getCart = async (userId) => {
  const cartRow = await getOrCreateCartRow(userId);
  const { data: items, error } = await supabaseAdmin
    .from("cart_items")
    .select(ITEMS_SELECT)
    .eq("cart_id", cartRow.id);
  throwIfError(error, "Failed to load cart items.");
  return toCartJSON(cartRow, items);
};

export const addCartItem = async (userId, productId, quantity) => {
  const cartRow = await getOrCreateCartRow(userId);
  const { data: existing } = await supabaseAdmin
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartRow.id)
    .eq("product_id", productId)
    .maybeSingle();

  const nextQuantity = (existing?.quantity || 0) + quantity;
  const { error } = await supabaseAdmin
    .from("cart_items")
    .upsert(
      { cart_id: cartRow.id, product_id: productId, quantity: nextQuantity },
      { onConflict: "cart_id,product_id" },
    );
  throwIfError(error, "Failed to add item to cart.");
  return getCart(userId);
};

export const setCartItemQuantity = async (userId, productId, quantity) => {
  const cartRow = await getOrCreateCartRow(userId);
  if (quantity <= 0) {
    const { error } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("cart_id", cartRow.id)
      .eq("product_id", productId);
    throwIfError(error, "Failed to update cart.");
    return getCart(userId);
  }

  const { error } = await supabaseAdmin
    .from("cart_items")
    .upsert({ cart_id: cartRow.id, product_id: productId, quantity }, { onConflict: "cart_id,product_id" });
  throwIfError(error, "Failed to update cart.");
  return getCart(userId);
};

export const removeCartItem = async (userId, productId) => {
  const cartRow = await getOrCreateCartRow(userId);
  const { error } = await supabaseAdmin
    .from("cart_items")
    .delete()
    .eq("cart_id", cartRow.id)
    .eq("product_id", productId);
  throwIfError(error, "Failed to remove item from cart.");
  return getCart(userId);
};

export const clearCart = async (userId) => {
  const cartRow = await getOrCreateCartRow(userId);
  const { error } = await supabaseAdmin.from("cart_items").delete().eq("cart_id", cartRow.id);
  throwIfError(error, "Failed to clear cart.");
  return getCart(userId);
};

// Merges a list of { productId, quantity } into the cart, capping at each
// product's stock. Returns { cart, skipped }.
export const mergeCartItems = async (userId, rawItems, resolveProduct) => {
  const cartRow = await getOrCreateCartRow(userId);
  const { data: existingItems } = await supabaseAdmin
    .from("cart_items")
    .select("product_id, quantity")
    .eq("cart_id", cartRow.id);
  const existingByProduct = new Map((existingItems || []).map((i) => [i.product_id, i.quantity]));
  const skipped = [];
  const upserts = [];

  for (const { productId, quantity } of rawItems) {
    const product = await resolveProduct(productId);
    if (!product) {
      skipped.push({ productId, reason: "product_not_found" });
      continue;
    }

    const desired = (existingByProduct.get(productId) || 0) + quantity;
    const nextQuantity = Number(product.stock) >= 0 ? Math.min(desired, Number(product.stock)) : desired;
    if (nextQuantity < 1) {
      skipped.push({ productId, reason: "out_of_stock" });
      continue;
    }

    existingByProduct.set(productId, nextQuantity);
    upserts.push({ cart_id: cartRow.id, product_id: productId, quantity: nextQuantity });
  }

  if (upserts.length) {
    const { error } = await supabaseAdmin.from("cart_items").upsert(upserts, { onConflict: "cart_id,product_id" });
    throwIfError(error, "Failed to merge cart.");
  }

  return { cart: await getCart(userId), skipped };
};
