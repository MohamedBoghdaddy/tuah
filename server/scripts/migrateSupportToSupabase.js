/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 7.
 *
 * Copies every existing MongoDB `supportinquiries` document into the new
 * Postgres `support_inquiries` table (see
 * server/supabase/migrations/0007_support.sql). No foreign keys — the
 * simplest backfill in this migration.
 *
 * Idempotent by ticket_number.
 *
 * Run: node server/scripts/migrateSupportToSupabase.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
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

const SupportInquiryModel = mongoose.models.SupportInquiry || mongoose.model(
  "SupportInquiry",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  const inquiries = await SupportInquiryModel.find().lean();
  let migrated = 0, skipped = 0;

  for (const i of inquiries) {
    const { data: existing } = await supabaseAdmin
      .from("support_inquiries")
      .select("id")
      .eq("ticket_number", i.ticketNumber)
      .maybeSingle();
    if (existing) { skipped++; continue; }

    const { error } = await supabaseAdmin.from("support_inquiries").insert({
      ticket_number: i.ticketNumber,
      name: i.name,
      email: i.email,
      phone: i.phone || null,
      type: i.type,
      order_number: i.orderNumber || null,
      message: i.message,
      status: i.status || "open",
      source: i.source || "support_portal",
      metadata: i.metadata || {},
    });

    if (error) console.error(`  FAILED ticket ${i.ticketNumber}: ${error.message}`);
    else migrated++;
  }

  console.log(`Migrated ${migrated}, skipped ${skipped} (already existed).`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
