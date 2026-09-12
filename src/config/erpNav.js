/**
 * ERP navigation taxonomy for the admin shell.
 *
 * Each group renders as a collapsible section in the sidebar. Items with `href`
 * point at real, working pages. Items with `comingSoon: true` have no backend yet —
 * they render through <ComingSoonPage> (see src/Pages/ComingSoonPage.jsx) rather
 * than a fabricated screen, so the full target taxonomy is visible/navigable
 * without pretending unbuilt modules are live.
 *
 * `permission` items are filtered with utils/permissions.js `can()`. `comingSoon`
 * items are only shown to admin/manager roles (see AdminShell's `showFullERPNav`)
 * so operational staff aren't shown dozens of placeholder links; a group with no
 * visible items (real or roadmap) for the current user is not rendered at all.
 */

export const ERP_NAV_GROUPS = [
  {
    key: "sales",
    label: "Sales",
    icon: "point_of_sale",
    items: [
      { label: "Customers", icon: "groups", href: "/admin/customers", permission: "customers.view" },
      { label: "CRM", icon: "leaderboard", href: "/admin/leads", permission: "leads.view" },
      { label: "Quotations", icon: "request_quote", href: "/admin/quotes", permission: "quotes.view" },
      { label: "Orders", icon: "shopping_cart", href: "/admin/orders", permission: "orders.viewAll" },
      { label: "Sales Orders", icon: "receipt_long", comingSoon: true },
      { label: "Returns", icon: "assignment_return", comingSoon: true },
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    icon: "chair",
    items: [
      { label: "Products", icon: "chair", href: "/admin/products", permission: "products.view" },
      { label: "Variants", icon: "style", comingSoon: true },
      { label: "Categories", icon: "category", comingSoon: true },
      { label: "Collections", icon: "collections_bookmark", comingSoon: true },
      { label: "Attributes", icon: "tune", comingSoon: true },
      { label: "Price Lists", icon: "sell", comingSoon: true },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: "inventory_2",
    items: [
      { label: "Overview", icon: "dashboard", comingSoon: true },
      { label: "Warehouses", icon: "warehouse", comingSoon: true },
      { label: "Stock", icon: "inventory", comingSoon: true },
      { label: "Transfers", icon: "sync_alt", comingSoon: true },
      { label: "Receipts", icon: "move_to_inbox", comingSoon: true },
      { label: "Adjustments", icon: "rule", comingSoon: true },
      { label: "Replenishment", icon: "autorenew", comingSoon: true },
    ],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    icon: "shopping_bag",
    items: [
      { label: "Suppliers", icon: "storefront", comingSoon: true },
      { label: "RFQs", icon: "request_page", comingSoon: true },
      { label: "Purchase Orders", icon: "shopping_bag", comingSoon: true },
      { label: "Receipts", icon: "move_to_inbox", comingSoon: true },
    ],
  },
  {
    key: "manufacturing",
    label: "Manufacturing",
    icon: "precision_manufacturing",
    items: [
      { label: "BOMs", icon: "account_tree", comingSoon: true },
      { label: "Manufacturing Orders", icon: "precision_manufacturing", comingSoon: true },
      { label: "Work Centers", icon: "factory", comingSoon: true },
      { label: "Quality", icon: "verified", comingSoon: true },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    icon: "local_shipping",
    items: [
      { label: "Deliveries", icon: "local_shipping", comingSoon: true },
      { label: "Installations", icon: "handyman", comingSoon: true },
      { label: "Warranty", icon: "shield", comingSoon: true },
      { label: "Service", icon: "support_agent", comingSoon: true },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    icon: "account_balance",
    items: [
      { label: "Invoices", icon: "receipt", comingSoon: true },
      { label: "Vendor Bills", icon: "description", comingSoon: true },
      { label: "Payments", icon: "payments", comingSoon: true },
      { label: "Expenses", icon: "credit_card", comingSoon: true },
      { label: "Accounting", icon: "calculate", comingSoon: true },
      { label: "Reports", icon: "analytics", href: "/admin/reports", permission: "reports.view" },
    ],
  },
  {
    key: "organization",
    label: "Organization",
    icon: "corporate_fare",
    items: [
      { label: "Employees", icon: "badge", href: "/admin/employees", permission: "employees.view" },
      { label: "Attendance", icon: "event_available", href: "/admin/attendance", permission: "attendance.viewAll" },
      { label: "Leave Requests", icon: "beach_access", href: "/admin/leave", permission: "leave.viewAll" },
      { label: "Roles", icon: "admin_panel_settings", comingSoon: true },
      { label: "Approvals", icon: "task_alt", href: "/admin/erp/approvals", permission: "erp.view" },
      { label: "Automations", icon: "bolt", href: "/admin/erp/workflow", permission: "erp.view" },
      { label: "ERP Architecture", icon: "account_tree", href: "/admin/erp/overview", permission: "erp.view" },
      { label: "Email Outbox", icon: "outgoing_mail", href: "/admin/emails", permission: "emails.view" },
      { label: "Documents", icon: "folder", comingSoon: true },
      { label: "Audit Log", icon: "history", comingSoon: true },
    ],
  },
];

/** Top-level items that sit outside any collapsible group. */
export const ERP_TOP_LEVEL_ITEMS = [
  { label: "Analytics", icon: "bar_chart", href: "/admin/analytics", permission: "analytics.view" },
  { label: "Settings", icon: "settings", href: "/admin/settings", requireAdmin: true },
];

/** Employee self-service items — shown instead of/alongside groups for viewOwn-only roles. */
export const EMPLOYEE_SELF_SERVICE_ITEMS = [
  { label: "My Attendance", icon: "event_available", href: "/employee/attendance", permission: "attendance.viewOwn", excludeIfHas: "attendance.viewAll" },
  { label: "My Leave", icon: "beach_access", href: "/employee/leave-requests", permission: "leave.viewOwn", excludeIfHas: "leave.viewAll" },
];

export const comingSoonHref = (groupLabel, itemLabel) =>
  `/admin/coming-soon?module=${encodeURIComponent(`${groupLabel} · ${itemLabel}`)}`;
