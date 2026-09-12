// Postgres (Supabase) data-access layer for `employees`, replacing model/employeemodel.js.
import bcrypt from "bcrypt";
import crypto from "crypto";
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "employees";

export const isEmployeesDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

const withDuplicateCheck = (error, message) => {
  if (error?.code === "23505") {
    const err = new Error(message);
    err.code = "23505";
    return err;
  }
  return new Error(error?.message || message);
};

export const listEmployees = async ({ status, q, department } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (department) query = query.ilike("department", department);
  if (q) {
    const like = `%${q}%`;
    query = query.or(
      `fname.ilike.${like},lname.ilike.${like},email.ilike.${like},department.ilike.${like},job_title.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  throwIfError(error, "Failed to list employees.");
  return data || [];
};

export const findEmployeeById = async (id) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "Failed to look up employee.");
  return data;
};

export const findEmployeeByEmail = async (email) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("email", email)
    .maybeSingle();
  throwIfError(error, "Failed to look up employee.");
  return data;
};

export const countEmployeesByRole = async (role, { excludeStatus } = {}) => {
  let query = supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("role", role);
  if (excludeStatus) query = query.neq("status", excludeStatus);

  const { count, error } = await query;
  throwIfError(error, "Failed to count employees.");
  return count || 0;
};

export const countEmployeesExcludingStatus = async (status) => {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .neq("status", status);
  throwIfError(error, "Failed to count employees.");
  return count || 0;
};

// Used by erpController.js's org-hierarchy fallback when the dedicated
// ERPEmployee collection has no rows yet.
export const listEmployeesExcludingStatus = async (status) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, fname, lname, email, department, job_title, seniority_level, role, status")
    .neq("status", status)
    .order("seniority_level", { ascending: true })
    .order("fname", { ascending: true });
  throwIfError(error, "Failed to list employees.");
  return data || [];
};

export const createEmployee = async (fields) => {
  const password = fields.password ?? crypto.randomUUID().replace(/-/g, "");
  const hashedPassword = await bcrypt.hash(password, 10);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ ...fields, password: hashedPassword })
    .select()
    .single();
  if (error) throw withDuplicateCheck(error, "Employee email must be unique.");
  return data;
};

export const updateEmployee = async (id, updates) => {
  const next = { ...updates };
  if (next.password) next.password = await bcrypt.hash(next.password, 10);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(next)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw withDuplicateCheck(error, "Employee email must be unique.");
  return data;
};

export const deactivateEmployee = (id) => updateEmployee(id, { status: "inactive" });

export const verifyEmployeePassword = (employee, plainPassword) =>
  bcrypt.compare(plainPassword, employee.password);
