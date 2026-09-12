import {
  listLeaveRequests as listLeaveRequestsRows,
  listLeaveForExport,
  findLeaveById,
  findLeaveForEmployee,
  listMyLeaveRequests,
  createLeaveRequest as createLeaveRequestRow,
  updateLeaveRequest as updateLeaveRequestRow,
  addApprovalStep,
} from "../models-pg/leave.js";
import { upsertAttendanceForDate } from "../models-pg/attendance.js";
import { resolveEmployee } from "../utils/resolveEmployee.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const buildFilter = (query) => ({
  employeeId: query.employeeId,
  department: query.department,
  status: query.status,
  type: query.type,
  from: query.from,
  to: query.to,
});

// Approve/reject/escalate are performed by a logged-in actor (almost always a
// `users` row — Employee login is unused in this app, see AuthMiddleware).
// decided_by/current_approver_id/assignee_id all reference employees(id), so
// the acting user must be resolved to THEIR OWN employee record first; if
// they have none linked, we store null rather than a mismatched users.id
// (which would violate the foreign key).
const resolveActingEmployeeId = async (actor) => {
  const emp = await resolveEmployee(actor);
  return emp ? emp.id : null;
};

// ── Employee: list own requests ────────────────────────────────────────────
export const getMyLeaveRequests = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const emp = await resolveEmployee(actor);
    const employeeIdFilter = emp ? emp.id : actor.id;

    const requests = await listMyLeaveRequests(employeeIdFilter);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee: submit a request ─────────────────────────────────────────────
export const submitLeaveRequest = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const { type, startDate, endDate, leaveEarlyTime, hoursRequested, reason } = req.body;

    if (!type || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: "type, startDate, endDate are required." });
    }

    const emp = await resolveEmployee(actor);
    const storedId = emp ? emp.id : actor.id;
    const storedName = emp
      ? `${emp.fname} ${emp.lname}`
      : (actor.first_name ? `${actor.first_name} ${actor.last_name}` : (actor.fname ? `${actor.fname} ${actor.lname}` : actor.username || ""));
    const storedEmail = actor.email || emp?.email || "";
    const storedDept = actor.department || emp?.department || "";

    const request = await createLeaveRequestRow({
      employee_id: storedId,
      employee_name: storedName,
      employee_email: storedEmail,
      department: storedDept,
      type,
      start_date: new Date(startDate).toISOString().slice(0, 10),
      end_date: new Date(endDate).toISOString().slice(0, 10),
      leave_early_time: leaveEarlyTime,
      hours_requested: hoursRequested,
      reason,
    });

    res.status(201).json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee: cancel own pending request ──────────────────────────────────
export const cancelLeaveRequest = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const emp = await resolveEmployee(actor);
    const employeeIdFilter = emp ? emp.id : actor.id;
    const request = await findLeaveForEmployee(req.params.id, employeeIdFilter);

    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending requests can be cancelled." });
    }

    const updated = await updateLeaveRequestRow(req.params.id, { status: "cancelled" });
    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR/Manager: list all requests ───────────────────────────────────
export const listLeaveRequests = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);

    const { requests, total } = await listLeaveRequestsRows({ ...filter, page, limit });
    res.json({ success: true, requests, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR/Manager: get one request ─────────────────────────────────────
export const getLeaveRequest = async (req, res) => {
  try {
    const request = await findLeaveById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR/Manager: approve ──────────────────────────────────────────────
export const approveLeaveRequest = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const request = await findLeaveById(req.params.id);

    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (!["pending", "escalated"].includes(request.status)) {
      return res.status(400).json({ success: false, message: "Request cannot be approved in its current state." });
    }

    const decidedBy = await resolveActingEmployeeId(actor);
    const updated = await updateLeaveRequestRow(req.params.id, {
      status: "approved",
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    });

    // Mark attendance as "leave" for each day in the range
    const start = new Date(request.start_date);
    const end = new Date(request.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      await upsertAttendanceForDate(request.employee_id, new Date(d), {
        employee_name: request.employee_name,
        employee_email: request.employee_email,
        department: request.department,
        status: "leave",
        source: "system",
      });
    }

    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR/Manager: reject ───────────────────────────────────────────────
export const rejectLeaveRequest = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const { rejectionReason } = req.body;

    if (!rejectionReason?.trim()) {
      return res.status(400).json({ success: false, message: "A rejection reason is required." });
    }

    const request = await findLeaveById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (!["pending", "escalated"].includes(request.status)) {
      return res.status(400).json({ success: false, message: "Request cannot be rejected in its current state." });
    }

    const decidedBy = await resolveActingEmployeeId(actor);
    const updated = await updateLeaveRequestRow(req.params.id, {
      status: "rejected",
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    });

    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR/Manager: escalate ─────────────────────────────────────────────
export const escalateLeaveRequest = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    const { nextApproverId } = req.body;

    const request = await findLeaveById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending requests can be escalated." });
    }

    await updateLeaveRequestRow(req.params.id, {
      status: "escalated",
      ...(nextApproverId ? { current_approver_id: nextApproverId } : {}),
    });

    const actingEmployeeId = await resolveActingEmployeeId(actor);
    const actingName = actor.fname ? `${actor.fname} ${actor.lname}` : (actor.username || `${actor.first_name || ""} ${actor.last_name || ""}`.trim());
    const updated = await addApprovalStep(req.params.id, {
      stepName: "Escalated",
      assigneeId: actingEmployeeId,
      assigneeName: actingName,
      status: "skipped",
      decidedAt: new Date().toISOString(),
      comment: req.body.comment || "Escalated for higher approval",
    });

    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Export as JSON ─────────────────────────────────────────────────────────
export const exportLeaveRequests = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const requests = await listLeaveForExport(filter);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
