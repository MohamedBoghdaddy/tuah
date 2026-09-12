// Postgres (Supabase) data-access layer for `orders`/`order_items`, replacing model/Order.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const VALID_STATUSES = ["new", "confirmed", "in_production", "ready", "delivered", "cancelled"];

export const isOrdersDbReady = () => isSupabaseConfigured();

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

const SELECT_WITH_RELATIONS =
  "*, order_items(*), customer:users(id, first_name, last_name, email), assigned_employee:employees(id, fname, lname, email)";

export const toOrderJSON = (row) => {
  if (!row) return null;
  const customer = row.customer;
  const employee = row.assigned_employee;

  return {
    _id: row.id,
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    items: (row.order_items || []).map((item) => ({
      productId: item.product_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      total: item.total,
      imageUrl: item.image_url,
      sku: item.sku,
    })),
    subtotal: row.subtotal,
    tax: row.tax,
    installationFee: row.installation_fee,
    discount: row.discount,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    assignedEmployeeId: row.assigned_employee_id,
    assignedEmployeeName: row.assigned_employee_name,
    deliveryAddress: row.delivery_address || {},
    installationPreference: row.installation_preference,
    estimatedDays: row.estimated_days,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    _resolvedCustomerName: customer
      ? `${customer.first_name} ${customer.last_name}`.trim() || row.customer_name
      : row.customer_name,
    _resolvedAssigneeName: employee
      ? `${employee.fname} ${employee.lname}`.trim()
      : row.assigned_employee_name,
  };
};

export const generateOrderNumber = () => `TU-${Date.now().toString().slice(-6)}`;

export const listAdminOrders = async ({ status, page = 1, limit = 100 } = {}) => {
  let query = supabaseAdmin
    .from("orders")
    .select(SELECT_WITH_RELATIONS, { count: "exact" })
    .order("created_at", { ascending: false });

  if (status && VALID_STATUSES.includes(status)) query = query.eq("status", status);

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 100));
  const from = (pageNum - 1) * limitNum;
  query = query.range(from, from + limitNum - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list orders.");
  return { orders: (data || []).map(toOrderJSON), total: count || 0 };
};

export const findOrderById = async (id) => {
  const { data, error } = await supabaseAdmin.from("orders").select(SELECT_WITH_RELATIONS).eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up order.");
  return toOrderJSON(data);
};

export const findOrderForCustomer = async (id, customerId) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(SELECT_WITH_RELATIONS)
    .eq("id", id)
    .eq("customer_id", customerId)
    .maybeSingle();
  throwIfError(error, "Failed to look up order.");
  return toOrderJSON(data);
};

export const listOrdersForCustomer = async (customerId, limit = 50) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(SELECT_WITH_RELATIONS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error, "Failed to list orders.");
  return (data || []).map(toOrderJSON);
};

const insertOrderItems = async (orderId, items) => {
  if (!items?.length) return;
  const rows = items.map((item) => ({
    order_id: orderId,
    product_id: item.productId || null,
    name: item.name || "Item",
    quantity: Math.max(1, Number(item.quantity) || 1),
    unit_price: Number(item.unitPrice) || 0,
    total: Number(item.total) || 0,
    image_url: item.imageUrl || "",
    sku: item.sku || "",
  }));
  const { error } = await supabaseAdmin.from("order_items").insert(rows);
  throwIfError(error, "Failed to save order items.");
};

export const createOrder = async (fields, items = []) => {
  const { data, error } = await supabaseAdmin.from("orders").insert(fields).select("id").single();
  if (error) throw withDuplicateCheck(error, "Order number already exists.");

  try {
    await insertOrderItems(data.id, items);
  } catch (itemError) {
    // Roll back the order header if item insertion fails, so we never leave an itemless order.
    await supabaseAdmin.from("orders").delete().eq("id", data.id);
    throw itemError;
  }

  return findOrderById(data.id);
};

export const updateOrder = async (id, fields, items) => {
  if (Object.keys(fields).length) {
    const { error } = await supabaseAdmin.from("orders").update(fields).eq("id", id);
    throwIfError(error, "Failed to update order.");
  }

  if (Array.isArray(items)) {
    const { error: deleteError } = await supabaseAdmin.from("order_items").delete().eq("order_id", id);
    throwIfError(deleteError, "Failed to update order items.");
    await insertOrderItems(id, items);
  }

  return findOrderById(id);
};

