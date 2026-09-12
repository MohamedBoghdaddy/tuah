/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 3.
 *
 * Copies every existing MongoDB `carts` and `orders` document (including
 * embedded `items[]`) into the new Postgres `carts`/`cart_items` and
 * `orders`/`order_items` tables (see server/supabase/migrations/0003_orders.sql).
 *
 * Resolves customerId/assignedEmployeeId/productId references using the
 * id-map built by the Phase 1 (users/employees) and Phase 2 (products)
 * backfill scripts — run those first. Carts/orders whose userId/customerId
 * has no entry in the id-map (i.e. that user hasn't been migrated) are skipped
 * with a warning rather than guessed at.
 *
 * Idempotent by order_number for orders, and by user_id for carts.
 *
 * Run: node server/scripts/migrateOrdersToSupabase.js
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

const idMapPath = join(__dirname, "mongo-to-postgres-id-map.json");
if (!fs.existsSync(idMapPath)) {
  console.error(`${idMapPath} not found — run migrateUsersEmployeesToSupabase.js and migrateProductsToSupabase.js first.`);
  process.exit(1);
}
const idMap = JSON.parse(fs.readFileSync(idMapPath, "utf8"));
idMap.users ||= {};
idMap.employees ||= {};
idMap.products ||= {};

const resolveUserId = (mongoId) => (mongoId ? idMap.users[String(mongoId)] || null : null);
const resolveEmployeeId = (mongoId) => (mongoId ? idMap.employees[String(mongoId)] || null : null);
const resolveProductId = (mongoId) => (mongoId ? idMap.products[String(mongoId)] || null : null);

const CartModel = mongoose.models.Cart || mongoose.model(
  "Cart",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);
const OrderModel = mongoose.models.Order || mongoose.model(
  "Order",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Carts ---");
  const carts = await CartModel.find().lean();
  for (const c of carts) {
    const newUserId = resolveUserId(c.userId);
    if (!newUserId) {
      console.log(`  skip cart for mongo user ${c.userId} — user not migrated yet`);
      continue;
    }

    const { data: existingCart } = await supabaseAdmin.from("carts").select("id").eq("user_id", newUserId).maybeSingle();
    const cartId = existingCart?.id || (
      await supabaseAdmin.from("carts").insert({ user_id: newUserId }).select("id").single()
    ).data?.id;
    if (!cartId) {
      console.error(`  FAILED to create cart for user ${newUserId}`);
      continue;
    }

    const rows = (c.items || [])
      .map((item) => ({ cart_id: cartId, product_id: resolveProductId(item.productId) || item.productId, quantity: item.quantity || 1 }))
      .filter((row) => row.product_id);

    if (rows.length) {
      const { error } = await supabaseAdmin.from("cart_items").upsert(rows, { onConflict: "cart_id,product_id" });
      if (error) console.error(`  FAILED cart items for user ${newUserId}: ${error.message}`);
      else console.log(`  migrated cart (${rows.length} item(s)) for user ${newUserId}`);
    }
  }

  console.log("\n--- Orders ---");
  const orders = await OrderModel.find().lean();
  for (const o of orders) {
    const { data: existing } = await supabaseAdmin.from("orders").select("id").eq("order_number", o.orderNumber).maybeSingle();
    if (existing) {
      console.log(`  skip order ${o.orderNumber} — already exists`);
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: o.orderNumber,
        customer_id: resolveUserId(o.customerId),
        customer_name: o.customerName || "",
        customer_email: o.customerEmail || "",
        subtotal: o.subtotal || 0,
        tax: o.tax || 0,
        installation_fee: o.installationFee || 0,
        discount: o.discount || 0,
        total: o.total || 0,
        status: o.status || "new",
        payment_status: o.paymentStatus || "pending",
        assigned_employee_id: resolveEmployeeId(o.assignedEmployeeId),
        assigned_employee_name: o.assignedEmployeeName || "",
        delivery_address: o.deliveryAddress || {},
        installation_preference: o.installationPreference || "full",
        estimated_days: o.estimatedDays ?? null,
        notes: o.notes || "",
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  FAILED order ${o.orderNumber}: ${error.message}`);
      continue;
    }

    const items = (o.items || []).map((item) => ({
      order_id: data.id,
      product_id: resolveProductId(item.productId) || null,
      name: item.name || "Item",
      quantity: item.quantity || 1,
      unit_price: item.unitPrice || 0,
      total: item.total || 0,
      image_url: item.imageUrl || "",
      sku: item.sku || "",
    }));
    if (items.length) {
      const { error: itemsError } = await supabaseAdmin.from("order_items").insert(items);
      if (itemsError) console.error(`    FAILED items for order ${o.orderNumber}: ${itemsError.message}`);
    }

    console.log(`  migrated order ${o.orderNumber} -> ${data.id}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
