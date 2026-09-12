// Postgres (Supabase) data-access layer for `leave_requests`/`leave_request_approval_steps`,
// replacing model/LeaveRequest.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "leave_requests";
const STEPS_TABLE = "leave_request_approval_steps";
const SELECT_WITH_STEPS = "*, leave_request_approval_steps(*)";

export const isLeaveDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

const toRequestJSON = (row) => {
  if (!row) return null;
  const steps = (row.leave_request_approval_steps || [])
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((s) => ({
      stepName: s.step_name,
      assigneeId: s.assignee_id,
      assigneeName: s.assignee_name,
      status: s.status,
      decidedAt: s.decided_at,
      comment: s.comment,
    }));
  return { ...row, approvalSteps: steps };
};

export const listLeaveRequests = async ({ employeeId, department, status, type, from, to, page = 1, limit = 50 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select(SELECT_WITH_STEPS, { count: "exact" }).order("created_at", { ascending: false });

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (department) query = query.eq("department", department);
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  if (from) query = query.gte("start_date", new Date(from).toISOString().slice(0, 10));
  if (to) query = query.lte("start_date", new Date(to).toISOString().slice(0, 10));

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, parseInt(limit) || 50);
  const start = (pageNum - 1) * limitNum;
  query = query.range(start, start + limitNum - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list leave requests.");
  return { requests: (data || []).map(toRequestJSON), total: count || 0 };
};

export const listLeaveForExport = async ({ employeeId, department, status, type, from, to } = {}) => {
  let query = supabaseAdmin.from(TABLE).select(SELECT_WITH_STEPS).order("created_at", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  if (department) query = query.eq("department", department);
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  if (from) query = query.gte("start_date", new Date(from).toISOString().slice(0, 10));
  if (to) query = query.lte("start_date", new Date(to).toISOString().slice(0, 10));

  const { data, error } = await query;
  throwIfError(error, "Failed to export leave requests.");
  return (data || []).map(toRequestJSON);
};

export const findLeaveById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select(SELECT_WITH_STEPS).eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up leave request.");
  return toRequestJSON(data);
};

export const findLeaveForEmployee = async (id, employeeId) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SELECT_WITH_STEPS)
    .eq("id", id)
    .eq("employee_id", employeeId)
    .maybeSingle();
  throwIfError(error, "Failed to look up leave request.");
  return toRequestJSON(data);
};

export const listMyLeaveRequests = async (employeeId) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SELECT_WITH_STEPS)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  throwIfError(error, "Failed to list leave requests.");
  return (data || []).map(toRequestJSON);
};

export const createLeaveRequest = async (fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(fields).select(SELECT_WITH_STEPS).single();
  throwIfError(error, "Failed to submit leave request.");
  return toRequestJSON(data);
};

export const updateLeaveRequest = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update(fields).eq("id", id).select(SELECT_WITH_STEPS).maybeSingle();
  throwIfError(error, "Failed to update leave request.");
  return toRequestJSON(data);
};

export const addApprovalStep = async (leaveRequestId, step) => {
  const { data: existing } = await supabaseAdmin
    .from(STEPS_TABLE)
    .select("position")
    .eq("leave_request_id", leaveRequestId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (existing?.[0]?.position ?? -1) + 1;

  const { error } = await supabaseAdmin.from(STEPS_TABLE).insert({
    leave_request_id: leaveRequestId,
    step_name: step.stepName,
    assignee_id: step.assigneeId || null,
    assignee_name: step.assigneeName || null,
    status: step.status || "pending",
    decided_at: step.decidedAt || null,
    comment: step.comment || null,
    position,
  });
  throwIfError(error, "Failed to add approval step.");
  return findLeaveById(leaveRequestId);
};
