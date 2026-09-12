// Postgres (Supabase) data-access layer for `leads`, replacing model/Lead.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const TABLE = "leads";

export const isLeadsDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

export const listLeads = async ({ status, q, page = 1, limit = 100 } = {}) => {
  let query = supabaseAdmin.from(TABLE).select("*", { count: "exact" }).order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (q) {
    const like = `%${q}%`;
    query = query.or(`name.ilike.${like},email.ilike.${like},company.ilike.${like},project_type.ilike.${like}`);
  }

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(200, Math.max(1, Number(limit) || 100));
  const from = (pageNumber - 1) * limitNumber;
  query = query.range(from, from + limitNumber - 1);

  const { data, error, count } = await query;
  throwIfError(error, "Failed to list leads.");
  return { leads: data || [], total: count || 0 };
};

export const findLeadById = async (id) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", id).maybeSingle();
  throwIfError(error, "Failed to look up lead.");
  return data;
};

export const createLead = async (fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(fields).select().single();
  throwIfError(error, "Failed to create lead.");
  return data;
};

export const updateLead = async (id, fields) => {
  const { data, error } = await supabaseAdmin.from(TABLE).update(fields).eq("id", id).select().maybeSingle();
  throwIfError(error, "Failed to update lead.");
  return data;
};

export const updateLeadStatus = (id, status) => updateLead(id, { status });

// ── Analytics helpers ─────────────────────────────────────────────────────────

export const countLeadsByStatus = async (status) => {
  const { count, error } = await supabaseAdmin.from(TABLE).select("id", { count: "exact", head: true }).eq("status", status);
  throwIfError(error, "Failed to count leads.");
  return count || 0;
};

export const countLeadsExcludingStatuses = async (statuses) => {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .not("status", "in", `(${statuses.join(",")})`);
  throwIfError(error, "Failed to count leads.");
  return count || 0;
};

export const listRecentLeadsExcludingStatuses = async (statuses, limit = 5) => {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, name, company, status, priority, estimated_value, created_at")
    .not("status", "in", `(${statuses.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(limit);
  throwIfError(error, "Failed to list leads.");
  return (data || []).map((l) => ({
    _id: l.id,
    name: l.name,
    company: l.company,
    status: l.status,
    priority: l.priority,
    estimatedValue: l.estimated_value,
    createdAt: l.created_at,
  }));
};
