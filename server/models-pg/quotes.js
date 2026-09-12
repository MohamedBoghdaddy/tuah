// Postgres (Supabase) data-access layer for `quotes`/`quote_items`, replacing model/Quote.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "quotes";
const ITEMS_TABLE = "quote_items";
const SELECT_WITH_RELATIONS = "*, quote_items(*), lead:leads(id, name, email, company, project_type)";

export const isQuotesDbReady = () => isSupabaseConfigured();

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

export const toQuoteJSON = (row) => {
  if (!row) return null;
  const items = (row.quote_items || [])
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((i) => ({ name: i.name, description: i.description, quantity: i.quantity, unitPrice: i.unit_price, total: i.total }));
  return { ...row, items, leadId: row.lead_id };
};

export const nextQuoteNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `TU-Q-${year}-`;
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .like("quote_number", `${prefix}%`);
  throwIfError(error, "Failed to generate quote number.");
  return `${prefix}${String((count || 0) + 1).padStart(4, "0")}`;
};

export const listQuotes = async ({ status, page = 1, limit = 100 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select(SELECT_WITH_RELATIONS, { count: "exact" }).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(200, Math.max(1, Number(limit) || 100));
  const from = (pageNumber - 1) * limitNumber;
  query = query.range(from, from + limitNumber - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list quotes.");
  return { quotes: (data || []).map(toQuoteJSON), total: count || 0 };
};

export const findQuoteById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select(SELECT_WITH_RELATIONS).eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up quote.");
  return toQuoteJSON(data);
};

const insertQuoteItems = async (quoteId, items) => {
  if (!items?.length) return;
  const rows = items.map((item, i) => ({
    quote_id: quoteId,
    name: item.name,
    description: item.description || "",
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total: item.total,
    position: i,
  }));
  const { error } = await supabaseAdmin.from(ITEMS_TABLE).insert(rows);
  throwIfError(error, "Failed to save quote items.");
};

export const createQuote = async (fields, items = []) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(fields).select("id").single();
  if (error) throw withDuplicateCheck(error, "Quote number already exists.");

  try {
    await insertQuoteItems(data.id, items);
  } catch (itemError) {
    await supabaseAdmin.from(TABLE).delete().eq("id", data.id);
    throw itemError;
  }

  return findQuoteById(data.id);
};

export const updateQuote = async (id, fields, items) => {
  if (Object.keys(fields).length) {
    const { error } = await supabaseAdmin.from(TABLE).update(fields).eq("id", id);
    throwIfError(error, "Failed to update quote.");
  }

  if (Array.isArray(items)) {
    const { error: deleteError } = await supabaseAdmin.from(ITEMS_TABLE).delete().eq("quote_id", id);
    throwIfError(deleteError, "Failed to update quote items.");
    await insertQuoteItems(id, items);
  }

  return findQuoteById(id);
};

export const updateQuoteStatus = (id, status) => updateQuote(id, { status });

// ── Analytics helpers ─────────────────────────────────────────────────────────

export const countQuotesByStatus = async (status) => {
  const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).eq("status", status);
  throwIfError(error, "Failed to count quotes.");
  return count || 0;
};

export const countQuotesByStatuses = async (statuses) => {
  const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).in("status", statuses);
  throwIfError(error, "Failed to count quotes.");
  return count || 0;
};

export const countQuotesExcludingStatuses = async (statuses) => {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .not("status", "in", `(${statuses.join(",")})`);
  throwIfError(error, "Failed to count quotes.");
  return count || 0;
};
