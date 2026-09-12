import {
  listAttendance as listAttendanceRows,
  listAttendanceForExport,
  createAttendance as createAttendanceRow,
  updateAttendance as updateAttendanceRow,
  deleteAttendance as deleteAttendanceRow,
  findAttendanceForEmployeeOnDate,
  listMyAttendance,
  upsertAttendanceForDate,
  toDateOnly,
} from "../models-pg/attendance.js";
import { findEmployeeById } from "../models-pg/employees.js";
import { resolveEmployee } from "../utils/resolveEmployee.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const UPDATE_FIELD_MAP = {
  clockIn: "clock_in",
  clockOut: "clock_out",
  breakMinutes: "break_minutes",
  status: "status",
  notes: "notes",
  source: "source",
};

const buildFilter = (query) => ({
  employeeId: query.employeeId,
  department: query.department,
  status: query.status,
  from: query.from,
  to: query.to,
});

// ── Admin/HR: list all attendance records ──────────────────────────────────
export const listAttendance = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);

    const { records, total } = await listAttendanceRows({ ...filter, page, limit });
    res.json({ success: true, records, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR: create a record manually ────────────────────────────────────
export const createAttendance = async (req, res) => {
  try {
    const { employeeId, date, clockIn, clockOut, breakMinutes, status, source, notes } = req.body;

    if (!employeeId || !date) {
      return res.status(400).json({ success: false, message: "employeeId and date are required." });
    }

    const employee = await findEmployeeById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

    const record = await createAttendanceRow({
      employee_id: employeeId,
      employee_name: `${employee.fname} ${employee.lname}`,
      employee_email: employee.email,
      department: employee.department,
      date: toDateOnly(date),
      clock_in: clockIn || undefined,
      clock_out: clockOut || undefined,
      break_minutes: breakMinutes || 0,
      status: status || "present",
      source: source || "manual",
      notes,
    });

    res.status(201).json({ success: true, record });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Attendance record already exists for this employee on this date." });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR: update a record ──────────────────────────────────────────────
export const updateAttendance = async (req, res) => {
  try {
    const updates = {};
    Object.entries(UPDATE_FIELD_MAP).forEach(([bodyKey, column]) => {
      if (req.body[bodyKey] !== undefined) updates[column] = req.body[bodyKey];
    });

    const record = await updateAttendanceRow(req.params.id, updates);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR: delete a record ──────────────────────────────────────────────
export const deleteAttendance = async (req, res) => {
  try {
    const record = await deleteAttendanceRow(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: "Record not found." });
    res.json({ success: true, message: "Record deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee: view own attendance ──────────────────────────────────────────
export const getMyAttendance = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated." });

    const emp = await resolveEmployee(actor);
    if (!emp) {
      return res.json({ success: true, records: [], note: "No linked employee record found." });
    }

    const records = await listMyAttendance(emp.id, { from: req.query.from, to: req.query.to }, 90);
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee: clock in ─────────────────────────────────────────────────────
export const clockIn = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated." });

    const emp = await resolveEmployee(actor);
    if (!emp) return res.status(404).json({ success: false, message: "No linked employee record found. Contact your administrator." });

    const today = new Date();
    const existing = await findAttendanceForEmployeeOnDate(emp.id, today);
    if (existing?.clock_in) {
      return res.status(409).json({ success: false, message: "Already clocked in today." });
    }

    const now = new Date();
    const lateThreshold = new Date(today);
    lateThreshold.setHours(9, 15, 0, 0);
    const status = now > lateThreshold ? "late" : "present";

    const record = await upsertAttendanceForDate(emp.id, today, {
      employee_name: `${emp.fname} ${emp.lname}`,
      employee_email: emp.email,
      department: emp.department,
      clock_in: now.toISOString(),
      status,
      source: "system",
    });

    res.status(201).json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee: clock out ────────────────────────────────────────────────────
export const clockOut = async (req, res) => {
  try {
    const actor = req.actor || req.employee || req.user;
    if (!actor) return res.status(401).json({ success: false, message: "Not authenticated." });

    const emp = await resolveEmployee(actor);
    if (!emp) return res.status(404).json({ success: false, message: "No linked employee record found." });

    const today = new Date();
    const existing = await findAttendanceForEmployeeOnDate(emp.id, today);
    if (!existing?.clock_in) {
      return res.status(400).json({ success: false, message: "No clock-in record found for today." });
    }
    if (existing.clock_out) {
      return res.status(409).json({ success: false, message: "Already clocked out today." });
    }

    const updates = { clock_out: new Date().toISOString() };
    if (req.body.breakMinutes !== undefined) updates.break_minutes = req.body.breakMinutes;

    const record = await upsertAttendanceForDate(emp.id, today, updates);
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin/HR: export as JSON (frontend handles XLSX conversion) ────────────
export const exportAttendance = async (req, res) => {
  try {
    const filter = buildFilter(req.query);
    const records = await listAttendanceForExport(filter);
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
