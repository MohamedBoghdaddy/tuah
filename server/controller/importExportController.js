import xlsx from "xlsx";
import {
  listEmployees as listEmployeesRows,
  findEmployeeByEmail,
  createEmployee as createEmployeeRow,
  updateEmployee as updateEmployeeRow,
} from "../models-pg/employees.js";
import {
  listAttendanceForExport,
  upsertAttendanceForDate,
} from "../models-pg/attendance.js";
import {
  listLeaveForExport,
  createLeaveRequest as createLeaveRequestRow,
} from "../models-pg/leave.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const sheetToRows = (workbook, sheetName) => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  return xlsx.utils.sheet_to_json(sheet, { defval: "" });
};

const autoDetectType = (headers) => {
  const h = headers.map((x) => String(x).toLowerCase());
  if (h.some((x) => x.includes("clockin") || x.includes("clock_in"))) return "attendance";
  if (h.some((x) => x.includes("leavetype") || x.includes("leave_type") || x.includes("startdate"))) return "leave";
  if (h.some((x) => x.includes("sku") || x.includes("stock"))) return "products";
  if (h.some((x) => x.includes("fname") || x.includes("firstname") || x.includes("first_name") || x.includes("department"))) return "employees";
  if (h.some((x) => x.includes("company") || x.includes("leadstatus") || x.includes("lead_status"))) return "leads";
  return null;
};

// ── Excel export helpers ───────────────────────────────────────────────────

const sendXlsx = (res, data, sheetName, filename) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
};

// ── Export endpoints ───────────────────────────────────────────────────────

export const exportEmployees = async (req, res) => {
  try {
    const employees = await listEmployeesRows();
    const rows = employees.map((e) => ({
      id: e.id,
      firstName: e.fname,
      lastName: e.lname,
      email: e.email,
      department: e.department,
      jobTitle: e.job_title || "",
      role: e.role,
      status: e.status,
      phone: e.phone || "",
      createdAt: e.created_at,
    }));
    sendXlsx(res, rows, "Employees", "employees.xlsx");
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const exportAttendanceXlsx = async (req, res) => {
  try {
    const records = await listAttendanceForExport({ from: req.query.from, to: req.query.to });
    const rows = records.map((r) => ({
      employeeName: r.employee_name,
      employeeEmail: r.employee_email,
      department: r.department,
      date: r.date || "",
      clockIn: r.clock_in || "",
      clockOut: r.clock_out || "",
      breakMinutes: r.break_minutes,
      totalWorkedMinutes: r.total_worked_minutes,
      status: r.status,
      source: r.source,
      notes: r.notes || "",
    }));
    sendXlsx(res, rows, "Attendance", "attendance.xlsx");
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const exportLeaveXlsx = async (req, res) => {
  try {
    const records = await listLeaveForExport();
    const rows = records.map((r) => ({
      employeeName: r.employee_name,
      employeeEmail: r.employee_email,
      department: r.department,
      type: r.type,
      startDate: r.start_date || "",
      endDate: r.end_date || "",
      status: r.status,
      reason: r.reason || "",
      rejectionReason: r.rejection_reason || "",
      createdAt: r.created_at,
    }));
    sendXlsx(res, rows, "LeaveRequests", "leave_requests.xlsx");
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Import endpoints ───────────────────────────────────────────────────────

export const importExcel = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });

    const summary = {
      sheets: [],
      totalInserted: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      totalFailed: 0,
    };

    for (const sheetName of workbook.SheetNames) {
      const rows = sheetToRows(workbook, sheetName);
      if (!rows || rows.length === 0) {
        summary.sheets.push({ sheet: sheetName, type: "empty", rows: [] });
        continue;
      }

      const headers = Object.keys(rows[0]);
      let type = req.query.type || autoDetectType(headers);
      if (!type) type = sheetName.toLowerCase().replace(/\s/g, "_");

      let sheetResult;
      if (type === "employees") sheetResult = await importEmployees(rows);
      else if (type === "attendance") sheetResult = await importAttendance(rows);
      else if (type === "leave") sheetResult = await importLeave(rows);
      else sheetResult = { inserted: 0, updated: 0, skipped: rows.length, failed: 0, rows: rows.map((_, i) => ({ row: i + 2, status: "skipped", reason: `Unknown sheet type: ${type}` })) };

      summary.sheets.push({ sheet: sheetName, type, ...sheetResult });
      summary.totalInserted += sheetResult.inserted || 0;
      summary.totalUpdated  += sheetResult.updated  || 0;
      summary.totalSkipped  += sheetResult.skipped  || 0;
      summary.totalFailed   += sheetResult.failed   || 0;
    }

    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Employee import ────────────────────────────────────────────────────────
const importEmployees = async (rows) => {
  const result = { inserted: 0, updated: 0, skipped: 0, failed: 0, rows: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const email = (row.email || row.Email || "").toLowerCase().trim();
    const fname = (row.fname || row.firstName || row.first_name || row.FirstName || "").trim();
    const lname = (row.lname || row.lastName || row.last_name || row.LastName || "").trim();
    const department = (row.department || row.Department || "").trim();

    if (!email) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: "Missing email" });
      continue;
    }
    if (!fname || !lname) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: "Missing first or last name" });
      continue;
    }
    if (!department) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: "Missing department" });
      continue;
    }

    try {
      const existing = await findEmployeeByEmail(email);
      if (existing) {
        await updateEmployeeRow(existing.id, {
          fname, lname, department,
          ...(row.jobTitle || row.job_title ? { job_title: row.jobTitle || row.job_title } : {}),
          ...(row.phone ? { phone: String(row.phone) } : {}),
        });
        result.updated++;
        result.rows.push({ row: rowNum, status: "updated", email });
      } else {
        await createEmployeeRow({
          fname, lname, email, department,
          job_title: row.jobTitle || row.job_title || "",
          phone: row.phone ? String(row.phone) : "",
          role: "readonly",
          password: "ChangeMe123!",
        });
        result.inserted++;
        result.rows.push({ row: rowNum, status: "inserted", email });
      }
    } catch (err) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: err.message, email });
    }
  }

  return result;
};

