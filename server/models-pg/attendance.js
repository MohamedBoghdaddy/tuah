// Postgres (Supabase) data-access layer for `attendance_records`, replacing model/AttendanceRecord.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "attendance_records";

export const isAttendanceDbReady = () => isSupabaseConfigured();

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

export const toDateOnly = (value) => new Date(value).toISOString().slice(0, 10);

// Mirrors the old Mongoose pre-save hook: worked minutes = (clockOut - clockIn) - break.
export const computeTotalWorkedMinutes = (clockIn, clockOut, breakMinutes = 0) => {
  if (!clockIn || !clockOut) return 0;
  const worked = (new Date(clockOut) - new Date(clockIn)) / 60000;
  return Math.max(0, Math.round(worked - (breakMinutes || 0)));
};

const toRow = (fields) => {
  const row = { ...fields };
  if (row.clock_in !== undefined || row.clock_out !== undefined || row.break_minutes !== undefined) {
    // Only recompute when we have enough info; callers merge with existing values first for partial updates.
    if (row.clock_in && row.clock_out) {
      row.total_worked_minutes = computeTotalWorkedMinutes(row.clock_in, row.clock_out, row.break_minutes || 0);
    }
  }
  return row;
};

export const listAttendance = async ({ employeeId, department, status, from, to, page = 1, limit = 50 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*", { count: "exact" }).order("date", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (department) query = query.eq("department", department);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("date", toDateOnly(from));
  if (to) query = query.lte("date", toDateOnly(to));

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, parseInt(limit) || 50);
  const start = (pageNum - 1) * limitNum;
  query = query.range(start, start + limitNum - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list attendance records.");
  return { records: data || [], total: count || 0 };
};

export const listAttendanceForExport = async ({ employeeId, department, status, from, to } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*").order("date", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  if (department) query = query.eq("department", department);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("date", toDateOnly(from));
  if (to) query = query.lte("date", toDateOnly(to));

  const { data, error } = await query;
  throwIfError(error, "Failed to export attendance records.");
  return data || [];
};

export const findAttendanceById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up attendance record.");
  return data;
};

export const findAttendanceForEmployeeOnDate = async (employeeId, date) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("employee_id", employeeId)
    .eq("date", toDateOnly(date))
    .maybeSingle();
  throwIfError(error, "Failed to look up attendance record.");
  return data;
};

export const listMyAttendance = async (employeeId, { from, to } = {}, limit = 90) => {
  let query = supabaseAdmin.from(TABLE).select("*").eq("employee_id", employeeId).order("date", { ascending: false }).limit(limit);
  if (from) query = query.gte("date", toDateOnly(from));
  if (to) query = query.lte("date", toDateOnly(to));

  const { data, error } = await query;
  throwIfError(error, "Failed to list attendance records.");
  return data || [];
};

export const createAttendance = async (fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(toRow(fields)).select().single();
  if (error) throw withDuplicateCheck(error, "Attendance record already exists for this employee on this date.");
  return data;
};

export const updateAttendance = async (id, updates) => {
  const existing = await findAttendanceById(id);
  if (!existing) return null;

  const merged = { ...updates };
  if (merged.clock_in !== undefined || merged.clock_out !== undefined || merged.break_minutes !== undefined) {
    const clockIn = merged.clock_in !== undefined ? merged.clock_in : existing.clock_in;
    const clockOut = merged.clock_out !== undefined ? merged.clock_out : existing.clock_out;
    const breakMinutes = merged.break_minutes !== undefined ? merged.break_minutes : existing.break_minutes;
    if (clockIn && clockOut) merged.total_worked_minutes = computeTotalWorkedMinutes(clockIn, clockOut, breakMinutes);
  }

  const { data, error } = await supabaseAdmin.from(TABLE).update(merged).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update attendance record.");
  return data;
};

export const deleteAttendance = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).delete().eq("id", id).select("id").maybeSingle();
  throwIfError(error, "Failed to delete attendance record.");
  return data;
};

// Upsert on (employee_id, date) — used by clock-in/out, leave approval, and Excel import.
export const upsertAttendanceForDate = async (employeeId, date, fields) => {
  const existing = await findAttendanceForEmployeeOnDate(employeeId, date);
  if (existing) {
    return updateAttendance(existing.id, fields);
  }
  return createAttendance({ employee_id: employeeId, date: toDateOnly(date), ...fields });
};
