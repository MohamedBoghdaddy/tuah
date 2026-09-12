// Postgres (Supabase) data-access layer for the ERP module: erp_apps,
// departments, job_positions, erp_employees, erp_integration_status,
// erp_schema_relations. Replaces model/ERPApp.js, Department.js,
// JobPosition.js, ERPEmployee.js, ERPIntegrationStatus.js, ERPSchemaRelation.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const isErpDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

// ── ERP Apps ─────────────────────────────────────────────────────────────────

export const listErpApps = async () => {
  const { data, error } = await supabaseAdmin.from("erp_apps").select("*").order("layer").order("name");
  throwIfError(error, "Failed to list ERP apps.");
  return data || [];
};

export const createErpApp = async (fields) => {
  const { data, error } = await supabaseAdmin.from("erp_apps").insert(fields).select().single();
  throwIfError(error, "Failed to create ERP app.");
  return data;
};

export const updateErpApp = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("erp_apps").update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update ERP app.");
  return data;
};

export const deleteErpApp = async (id) => {
  const { error } = await supabaseAdmin.from("erp_apps").delete().eq("id", id);
  throwIfError(error, "Failed to delete ERP app.");
};

// ── Departments ──────────────────────────────────────────────────────────────

export const listDepartments = async () => {
  const { data, error } = await supabaseAdmin.from("departments").select("*").order("name");
  throwIfError(error, "Failed to list departments.");
  return data || [];
};

export const createDepartment = async (fields) => {
  const { data, error } = await supabaseAdmin.from("departments").insert(fields).select().single();
  throwIfError(error, "Failed to create department.");
  return data;
};

export const updateDepartment = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("departments").update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update department.");
  return data;
};

export const deleteDepartment = async (id) => {
  const { error } = await supabaseAdmin.from("departments").delete().eq("id", id);
  throwIfError(error, "Failed to delete department.");
};

// ── Job Positions ────────────────────────────────────────────────────────────

export const listJobPositions = async () => {
  const { data, error } = await supabaseAdmin
    .from("job_positions")
    .select("*, department:departments(name)")
    .order("level")
    .order("title");
  throwIfError(error, "Failed to list job positions.");
  return data || [];
};

export const createJobPosition = async (fields) => {
  const { data, error } = await supabaseAdmin.from("job_positions").insert(fields).select().single();
  throwIfError(error, "Failed to create job position.");
  return data;
};

export const updateJobPosition = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("job_positions").update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update job position.");
  return data;
};

export const deleteJobPosition = async (id) => {
  const { error } = await supabaseAdmin.from("job_positions").delete().eq("id", id);
  throwIfError(error, "Failed to delete job position.");
};

// ── ERP Employees ────────────────────────────────────────────────────────────

const ERP_EMPLOYEE_SELECT = "*, department:departments(name), job_position:job_positions(title, level), manager:erp_employees!erp_employees_manager_id_fkey(full_name, employee_code)";

export const listErpEmployees = async () => {
  const { data, error } = await supabaseAdmin.from("erp_employees").select(ERP_EMPLOYEE_SELECT).order("level").order("full_name");
  throwIfError(error, "Failed to list ERP employees.");
  return data || [];
};

export const listActiveErpEmployees = async () => {
  const { data, error } = await supabaseAdmin
    .from("erp_employees")
    .select("*")
    .eq("status", "active")
    .order("level")
    .order("full_name");
  throwIfError(error, "Failed to list ERP employees.");
  return data || [];
};

export const createErpEmployee = async (fields) => {
  const { data, error } = await supabaseAdmin.from("erp_employees").insert(fields).select().single();
  throwIfError(error, "Failed to create ERP employee.");
  return data;
};

export const updateErpEmployee = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("erp_employees").update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update ERP employee.");
  return data;
};

export const deleteErpEmployee = async (id) => {
  const { error } = await supabaseAdmin.from("erp_employees").delete().eq("id", id);
  throwIfError(error, "Failed to delete ERP employee.");
};

// ── Integration status ───────────────────────────────────────────────────────

export const upsertIntegrationStatus = async (item) => {
  const { error } = await supabaseAdmin
    .from("erp_integration_status")
    .upsert({ ...item, checked_at: new Date().toISOString() }, { onConflict: "key" });
  throwIfError(error, "Failed to record integration status.");
};

// ── Schema relations ─────────────────────────────────────────────────────────

export const listSchemaRelations = async () => {
  const { data, error } = await supabaseAdmin.from("erp_schema_relations").select("*").order("app_slug").order("from_table");
  throwIfError(error, "Failed to list schema relations.");
  return data || [];
};

export const createSchemaRelation = async (fields) => {
  const { data, error } = await supabaseAdmin.from("erp_schema_relations").insert(fields).select().single();
  throwIfError(error, "Failed to create schema relation.");
  return data;
};

export const updateSchemaRelation = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("erp_schema_relations").update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update schema relation.");
  return data;
};

export const deleteSchemaRelation = async (id) => {
  const { data, error } = await supabaseAdmin.from("erp_schema_relations").delete().eq("id", id).select("id").maybeSingle();
  throwIfError(error, "Failed to delete schema relation.");
  return data;
};

// ── Overview counts ──────────────────────────────────────────────────────────

const countAll = async (table) => {
  const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  throwIfError(error, `Failed to count ${table}.`);
  return count || 0;
};

export const countErpApps = () => countAll("erp_apps");
export const countDepartments = () => countAll("departments");
export const countJobPositions = () => countAll("job_positions");
export const countErpEmployees = () => countAll("erp_employees");
