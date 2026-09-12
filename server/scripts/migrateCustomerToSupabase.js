/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration,
 * Phase 8 prerequisite: customer addresses + payment methods.
 *
 * Copies every existing MongoDB `addresses` and `paymentmethods` document
 * into the new Postgres `addresses`/`payment_methods` tables (see
 * server/supabase/migrations/0008_addresses_payment_methods.sql).
 *
 * Resolves userId using the Phase 1 id-map — records whose user hasn't been
 * migrated yet are skipped with a warning.
 *
 * Run: node server/scripts/migrateCustomerToSupabase.js
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
  console.error(`${idMapPath} not found — run migrateUsersEmployeesToSupabase.js first.`);
  process.exit(1);
}
const idMap = JSON.parse(fs.readFileSync(idMapPath, "utf8"));
idMap.users ||= {};
const resolveUserId = (id) => (id ? idMap.users[String(id)] || null : null);

const dyn = (name) => mongoose.models[name] || mongoose.model(name, new mongoose.Schema({}, { strict: false, timestamps: true }));
const AddressModel = dyn("Address");
const PaymentMethodModel = dyn("PaymentMethod");

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Addresses ---");
  let addrMigrated = 0, addrSkipped = 0;
  for (const a of await AddressModel.find().lean()) {
    const userId = resolveUserId(a.userId);
    if (!userId) { addrSkipped++; continue; }

    const { error } = await supabaseAdmin.from("addresses").insert({
      user_id: userId, label: a.label || "Home", full_name: a.fullName || "", phone: a.phone || "",
      line1: a.line1 || "", line2: a.line2 || "", city: a.city || "", state: a.state || "",
      country: a.country || "", postal_code: a.postalCode || "",
      is_default_shipping: a.isDefaultShipping || false, is_default_billing: a.isDefaultBilling || false,
    });
    if (error) console.error(`  FAILED address for user ${userId}: ${error.message}`);
    else addrMigrated++;
  }
  console.log(`  migrated ${addrMigrated}, skipped ${addrSkipped} (user not yet migrated)`);

  console.log("\n--- Payment Methods ---");
  let pmMigrated = 0, pmSkipped = 0;
  for (const p of await PaymentMethodModel.find().lean()) {
    const userId = resolveUserId(p.userId);
    if (!userId) { pmSkipped++; continue; }

    const { error } = await supabaseAdmin.from("payment_methods").insert({
      user_id: userId, provider: p.provider || "manual",
      provider_customer_id: p.providerCustomerId || null, provider_payment_method_id: p.providerPaymentMethodId || null,
      brand: p.brand || "", last4: p.last4 || "", exp_month: p.expMonth ?? null, exp_year: p.expYear ?? null,
      is_default: p.isDefault || false, status: p.status || "active",
    });
    if (error) console.error(`  FAILED payment method for user ${userId}: ${error.message}`);
    else pmMigrated++;
  }
  console.log(`  migrated ${pmMigrated}, skipped ${pmSkipped} (user not yet migrated)`);

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
