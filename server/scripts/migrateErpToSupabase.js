/**
 * One-time data backfill for the MongoDB -> Supabase Postgres migration, Phase 6.
 *
 * Copies ERPApp, Department, JobPosition, ERPEmployee, ERPSchemaRelation,
 * ERPIntegrationStatus, ApprovalRequest (+ embedded steps[]), and the
 * standalone ApprovalStep collection into the new Postgres tables (see
 * server/supabase/migrations/0006_erp.sql).
 *
 * Departments and ERP employees reference each other (department.manager_id
 * -> erp_employees, erp_employees.department_id/manager_id -> departments/
 * erp_employees), so this runs in passes: create rows without cross-links,
 * build an id map, then a second pass resolves every cross-reference.
 * ApprovalRequest/ApprovalStep reference the main `employees` table (not
 * erp_employees) — resolved via the Phase 1 id-map.
 *
 * Idempotent by natural unique keys (erp_apps.slug, departments.code,
 * job_positions.code, erp_employees.employee_code, erp_schema_relations has
 * none in Mongo so it is NOT deduplicated — only run once per environment).
 *
 * Run: node server/scripts/migrateErpToSupabase.js
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
idMap.employees ||= {};
idMap.departments ||= {};
idMap.jobPositions ||= {};
idMap.erpEmployees ||= {};
idMap.approvalRequests ||= {};
const resolveUserId = (id) => (id ? idMap.users[String(id)] || null : null);
const resolveEmployeeId = (id) => (id ? idMap.employees[String(id)] || null : null);

const dyn = (name) => mongoose.models[name] || mongoose.model(name, new mongoose.Schema({}, { strict: false, timestamps: true }));
const ERPAppModel = dyn("ERPApp");
const DepartmentModel = dyn("Department");
const JobPositionModel = dyn("JobPosition");
const ERPEmployeeModel = dyn("ERPEmployee");
const ERPSchemaRelationModel = dyn("ERPSchemaRelation");
const ERPIntegrationStatusModel = dyn("ERPIntegrationStatus");
const ApprovalRequestModel = dyn("ApprovalRequest");
const ApprovalStepModel = dyn("ApprovalStep");

const upsertBy = async (table, matchColumn, matchValue, row) => {
  const { data: existing } = await supabaseAdmin.from(table).select("id").eq(matchColumn, matchValue).maybeSingle();
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await supabaseAdmin.from(table).insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id, created: true };
};

const run = async () => {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  console.log("\n--- ERP Apps ---");
  for (const a of await ERPAppModel.find().lean()) {
    try {
      await upsertBy("erp_apps", "slug", a.slug, {
        name: a.name, slug: a.slug, layer: a.layer, icon: a.icon || "apps",
        purpose: a.purpose || "", depends_on: a.dependsOn || [], used_by: a.usedBy || [],
        main_tables: a.mainTables || [], connected_tables: a.connectedTables || [],
        workflow_summary: a.workflowSummary || "", status: a.status || "planned",
      });
    } catch (err) { console.error(`  FAILED app ${a.slug}: ${err.message}`); }
  }

  console.log("\n--- Departments (pass 1, no cross-links) ---");
  for (const d of await DepartmentModel.find().lean()) {
    try {
      const { id } = await upsertBy("departments", "code", d.code, {
        name: d.name, code: d.code, description: d.description || "", status: d.status || "active",
      });
      idMap.departments[String(d._id)] = id;
    } catch (err) { console.error(`  FAILED department ${d.code}: ${err.message}`); }
  }

  console.log("\n--- Job Positions ---");
  for (const jp of await JobPositionModel.find().lean()) {
    try {
      const { id } = await upsertBy("job_positions", "code", jp.code, {
        title: jp.title, code: jp.code, level: jp.level,
        department_id: idMap.departments[String(jp.departmentId)] || null,
        description: jp.description || "", permissions_role: jp.permissionsRole || "viewer",
        status: jp.status || "active",
      });
      idMap.jobPositions[String(jp._id)] = id;
    } catch (err) { console.error(`  FAILED job position ${jp.code}: ${err.message}`); }
  }

  console.log("\n--- ERP Employees (pass 1, no manager links) ---");
  const erpEmployees = await ERPEmployeeModel.find().lean();
  for (const e of erpEmployees) {
    try {
      const { id } = await upsertBy("erp_employees", "employee_code", e.employeeCode, {
        user_id: resolveUserId(e.userId), full_name: e.fullName, email: e.email,
        phone: e.phone || "", avatar: e.avatar || "", employee_code: e.employeeCode, level: e.level,
        department_id: idMap.departments[String(e.departmentId)] || null,
        job_position_id: idMap.jobPositions[String(e.jobPositionId)] || null,
        status: e.status || "active", assigned_modules: e.assignedModules || [],
        hire_date: e.hireDate || null,
      });
      idMap.erpEmployees[String(e._id)] = id;
    } catch (err) { console.error(`  FAILED ERP employee ${e.employeeCode}: ${err.message}`); }
  }

  console.log("\n--- Pass 2: department.manager_id, erp_employees.manager_id ---");
  for (const d of await DepartmentModel.find().lean()) {
    const newId = idMap.departments[String(d._id)];
    const managerId = idMap.erpEmployees[String(d.managerId)];
    if (newId && managerId) await supabaseAdmin.from("departments").update({ manager_id: managerId }).eq("id", newId);
  }
  for (const e of erpEmployees) {
    const newId = idMap.erpEmployees[String(e._id)];
    const managerId = idMap.erpEmployees[String(e.managerId)];
    if (newId && managerId) await supabaseAdmin.from("erp_employees").update({ manager_id: managerId }).eq("id", newId);
  }

  fs.writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  console.log(`\nWrote id map to ${idMapPath}`);

  console.log("\n--- ERP Schema Relations ---");
  for (const r of await ERPSchemaRelationModel.find().lean()) {
    const { error } = await supabaseAdmin.from("erp_schema_relations").insert({
      app_slug: r.appSlug, from_table: r.fromTable, from_field: r.fromField,
      to_table: r.toTable, to_field: r.toField, relation_type: r.relationType,
      description: r.description || "", status: r.status || "active",
    });
    if (error) console.error(`  FAILED schema relation ${r.appSlug}/${r.fromTable}: ${error.message}`);
  }

  console.log("\n--- ERP Integration Status ---");
  for (const s of await ERPIntegrationStatusModel.find().lean()) {
    const { error } = await supabaseAdmin.from("erp_integration_status").upsert({
      key: s.key, name: s.name, status: s.status || "not_configured",
      message: s.message || "", checked_at: s.checkedAt || null, metadata: s.metadata || {},
    }, { onConflict: "key" });
    if (error) console.error(`  FAILED integration status ${s.key}: ${error.message}`);
  }

  console.log("\n--- Approval Requests ---");
  for (const ar of await ApprovalRequestModel.find().lean()) {
    const { data, error } = await supabaseAdmin.from("approval_requests").insert({
      title: ar.title || null, request_type: ar.requestType,
      employee_id: resolveEmployeeId(ar.employeeId), current_approver_id: resolveEmployeeId(ar.currentApproverId),
      employee_name: ar.employeeName || "", current_approver_name: ar.currentApproverName || "",
      requested_by: ar.requestedBy || "", department: ar.department || "",
      status: ar.status || "pending", priority: ar.priority || "medium",
      description: ar.description || "", amount: ar.amount ?? null, metadata: ar.metadata || {},
    }).select("id").single();

    if (error) { console.error(`  FAILED approval request ${ar._id}: ${error.message}`); continue; }
    idMap.approvalRequests[String(ar._id)] = data.id;

    const steps = (ar.steps || []).map((s, i) => ({
      approval_request_id: data.id, step_name: s.stepName || null, assignee: s.assignee || null,
      assignee_id: resolveEmployeeId(s.assigneeId), status: s.status || "pending", position: i,
    }));
    if (steps.length) {
      const { error: stepsError } = await supabaseAdmin.from("approval_request_steps").insert(steps);
      if (stepsError) console.error(`    FAILED embedded steps for ${ar._id}: ${stepsError.message}`);
    }
  }

  console.log("\n--- Approval Steps (standalone audit log) ---");
  for (const s of await ApprovalStepModel.find().lean()) {
    const requestId = idMap.approvalRequests[String(s.requestId)];
    if (!requestId) { console.log(`  skip step for request ${s.requestId} — request not migrated`); continue; }
    const { error } = await supabaseAdmin.from("approval_steps").insert({
      request_id: requestId, step_order: s.stepOrder,
      approver_id: idMap.erpEmployees[String(s.approverId)] || null,
      approver_role: s.approverRole || "", status: s.status || "pending",
      approved_at: s.approvedAt || null, rejected_at: s.rejectedAt || null, notes: s.notes || "",
    });
    if (error) console.error(`  FAILED approval step: ${error.message}`);
  }

  fs.writeFileSync(idMapPath, JSON.stringify(idMap, null, 2));
  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
