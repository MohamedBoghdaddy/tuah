// Postgres (Supabase) data-access layer for `addresses`/`payment_methods`,
// replacing model/Address.js and model/PaymentMethod.js.
import { supabaseAdmin, isSupabaseConfigured } from "../config/supabase.js";

export const isCustomerDbReady = () => isSupabaseConfigured();

const throwIfError = (error, fallbackMessage) => {
  if (error) throw new Error(error.message || fallbackMessage);
};

// ── Addresses ────────────────────────────────────────────────────────────────

export const listAddresses = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from("addresses")
    .select("*")
    .eq("user_id", userId)
    .order("is_default_shipping", { ascending: false })
    .order("created_at", { ascending: true });
  throwIfError(error, "Failed to list addresses.");
  return data || [];
};

export const createAddress = async (fields) => {
  const { data, error } = await supabaseAdmin.from("addresses").insert(fields).select().single();
  throwIfError(error, "Failed to create address.");
  return data;
};

export const clearDefaultAddresses = async (userId, field) => {
  const { error } = await supabaseAdmin.from("addresses").update({ [field]: false }).eq("user_id", userId);
  throwIfError(error, "Failed to update addresses.");
};

export const updateAddressForUser = async (id, userId, fields) => {
  const { data, error } = await supabaseAdmin
    .from("addresses")
    .update(fields)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  throwIfError(error, "Failed to update address.");
  return data;
};

export const deleteAddressForUser = async (id, userId) => {
  const { data, error } = await supabaseAdmin
    .from("addresses")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  throwIfError(error, "Failed to delete address.");
  return data;
};

// ── Payment methods ──────────────────────────────────────────────────────────

export const listActivePaymentMethods = async (userId) => {
  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  throwIfError(error, "Failed to list payment methods.");
  return data || [];
};

export const clearDefaultPaymentMethods = async (userId) => {
  const { error } = await supabaseAdmin.from("payment_methods").update({ is_default: false }).eq("user_id", userId);
  throwIfError(error, "Failed to update payment methods.");
};

export const updatePaymentMethodForUser = async (id, userId, fields) => {
  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .update(fields)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  throwIfError(error, "Failed to update payment method.");
  return data;
};