export const updateOrderStatus = (id, status) => updateOrder(id, { status });
export const cancelOrder = (id) => updateOrder(id, { status: "cancelled" });

// ── Analytics helpers ─────────────────────────────────────────────────────────
// Aggregation is done in JS after a narrow select, matching the pattern
// already used for low-stock products — supabase-js/PostgREST has no native
// GROUP BY, and this app's order volume doesn't need a raw-SQL RPC for it.

export const countOrdersExcludingStatus = async (status) => {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .neq("status", status);
  throwIfError(error, "Failed to count orders.");
  return count || 0;
};

export const listRecentOrdersExcludingStatus = async (status, limit = 5) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, customer_name, total, status, created_at")
    .neq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error, "Failed to list orders.");
  return (data || []).map((o) => ({
    _id: o.id,
    orderNumber: o.order_number,
    customerName: o.customer_name,
    total: o.total,
    status: o.status,
    createdAt: o.created_at,
  }));
};

export const listOrdersForExportExcludingStatus = async (status, limit = 500) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number, customer_name, status, payment_status, subtotal, tax, installation_fee, total, created_at")
    .neq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error, "Failed to list orders.");
  return (data || []).map((o) => ({
    orderNumber: o.order_number,
    customerName: o.customer_name,
    status: o.status,
    paymentStatus: o.payment_status,
    subtotal: o.subtotal,
    tax: o.tax,
    installationFee: o.installation_fee,
    total: o.total,
    createdAt: o.created_at,
  }));
};

export const sumOrderTotalsExcludingStatus = async (status) => {
  const { data, error } = await supabaseAdmin.from("orders").select("total").neq("status", status);
  throwIfError(error, "Failed to sum order totals.");
  return (data || []).reduce((sum, o) => sum + Number(o.total || 0), 0);
};

export const countOrdersByStatusGroup = async () => {
  const { data, error } = await supabaseAdmin.from("orders").select("status");
  throwIfError(error, "Failed to count orders by status.");
  const counts = {};
  (data || []).forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  return Object.entries(counts).map(([status, count]) => ({ _id: status, count }));
};

// { _id: monthNumber (1-12), revenue, count } — matches the shape the old
// Mongo $month aggregation returned, so callers don't need to change.
export const groupMonthlyOrderTotals = async (sinceDate, excludeStatus = "cancelled") => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("total, created_at")
    .neq("status", excludeStatus)
    .gte("created_at", sinceDate.toISOString());
  throwIfError(error, "Failed to group monthly order totals.");

  const byMonth = new Map();
  (data || []).forEach((o) => {
    const month = new Date(o.created_at).getMonth() + 1; // 1-12
    const entry = byMonth.get(month) || { _id: month, revenue: 0, count: 0 };
    entry.revenue += Number(o.total || 0);
    entry.count += 1;
    byMonth.set(month, entry);
  });
  return [...byMonth.values()].sort((a, b) => a._id - b._id);
};

// { _id: category, revenue, unitsSold } from order_items joined to products,
// scoped to non-cancelled orders. Now a real Postgres join (both tables live
// here), fixing the "Uncategorised" degradation from the Phase 2 interim state.
export const groupCategoryRevenue = async (limit = 8, excludeStatus = "cancelled") => {
  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("total, quantity, products(category), orders!inner(status)")
    .neq("orders.status", excludeStatus);
  throwIfError(error, "Failed to group category revenue.");

  const byCategory = new Map();
  (data || []).forEach((item) => {
    const category = item.products?.category || "Uncategorised";
    const entry = byCategory.get(category) || { _id: category, revenue: 0, unitsSold: 0 };
    entry.revenue += Number(item.total || 0);
    entry.unitsSold += Number(item.quantity || 0);
    byCategory.set(category, entry);
  });
  return [...byCategory.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
};

// { _id: itemName, revenue, unitsSold } from order_items, scoped to non-cancelled orders.
export const groupTopProductsByRevenue = async (limit = 6, excludeStatus = "cancelled") => {
  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("name, total, quantity, orders!inner(status)")
    .neq("orders.status", excludeStatus);
  throwIfError(error, "Failed to group top products.");

  const byName = new Map();
  (data || []).forEach((item) => {
    const entry = byName.get(item.name) || { _id: item.name, revenue: 0, unitsSold: 0 };
    entry.revenue += Number(item.total || 0);
    entry.unitsSold += Number(item.quantity || 0);
    byName.set(item.name, entry);
  });
  return [...byName.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
};
