// Postgres (Supabase) data-access layer for `support_inquiries`, replacing
// model/SupportInquiry.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "support_inquiries";
export const SUPPORT_TYPES = [
  "Order Issue",
  "Delivery Question",
  "Product Inquiry",
  "Return / Exchange",
  "Account Help",
  "Trade Program",
  "Other",
];
export const INQUIRY_SOURCES = ["contact_page", "support_portal", "trade_program"];

export const isSupportDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

export const createSupportInquiry = async (fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(fields).select().single();
  throwIfError(error, "Failed to create support inquiry.");
  return data;
};

export const listSupportInquiries = async ({ status, type, source, page = 1, limit = 50 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  if (source) query = query.eq("source", source);

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const from = (safePage - 1) * safeLimit;
  query = query.range(from, from + safeLimit - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list support inquiries.");
  return { inquiries: data || [], total: count || 0, page: safePage, limit: safeLimit };
};
