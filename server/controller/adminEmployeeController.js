import {
  listEmployees as listEmployeesRows,
  findEmployeeById,
  createEmployee as createEmployeeRow,
  updateEmployee as updateEmployeeRow,
  deactivateEmployee as deactivateEmployeeRow,
  countEmployeesByRole,
} from "../models-pg/employees.js";

const roles = ["readonly", "admin"];
const statuses = ["active", "inactive", "invited", "suspended"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);

const toEmployeePayload = (body, { partial = false } = {}) => {
  const allowed = [
    "fname",
    "lname",
    "email",
    "department",
    "jobTitle",
    "seniorityLevel",
    "phone",
    "role",
    "status",
  ];
  const fieldMap = {
    fname: "fname",
    lname: "lname",
    email: "email",
    department: "department",
    jobTitle: "job_title",
    seniorityLevel: "seniority_level",
    phone: "phone",
    role: "role",
    status: "status",
  };
  const payload = {};

  allowed.forEach((field) => {
    if (body[field] !== undefined) {
      const value = typeof body[field] === "string" ? body[field].trim() : body[field];
      payload[fieldMap[field]] = value;
    }
  });

  if (payload.email) payload.email = payload.email.toLowerCase();
  // If no password is supplied, leave it unset — createEmployee() generates one.
  if (body.password) payload.password = body.password;

  return payload;
};

const validateEmployeePayload = (payload, { partial = false } = {}) => {
  if (!partial) {
    const missing = ["fname", "lname", "email", "department"].filter(
      (field) => !payload[field]
    );
    if (missing.length) return `${missing.join(", ")} required.`;
  }

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "A valid email is required.";
  }
  if (payload.role && !roles.includes(payload.role)) return "Invalid employee role.";
  if (payload.status && !statuses.includes(payload.status)) return "Invalid employee status.";

  return null;
};

const handleDuplicate = (error, res) => {
  if (error?.code !== "23505") return false;
  res.status(409).json({ success: false, message: "Employee email must be unique." });
  return true;
};

export const listEmployees = async (req, res) => {
  const { status, q, department } = req.query;
  const employees = await listEmployeesRows({ status, q, department });
  return res.json({ success: true, count: employees.length, employees });
};

export const getEmployeeById = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid employee id." });
  }

  const employee = await findEmployeeById(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });
  return res.json({ success: true, employee });
};

export const createEmployee = async (req, res) => {
  try {
    const payload = toEmployeePayload(req.body);
    const validationError = validateEmployeePayload(payload);
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    if (payload.role === "admin") {
      const adminCount = await countEmployeesByRole("admin", { excludeStatus: "inactive" });
      if (adminCount >= 2) {
        return res.status(400).json({ success: false, message: "There can only be two active admins." });
      }
    }

    const employee = await createEmployeeRow(payload);
    return res.status(201).json({ success: true, employee });
  } catch (error) {
    if (handleDuplicate(error, res)) return;
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEmployee = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid employee id." });
  }

  try {
    const payload = toEmployeePayload(req.body, { partial: true });
    const validationError = validateEmployeePayload(payload, { partial: true });
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    if (payload.role === "admin") {
      const currentEmployee = await findEmployeeById(req.params.id);
      const adminCount = await countEmployeesByRole("admin", { excludeStatus: "inactive" });
      if (adminCount >= 2 && currentEmployee?.role !== "admin") {
        return res.status(400).json({ success: false, message: "Maximum admin limit reached." });
      }
    }

    const employee = await updateEmployeeRow(req.params.id, payload);
    if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

    return res.json({ success: true, employee });
  } catch (error) {
    if (handleDuplicate(error, res)) return;
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deactivateEmployee = async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid employee id." });
  }

  const employee = await deactivateEmployeeRow(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });
  return res.json({ success: true, employee, message: "Employee deactivated." });
};
