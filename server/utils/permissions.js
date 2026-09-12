// Single source of truth for role/permission logic, shared by both the
// `users` and `employees` tables. Moved out of the old Mongoose schema
// methods (model/usermodel.js, model/employeemodel.js) so it works against
// plain row objects returned by supabase-js instead of Mongoose documents.

// Granular permissions list — backend enforces, frontend uses to hide/show UI
export const ALL_PERMISSIONS = [
  // Products
  "products.view", "products.create", "products.update", "products.delete",
  "products.uploadImage", "products.importExcel", "products.exportExcel",
  // Orders
  "orders.viewAll", "orders.viewOwn", "orders.updateStatus", "orders.create",
  "orders.cancel", "orders.exportExcel",
  // Employees
  "employees.view", "employees.create", "employees.update", "employees.archive",
  "employees.invite", "employees.importExcel", "employees.exportExcel",
  // Customers
  "customers.view", "customers.exportExcel",
  // Attendance
  "attendance.viewAll", "attendance.viewOwn", "attendance.create",
  "attendance.update", "attendance.delete", "attendance.importExcel",
  "attendance.exportExcel", "attendance.clockInOut",
  // Leave requests
  "leave.viewAll", "leave.viewOwn", "leave.request", "leave.approve",
  "leave.reject", "leave.escalate", "leave.exportExcel",
  // Leads & Quotes
  "leads.view", "leads.create", "leads.update",
  "quotes.view", "quotes.create", "quotes.update", "quotes.sendEmail",
  // Analytics & Reports
  "analytics.view", "analytics.export",
  "reports.view", "reports.export",
  // ERP
  "erp.view", "erp.manage",
  // Approvals
  "approvals.view", "approvals.approve", "approvals.reject", "approvals.escalate",
  // Email outbox
  "emails.view", "emails.retry",
  // Settings
  "settings.view", "settings.manage",
  // Inventory / WMS
  "inventory.read", "inventory.adjust", "inventory.transfer", "inventory.receive",
  "inventory.reservations.manage", "inventory.settings.manage", "warehouses.manage",
];

// Default permissions per role
export const ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,

  admin: ALL_PERMISSIONS,

  manager: [
    "products.view",
    "orders.viewAll", "orders.updateStatus", "orders.exportExcel",
    "employees.view",
    "attendance.viewAll", "attendance.create", "attendance.update", "attendance.exportExcel",
    "leave.viewAll", "leave.approve", "leave.reject", "leave.escalate", "leave.exportExcel",
    "leads.view", "leads.update",
    "quotes.view",
    "analytics.view",
    "reports.view",
    "erp.view",
    "approvals.view", "approvals.approve", "approvals.reject",
    "inventory.read", "inventory.adjust", "inventory.transfer", "inventory.receive",
    "inventory.reservations.manage", "inventory.settings.manage",
  ],

  HR: [
    "employees.view", "employees.create", "employees.update", "employees.archive",
    "employees.invite", "employees.importExcel", "employees.exportExcel",
    "attendance.viewAll", "attendance.create", "attendance.update", "attendance.delete",
    "attendance.importExcel", "attendance.exportExcel",
    "leave.viewAll", "leave.approve", "leave.reject", "leave.escalate", "leave.exportExcel",
    "approvals.view", "approvals.approve", "approvals.reject", "approvals.escalate",
    "reports.view",
  ],

  accountant: [
    "orders.viewAll", "orders.exportExcel",
    "quotes.view", "quotes.create", "quotes.update",
    "analytics.view", "analytics.export",
    "reports.view", "reports.export",
    "leads.view",
  ],

  operations: [
    "products.view", "products.update", "products.exportExcel",
    "orders.viewAll", "orders.updateStatus", "orders.exportExcel",
    "attendance.viewOwn", "attendance.clockInOut",
    "leave.viewOwn", "leave.request",
    "leads.view",
    "inventory.read", "inventory.adjust", "inventory.transfer", "inventory.receive",
  ],

  designer: [
    "products.view",
    "attendance.viewOwn", "attendance.clockInOut",
    "leave.viewOwn", "leave.request",
  ],

  employee: [
    "attendance.viewOwn", "attendance.clockInOut",
    "leave.viewOwn", "leave.request",
  ],

  customer: [
    "orders.viewOwn",
  ],
};

// Employee.role uses "readonly" where User.role uses "employee" for the
// equivalent base permission set — same mapping as the old employeemodel.js.
export const EMPLOYEE_ROLE_MAP = {
  admin: "admin",
  super_admin: "super_admin",
  manager: "manager",
  HR: "HR",
  accountant: "accountant",
  operations: "operations",
  designer: "designer",
  readonly: "employee",
};

// `row` is a plain object from either the `users` or `employees` table
// (supabase-js snake_case: permissions, denied_permissions, role).
export const getEffectivePermissions = (row, { isEmployee = false } = {}) => {
  const roleKey = isEmployee ? EMPLOYEE_ROLE_MAP[row.role] || "employee" : row.role;
  const base = new Set(ROLE_PERMISSIONS[roleKey] || []);
  (row.permissions || []).forEach((p) => base.add(p));
  (row.denied_permissions || []).forEach((p) => base.delete(p));
  return [...base];
};

export const can = (row, permission, options) =>
  getEffectivePermissions(row, options).includes(permission);
