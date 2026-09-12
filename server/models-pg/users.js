// Postgres (Supabase) data-access layer for `users`, replacing model/usermodel.js.
// Thin wrappers around the shared supabaseAdmin client — no ORM, matching the
// query-builder convention already used by services/emailOutboxService.js.
import bcrypt from "bcrypt";
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "users";

// Roles that must carry a department, mirroring usermodel.js's conditional
// `required: function(){...}` validator (Postgres CHECK can't easily express
// "required unless role X", so it stays an app-layer check here).
const DEPARTMENT_REQUIRED_ROLES = [
  "employee", "manager", "designer", "operations", "HR", "accountant",
];

export const isUsersDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

export const validateUserDepartment = (fields) => {
  if (fields.role && DEPARTMENT_REQUIRED_ROLES.includes(fields.role) && !fields.department) {
    return `department is required for role "${fields.role}".`;
  }
  return null;
};

export const findUserByEmailOrUsername = async ({ email, username }) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .or(`email.eq.${email},username.eq.${username}`)
    .maybeSingle();
  throwIfError(error, "Failed to look up user.");
  return data;
};

export const findUserByEmail = async (email) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("email", email)
    .maybeSingle();
  throwIfError(error, "Failed to look up user.");
  return data;
};

export const findUserById = async (id) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  throwIfError(error, "Failed to look up user.");
  return data;
};

export const listUsers = async ({ role } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*").order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  const { data, error } = await query;
  throwIfError(error, "Failed to list users.");
  return data || [];
};

export const searchUsersByUsername = async (usernameQuery) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .ilike("username", `%${usernameQuery}%`);
  throwIfError(error, "Failed to search users.");
  return data || [];
};

export const createUser = async (fields) => {
  const departmentError = validateUserDepartment(fields);
  if (departmentError) throw new Error(departmentError);

  const hashedPassword = await bcrypt.hash(fields.password, 10);
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ ...fields, password: hashedPassword })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      const err = new Error("Email or username already in use.");
      err.code = "23505";
      throw err;
    }
    throw new Error(error.message || "Failed to create user.");
  }
  return data;
};

export const updateUser = async (id, updates) => {
  const next = { ...updates };
  if (next.password) next.password = await bcrypt.hash(next.password, 10);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(next)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const err = new Error("Email or username already in use.");
      err.code = "23505";
      throw err;
    }
    throw new Error(error.message || "Failed to update user.");
  }
  return data;
};

export const deleteUser = async (id) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("id", id)
    .select()
    .maybeSingle();
  throwIfError(error, "Failed to delete user.");
  return data;
};

export const verifyUserPassword = (user, plainPassword) =>
  bcrypt.compare(plainPassword, user.password);