// ── Attendance import ──────────────────────────────────────────────────────
const importAttendance = async (rows) => {
  const result = { inserted: 0, updated: 0, skipped: 0, failed: 0, rows: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const email = (row.email || row.Email || row.employeeEmail || "").toLowerCase().trim();
    const dateRaw = row.date || row.Date || row.attendanceDate;

    if (!email || !dateRaw) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: "Missing email or date" });
      continue;
    }

    try {
      const employee = await findEmployeeByEmail(email);
      if (!employee) {
        result.skipped++;
        result.rows.push({ row: rowNum, status: "skipped", reason: `No employee found with email ${email}` });
        continue;
      }

      const date = new Date(dateRaw);
      const parseTime = (v) => (v ? new Date(v).toISOString() : undefined);

      await upsertAttendanceForDate(employee.id, date, {
        employee_name: `${employee.fname} ${employee.lname}`,
        employee_email: employee.email,
        department: employee.department,
        clock_in: parseTime(row.clockIn || row.clock_in || row.ClockIn),
        clock_out: parseTime(row.clockOut || row.clock_out || row.ClockOut),
        break_minutes: parseInt(row.breakMinutes || row.break_minutes || 0) || 0,
        status: (row.status || row.Status || "present").toLowerCase(),
        source: "import",
        notes: row.notes || row.Notes || "",
      });

      result.inserted++;
      result.rows.push({ row: rowNum, status: "inserted", email, date: date.toISOString().split("T")[0] });
    } catch (err) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: err.message });
    }
  }

  return result;
};

// ── Leave import ───────────────────────────────────────────────────────────
const importLeave = async (rows) => {
  const result = { inserted: 0, updated: 0, skipped: 0, failed: 0, rows: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const email = (row.email || row.Email || row.employeeEmail || "").toLowerCase().trim();
    const type = (row.type || row.leaveType || row.leave_type || row.LeaveType || "").trim();
    const startDate = row.startDate || row.start_date || row.StartDate;
    const endDate = row.endDate || row.end_date || row.EndDate;

    if (!email || !type || !startDate || !endDate) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: "Missing email, type, startDate, or endDate" });
      continue;
    }

    try {
      const employee = await findEmployeeByEmail(email);
      if (!employee) {
        result.skipped++;
        result.rows.push({ row: rowNum, status: "skipped", reason: `No employee found with email ${email}` });
        continue;
      }

      await createLeaveRequestRow({
        employee_id: employee.id,
        employee_name: `${employee.fname} ${employee.lname}`,
        employee_email: employee.email,
        department: employee.department,
        type: type.toLowerCase().replace(/\s+/g, "_"),
        start_date: new Date(startDate).toISOString().slice(0, 10),
        end_date: new Date(endDate).toISOString().slice(0, 10),
        reason: row.reason || row.Reason || "",
        status: (row.status || row.Status || "pending").toLowerCase(),
      });

      result.inserted++;
      result.rows.push({ row: rowNum, status: "inserted", email });
    } catch (err) {
      result.failed++;
      result.rows.push({ row: rowNum, status: "failed", reason: err.message });
    }
  }

  return result;
};

// ── Template downloads ─────────────────────────────────────────────────────

export const downloadTemplate = (req, res) => {
  const { type } = req.params;
  const templates = {
    employees: [{ fname: "John", lname: "Doe", email: "john@example.com", department: "Engineering", jobTitle: "Engineer", phone: "+1234567890" }],
    attendance: [{ email: "john@example.com", date: "2026-05-01", clockIn: "2026-05-01 09:00", clockOut: "2026-05-01 17:00", breakMinutes: 30, status: "present", notes: "" }],
    leave: [{ email: "john@example.com", leaveType: "vacation", startDate: "2026-06-01", endDate: "2026-06-07", reason: "Annual holiday" }],
  };

  const data = templates[type];
  if (!data) return res.status(404).json({ success: false, message: `No template for type: ${type}` });

  sendXlsx(res, data, type, `${type}_template.xlsx`);
};
