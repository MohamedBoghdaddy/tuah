/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 1.
 *
 * Copies every existing MongoDB `users` and `employees` document into the new
 * Postgres `users`/`employees` tables (see server/supabase/migrations/0001_users_employees.sql),
 * preserving already-hashed passwords as-is (no re-hashing — existing users keep
 * logging in with the same password) and resolving cross-references
 * (User.managerId/employeeId, Employee.managerId/userId) to the newly-generated
 * Postgres UUIDs in a second pass.
 *
 * Idempotent by email: re-running skips rows that already exist in Postgres
 * (matched by email), so it's safe to run again after fixing an error partway
 * through.
 *
 * Writes server/scripts/mongo-to-postgres-id-map.json — a { mongoObjectId: postgresUuid }
 * map for BOTH users and employees. Later migration phases (Products/Orders/Cart,
 * Attendance/Leave, ERP, Leads/Quotes) need this file to rewrite their own
 * Mongo ObjectId references (customerId, employeeId, createdBy, etc.) to the
 * matching Postgres UUID.
 *
 * Run: node server/scripts/migrateUsersEmployeesToSupabase.js
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

const UserModel = mongoose.models.User || mongoose.model(
  "User",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);
const EmployeeModel = mongoose.models.Employee || mongoose.model(
  "Employee",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const idMapPath = join(__dirname, "mongo-to-postgres-id-map.json");
const idMap = { users: {}, employees: {} };

const insertIfMissing = async (table, row, mongoId) => {
  const { data: existing } = await supabaseAdmin.from(table).select("id").eq("email", row.email).maybeSingle();
  if (existing) {
    console.log(`  skip ${table} ${row.email} — already exists (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await supabaseAdmin.from(table).insert(row).select("id").single();
  if (error) {
    console.error(`  FAILED ${table} ${row.email}: ${error.message}`);
    return null;
  }
  console.log(`  migrated ${table} ${row.email} -> ${data.id}`);
  return data.id;
};

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Pass 1: users ---");
  const users = await UserModel.find().lean();
  for (const u of users) {
    const newId = await insertIfMissing("users", {
      username: u.username,
      email: u.email,
      password: u.password,
      gender: u.gender,
      first_name: u.firstName,
      middle_name: u.middleName || null,
      last_name: u.lastName,
      role: u.role || "customer",
      permissions: u.permissions || [],
      denied_permissions: u.deniedPermissions || [],
      department: u.department || null,
      level: u.level || 0,
      receive_notifications: u.receiveNotifications ?? true,
      profile_photo: u.profilePhoto || null,
      profile_photo_url: u.profilePhotoUrl || null,
      profile_photo_asset_id: u.profilePhotoAssetId || null,
      job_title: u.jobTitle || null,
      seniority_level: u.seniorityLevel || null,
      phone: u.phone || null,
      status: u.status || "active",
      invited_at: u.invitedAt || null,
      invitation_email_status: u.invitationEmailStatus || "none",
      invitation_email_outbox_id: u.invitationEmailOutboxId || null,
    }, u._id);
    if (newId) idMap.users[String(u._id)] = newId;
  }

  console.log("\n--- Pass 1: employees ---");
  const employees = await EmployeeModel.find().lean();
  for (const e of employees) {
    const newId = await insertIfMissing("employees", {
      fname: e.fname,
      lname: e.lname,
      email: e.email,
      department: e.department,
      job_title: e.jobTitle || null,
      seniority_level: e.seniorityLevel || null,
      phone: e.phone || null,
      password: e.password,
      role: e.role || "readonly",
      permissions: e.permissions || [],
      denied_permissions: e.deniedPermissions || [],
      level: e.level || 0,
      profile_photo_url: e.profilePhotoUrl || null,
      profile_photo_asset_id: e.profilePhotoAssetId || null,
      status: e.status || "active",
      invited_at: e.invitedAt || null,
      invitation_email_status: e.invitationEmailStatus || "none",
      invitation_email_outbox_id: e.invitationEmailOutboxId || null,
      supabase_auth_user_id: e.supabaseAuthUserId || null,
    }, e._id);
    if (newId) idMap.employees[String(e._id)] = newId;
  }

  fs.writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  console.log(`\nWrote id map to ${idMapPath}`);

  console.log("\n--- Pass 2: resolving cross-references ---");
  for (const u of users) {
    const newId = idMap.users[String(u._id)];
    if (!newId) continue;
    const patch = {};
    if (u.managerId && idMap.users[String(u.managerId)]) patch.manager_id = idMap.users[String(u.managerId)];
    if (u.employeeId && idMap.employees[String(u.employeeId)]) patch.employee_id = idMap.employees[String(u.employeeId)];
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("users").update(patch).eq("id", newId);
      if (error) console.error(`  FAILED user link ${u.email}: ${error.message}`);
      else console.log(`  linked user ${u.email}`);
    }
  }

  for (const e of employees) {
    const newId = idMap.employees[String(e._id)];
    if (!newId) continue;
    const patch = {};
    if (e.managerId && idMap.employees[String(e.managerId)]) patch.manager_id = idMap.employees[String(e.managerId)];
    if (e.userId && idMap.users[String(e.userId)]) patch.user_id = idMap.users[String(e.userId)];
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("employees").update(patch).eq("id", newId);
      if (error) console.error(`  FAILED employee link ${e.email}: ${error.message}`);
      else console.log(`  linked employee ${e.email}`);
    }
  }

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
