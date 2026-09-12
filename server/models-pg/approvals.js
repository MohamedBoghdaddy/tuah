// Postgres (Supabase) data-access layer for `approval_requests` (+ embedded
// `approval_request_steps`) and the standalone `approval_steps` audit table.
// Replaces model/ApprovalRequest.js and model/ApprovalStep.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const isApprovalsDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

const SELECT_WITH_RELATIONS =
  "*, approval_request_steps(*), employee:employees!approval_requests_employee_id_fkey(fname, lname, email, department, job_title), current_approver:employees!approval_requests_current_approver_id_fkey(fname, lname, email, department, job_title)";

const toRequestJSON = (row) => {
  if (!row) return null;
  const employee = row.employee;
  const approver = row.current_approver;
  const steps = (row.approval_request_steps || [])
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((s) => ({ stepName: s.step_name, assignee: s.assignee, assigneeId: s.assignee_id, status: s.status }));

  return {
    ...row,
    steps,
    _resolvedEmployeeName: employee ? `${employee.fname} ${employee.lname}`.trim() : (row.employee_name || row.requested_by || ""),
    _resolvedApproverName: approver ? `${approver.fname} ${approver.lname}`.trim() : (row.current_approver_name || ""),
  };
};

export const listApprovalRequests = async () => {
  const { data, error } = await supabaseAdmin.from("approval_requests").select(SELECT_WITH_RELATIONS).order("created_at", { ascending: false });
  throwIfError(error, "Failed to list approval requests.");
  return (data || []).map(toRequestJSON);
};

export const findApprovalRequestById = async (id) => {
  const { data, error } = await supabaseAdmin.from("approval_requests").select(SELECT_WITH_RELATIONS).eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up approval request.");
  return toRequestJSON(data);
};

export const createApprovalRequest = async (fields) => {
  const { data, error } = await supabaseAdmin.from("approval_requests").insert(fields).select(SELECT_WITH_RELATIONS).single();
  throwIfError(error, "Failed to create approval request.");
  return toRequestJSON(data);
};

export const updateApprovalRequest = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from("approval_requests").update(fields).eq("id", id).select(SELECT_WITH_RELATIONS).maybeSingle();
  throwIfError(error, "Failed to update approval request.");
  return toRequestJSON(data);
};

export const createApprovalStep = async (fields) => {
  const { data, error } = await supabaseAdmin.from("approval_steps").insert(fields).select().single();
  throwIfError(error, "Failed to create approval step.");
  return data;
};

// ── Overview counts ──────────────────────────────────────────────────────────

export const countApprovalRequestsByStatus = async (status) => {
  const { count, error } = await supabaseAdmin.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", status);
  throwIfError(error, "Failed to count approval requests.");
  return count || 0;
};
