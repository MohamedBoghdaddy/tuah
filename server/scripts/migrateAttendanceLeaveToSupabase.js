/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 4.
 *
 * Copies every existing MongoDB `attendancerecords` and `leaverequests`
 * document (including embedded `approvalSteps[]`) into the new Postgres
 * `attendance_records`, `leave_requests`, and `leave_request_approval_steps`
 * tables (see server/supabase/migrations/0004_attendance_leave.sql).
 *
 * Resolves employeeId/approvedBy/currentApproverId/decidedBy/assigneeId
 * references using the employees id-map built by
 * migrateUsersEmployeesToSupabase.js — run that first. Records whose
 * employeeId has no entry in the id-map are skipped with a warning.
 *
 * Idempotent by (employee_id, date) for attendance, and re-inserts leave
 * requests each run are NOT deduplicated (Mongo LeaveRequest has no natural
 * unique key) — only run this once per environment, or clear
 * leave_requests/leave_request_approval_steps first if re-running.
 *
 * Run: node server/scripts/migrateAttendanceLeaveToSupabase.js
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
idMap.employees ||= {};
const resolveEmployeeId = (mongoId) => (mongoId ? idMap.employees[String(mongoId)] || null : null);

const AttendanceModel = mongoose.models.AttendanceRecord || mongoose.model(
  "AttendanceRecord",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);
const LeaveModel = mongoose.models.LeaveRequest || mongoose.model(
  "LeaveRequest",
  new mongoose.Schema({}, { strict: false, timestamps: true }),
);

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- Attendance records ---");
  const records = await AttendanceModel.find().lean();
  let attInserted = 0, attSkipped = 0;
  for (const r of records) {
    const employeeId = resolveEmployeeId(r.employeeId);
    if (!employeeId) {
      attSkipped++;
      continue;
    }

    const dateStr = new Date(r.date).toISOString().slice(0, 10);
    const { data: existing } = await supabaseAdmin
      .from("attendance_records")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("date", dateStr)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from("attendance_records").insert({
      employee_id: employeeId,
      employee_name: r.employeeName || "",
      employee_email: r.employeeEmail || "",
      department: r.department || "",
      date: dateStr,
      clock_in: r.clockIn || null,
      clock_out: r.clockOut || null,
      break_minutes: r.breakMinutes || 0,
      total_worked_minutes: r.totalWorkedMinutes || 0,
      status: r.status || "present",
      source: r.source || "manual",
      notes: r.notes || null,
      approved_by: resolveEmployeeId(r.approvedBy),
    });
    if (error) console.error(`  FAILED attendance ${dateStr} for ${r.employeeEmail}: ${error.message}`);
    else attInserted++;
  }
  console.log(`  migrated ${attInserted}, skipped ${attSkipped} (employee not yet migrated)`);

  console.log("\n--- Leave requests ---");
  const leaves = await LeaveModel.find().lean();
  let leaveInserted = 0, leaveSkipped = 0;
  for (const l of leaves) {
    const employeeId = resolveEmployeeId(l.employeeId);
    if (!employeeId) {
      leaveSkipped++;
      continue;
    }

    const { data, error } = await supabaseAdmin
      .from("leave_requests")
      .insert({
        employee_id: employeeId,
        employee_name: l.employeeName || "",
        employee_email: l.employeeEmail || "",
        department: l.department || "",
        type: l.type,
        start_date: new Date(l.startDate).toISOString().slice(0, 10),
        end_date: new Date(l.endDate).toISOString().slice(0, 10),
        leave_early_time: l.leaveEarlyTime || null,
        hours_requested: l.hoursRequested ?? null,
        reason: l.reason || null,
        status: l.status || "pending",
        current_approver_id: resolveEmployeeId(l.currentApproverId),
        decided_by: resolveEmployeeId(l.decidedBy),
        decided_at: l.decidedAt || null,
        rejection_reason: l.rejectionReason || null,
        attachments: l.attachments || [],
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  FAILED leave request for ${l.employeeEmail}: ${error.message}`);
      continue;
    }
    leaveInserted++;

    const steps = (l.approvalSteps || []).map((s, i) => ({
      leave_request_id: data.id,
      step_name: s.stepName || null,
      assignee_id: resolveEmployeeId(s.assigneeId),
      assignee_name: s.assigneeName || null,
      status: s.status || "pending",
      decided_at: s.decidedAt || null,
      comment: s.comment || null,
      position: i,
    }));
    if (steps.length) {
      const { error: stepsError } = await supabaseAdmin.from("leave_request_approval_steps").insert(steps);
      if (stepsError) console.error(`    FAILED approval steps: ${stepsError.message}`);
    }
  }
  console.log(`  migrated ${leaveInserted}, skipped ${leaveSkipped} (employee not yet migrated)`);

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
