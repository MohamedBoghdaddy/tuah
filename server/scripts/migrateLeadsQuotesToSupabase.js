/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 5.
 *
 * Copies every existing MongoDB `leads` and `quotes` document (including
 * embedded quote `items[]`) into the new Postgres `leads`, `quotes`, and
 * `quote_items` tables (see server/supabase/migrations/0005_leads_quotes.sql).
 *
 * Resolves assignedTo/createdBy/convertedCustomerId/customerId references
 * using the users id-map built by migrateUsersEmployeesToSupabase.js — run
 * that first. leadId on quotes is resolved against this script's own
 * lead id-map (built in pass 1, used in pass 2), extended into the shared
 * mongo-to-postgres-id-map.json under a new `leads` key.
 *
 * Idempotent by quote_number for quotes; leads have no natural unique key in
 * Mongo, so only run this once per environment (or clear the `leads` table
 * first if re-running).
 *
 * Run: node server/scripts/migrateLeadsQuotesToSupabase.js
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
const idMap = fs.existsSync(idMapPath) ? JSON.parse(fs.readFileSync(idMapPath, "utf8")) : {};
idMap.users ||= {};
idMap.leads ||= {};
const resolveUserId = (mongoId) => (mongoId ? idMap.users[String(mongoId)] || null : null);

const LeadModel = mongoose.models.Lead || mongoose.model(
  "Lead",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);
const QuoteModel = mongoose.models.Quote || mongoose.model(
  "Quote",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Leads ---");
  const leads = await LeadModel.find().lean();
  for (const l of leads) {
    const { data, error } = await supabaseAdmin
      .from("leads")
      .insert({
        name: l.name,
        email: l.email,
        phone: l.phone || null,
        company: l.company || null,
        project_type: l.projectType || null,
        source: l.source || "admin",
        status: l.status || "new",
        priority: l.priority || "medium",
        estimated_value: l.estimatedValue || 0,
        assigned_to: resolveUserId(l.assignedTo),
        notes: l.notes || "",
        tags: l.tags || [],
        created_by: resolveUserId(l.createdBy),
        converted_customer_id: resolveUserId(l.convertedCustomerId),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  FAILED lead ${l.email}: ${error.message}`);
      continue;
    }
    idMap.leads[String(l._id)] = data.id;
    console.log(`  migrated lead ${l.email} -> ${data.id}`);
  }

  fs.writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  console.log(`\nWrote id map to ${idMapPath}`);

  console.log("\n--- Quotes ---");
  const quotes = await QuoteModel.find().lean();
  for (const q of quotes) {
    const { data: existing } = await supabaseAdmin.from("quotes").select("id").eq("quote_number", q.quoteNumber).maybeSingle();
    if (existing) {
      console.log(`  skip quote ${q.quoteNumber} — already exists`);
      continue;
    }

    const leadId = q.leadId ? idMap.leads[String(q.leadId)] || null : null;
    const { data, error } = await supabaseAdmin
      .from("quotes")
      .insert({
        lead_id: leadId,
        customer_id: resolveUserId(q.customerId),
        customer_name: q.customerName || "",
        customer_email: q.customerEmail || "",
        project: q.project || "",
        quote_number: q.quoteNumber,
        status: q.status || "draft",
        subtotal: q.subtotal || 0,
        discount: q.discount || 0,
        tax: q.tax || 0,
        total: q.total || 0,
        valid_until: q.validUntil || null,
        notes: q.notes || "",
        created_by: resolveUserId(q.createdBy),
        last_email_status: q.lastEmailStatus || "none",
        // q.emailOutboxId was a loose Mongo-era string ref to email_outbox.id;
        // that table is already Postgres/uuid, so it carries over as-is if present.
        email_outbox_id: q.emailOutboxId || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  FAILED quote ${q.quoteNumber}: ${error.message}`);
      continue;
    }

    const items = (q.items || []).map((item, i) => ({
      quote_id: data.id,
      name: item.name,
      description: item.description || "",
      quantity: item.quantity || 1,
      unit_price: item.unitPrice || 0,
      total: item.total || 0,
      position: i,
    }));
    if (items.length) {
      const { error: itemsError } = await supabaseAdmin.from("quote_items").insert(items);
      if (itemsError) console.error(`    FAILED items for quote ${q.quoteNumber}: ${itemsError.message}`);
    }

    console.log(`  migrated quote ${q.quoteNumber} -> ${data.id}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
