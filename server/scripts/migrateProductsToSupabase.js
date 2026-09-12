/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 2.
 *
 * Copies every existing MongoDB `products` document (including embedded
 * `reviews[]` and `galleryImages[]`) into the new Postgres `products`,
 * `product_reviews`, and `product_gallery_images` tables (see
 * server/supabase/migrations/0002_products.sql).
 *
 * Also copies each User's `wishlist: [ObjectId]` array into the new
 * `wishlist_items` join table, using the user id-map from Phase 1
 * (mongo-to-postgres-id-map.json) to resolve which Postgres user row each
 * wishlist belongs to. Users not yet migrated (id-map miss) are skipped.
 *
 * Idempotent by slug/sku-or-name: re-running skips products that already
 * exist in Postgres.
 *
 * Extends server/scripts/mongo-to-postgres-id-map.json with a `products` map
 * — later phases (Orders/Cart) need it to resolve Order.items[].productId /
 * Cart.items[].productId from the old Mongo ObjectId to the new Postgres UUID.
 *
 * Run: node server/scripts/migrateProductsToSupabase.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL;
if (!MONGO_URI) {
  console.error("MONGO_URI (or MONGO_URL) not set in server/.env — nothing to migrate from.");
  process.exit(1);
}

const { supabaseAdmin, isSupabaseConfigured } = await import("../config/supabase.js");
if (!isSupabaseConfigured()) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in server/.env — nothing to migrate to.");
  process.exit(1);
}

const ProductModel = mongoose.models.Product || mongoose.model(
  "Product",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);
const UserModel = mongoose.models.User || mongoose.model(
  "User",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const idMapPath = join(__dirname, "mongo-to-postgres-id-map.json");
const idMap = fs.existsSync(idMapPath) ? JSON.parse(fs.readFileSync(idMapPath, "utf8")) : {};
idMap.users ||= {};
idMap.employees ||= {};
idMap.products ||= {};

const resolveUserId = (mongoId) => (mongoId ? idMap.users[String(mongoId)] || null : null);

const findExistingProductId = async (p) => {
  const identifiers = [p.slug, p.sku].filter(Boolean);
  for (const value of identifiers) {
    const column = value === p.slug ? "slug" : "sku";
    const { data } = await supabaseAdmin.from("products").select("id").eq(column, value).maybeSingle();
    if (data) return data.id;
  }
  if (!identifiers.length) {
    const { data } = await supabaseAdmin.from("products").select("id").eq("name", p.name).maybeSingle();
    if (data) return data.id;
  }
  return null;
};

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Pass 1: products ---");
  const products = await ProductModel.find().lean();
  for (const p of products) {
    const existingId = await findExistingProductId(p);
    if (existingId) {
      console.log(`  skip product "${p.name}" — already exists (${existingId})`);
      idMap.products[String(p._id)] = existingId;
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("products")
      .insert({
        name: p.name,
        slug: p.slug || null,
        description: p.description,
        category: p.category,
        collection: p.collection || null,
        price: p.price,
        discount_price: p.discountPrice ?? null,
        sku: p.sku || null,
        material: p.material || null,
        color: p.color || null,
        room: p.room || null,
        use_case: p.useCase || null,
        dimensions: p.dimensions || null,
        tags: p.tags || [],
        images: p.images || [],
        stock: p.stock || 0,
        low_stock_threshold: p.lowStockThreshold ?? 5,
        sold: p.sold || 0,
        average_rating: p.averageRating || 0,
        created_by: resolveUserId(p.createdBy),
        image_url: p.imageUrl || null,
        image_asset_id: p.imageAssetId || null,
        featured: p.featured || false,
        status: p.status || "active",
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  FAILED product "${p.name}": ${error.message}`);
      continue;
    }

    const newId = data.id;
    idMap.products[String(p._id)] = newId;
    console.log(`  migrated product "${p.name}" -> ${newId}`);

    for (const review of p.reviews || []) {
      const { error: reviewError } = await supabaseAdmin.from("product_reviews").insert({
        product_id: newId,
        user_id: resolveUserId(review.user),
        name: review.name,
        rating: review.rating,
        comment: review.comment || null,
      });
      if (reviewError) console.error(`    FAILED review by ${review.name}: ${reviewError.message}`);
    }

    const galleryImages = (p.galleryImages || []).map((g, i) => ({
      product_id: newId,
      url: g.url || null,
      asset_id: g.assetId || null,
      alt_text: g.altText || null,
      position: i,
    }));
    if (galleryImages.length) {
      const { error: galleryError } = await supabaseAdmin.from("product_gallery_images").insert(galleryImages);
      if (galleryError) console.error(`    FAILED gallery images: ${galleryError.message}`);
    }
  }

  fs.writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  console.log(`\nWrote id map to ${idMapPath}`);

  console.log("\n--- Pass 2: wishlists ---");
  const users = await UserModel.find({ wishlist: { $exists: true, $ne: [] } }).lean();
  for (const u of users) {
    const newUserId = idMap.users[String(u._id)];
    if (!newUserId) {
      console.log(`  skip wishlist for ${u.email} — user not migrated yet`);
      continue;
    }
    const rows = (u.wishlist || [])
      .map((pid) => idMap.products[String(pid)])
      .filter(Boolean)
      .map((productId) => ({ user_id: newUserId, product_id: productId }));
    if (!rows.length) continue;

    const { error } = await supabaseAdmin.from("wishlist_items").upsert(rows, { onConflict: "user_id,product_id" });
    if (error) console.error(`  FAILED wishlist for ${u.email}: ${error.message}`);
    else console.log(`  migrated ${rows.length} wishlist item(s) for ${u.email}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
