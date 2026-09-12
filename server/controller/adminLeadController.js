import PDFDocument from "pdfkit";
import {
  listLeads as listLeadsRows,
  findLeadById,
  createLead as createLeadRow,
  updateLead as updateLeadRow,
  updateLeadStatus as updateLeadStatusRow,
} from "../models-pg/leads.js";
import {
  listQuotes as listQuotesRows,
  findQuoteById,
  createQuote as createQuoteRow,
  updateQuote as updateQuoteRow,
  updateQuoteStatus as updateQuoteStatusRow,
  nextQuoteNumber,
} from "../models-pg/quotes.js";
import { isSupabaseConfigured } from "../config/supabase.js";
import { deliverEmail } from "../services/emailDeliveryService.js";
import { queueEmail } from "../services/emailOutboxService.js";

const leadStatuses = ["new", "contacted", "qualified", "proposal", "won", "lost", "archived"];
const priorities = ["low", "medium", "high", "urgent"];
const quoteStatuses = ["draft", "pending", "sent", "accepted", "rejected", "expired", "converted", "cancelled"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidId = (id) => typeof id === "string" && UUID_RE.test(id);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const clean = (value) => (typeof value === "string" ? value.trim() : value);
const parseAmount = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const LEAD_FIELD_MAP = {
  name: "name", email: "email", phone: "phone", company: "company",
  projectType: "project_type", source: "source", status: "status",
  priority: "priority", notes: "notes",
};

const leadPayload = (body) => {
  const payload = {};
  Object.entries(LEAD_FIELD_MAP).forEach(([bodyKey, column]) => {
    if (body[bodyKey] !== undefined) payload[column] = clean(body[bodyKey]);
  });

  if (payload.email) payload.email = payload.email.toLowerCase();
  if (body.estimatedValue !== undefined || body.budget !== undefined) {
    payload.estimated_value = parseAmount(body.estimatedValue ?? body.budget);
  }
  if (Array.isArray(body.tags)) payload.tags = body.tags.map(clean).filter(Boolean);
  else if (typeof body.tags === "string") {
    payload.tags = body.tags.split(",").map(clean).filter(Boolean);
  }
  if (body.assignedTo && isValidId(body.assignedTo)) payload.assigned_to = body.assignedTo;
  if (body.convertedCustomerId && isValidId(body.convertedCustomerId)) {
    payload.converted_customer_id = body.convertedCustomerId;
  }

  return payload;
};

const validateLead = (payload, { partial = false } = {}) => {
  if (!partial) {
    const missing = ["name", "email"].filter((field) => !payload[field]);
    if (missing.length) return `${missing.join(", ")} required.`;
  }
  if (payload.email && !isValidEmail(payload.email)) return "A valid lead email is required.";
  if (payload.status && !leadStatuses.includes(payload.status)) return "Invalid lead status.";
  if (payload.priority && !priorities.includes(payload.priority)) return "Invalid lead priority.";
  if (
    payload.estimated_value !== undefined &&
    (!Number.isFinite(payload.estimated_value) || payload.estimated_value < 0)
  ) {
    return "Estimated value must be a non-negative number.";
  }
  return null;
};

const normalizeItems = (items, fallbackAmount = 0) => {
  if (!Array.isArray(items) || items.length === 0) {
    const amount = Math.max(0, parseAmount(fallbackAmount, 0));
    return [{ name: "Custom Tuwa scope", description: "", quantity: 1, unitPrice: amount, total: amount }];
  }

  return items
    .map((item) => {
      if (typeof item === "string") {
        return { name: item.trim(), description: "", quantity: 1, unitPrice: 0, total: 0 };
      }
      const quantity = Math.max(1, parseAmount(item.quantity, 1));
      const unitPrice = Math.max(0, parseAmount(item.unitPrice ?? item.price, 0));
      return {
        name: clean(item.name) || "Custom item",
        description: clean(item.description) || "",
        quantity,
        unitPrice,
        total: quantity * unitPrice,
      };
    })
    .filter((item) => item.name);
};

const quotePayload = (body) => {
  const payload = {};
  ["customerName", "customerEmail", "project", "status", "notes"].forEach((field) => {
    const column = { customerName: "customer_name", customerEmail: "customer_email", project: "project", status: "status", notes: "notes" }[field];
    if (body[field] !== undefined) payload[column] = clean(body[field]);
  });
  if (payload.customer_email) payload.customer_email = payload.customer_email.toLowerCase();
  if (body.leadId && isValidId(body.leadId)) payload.lead_id = body.leadId;
  if (body.customerId && isValidId(body.customerId)) payload.customer_id = body.customerId;
  if (body.validUntil) payload.valid_until = new Date(body.validUntil).toISOString();
  if (body.discount !== undefined) payload.discount = parseAmount(body.discount, 0);
  if (body.tax !== undefined) payload.tax = parseAmount(body.tax, 0);

  const items = body.items !== undefined || body.amount !== undefined
    ? normalizeItems(body.items, body.amount)
    : undefined;

  return { fields: payload, items };
};

const calculateQuoteTotals = (fields, items) => {
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const discount = Math.max(0, parseAmount(fields.discount, 0));
  const tax = Math.max(0, parseAmount(fields.tax, 0));
  const total = Math.max(0, subtotal - discount + tax);
  return { ...fields, subtotal, discount, tax, total };
};

const validateQuote = (fields, items, { partial = false } = {}) => {
  if (!partial && !fields.customer_name && !fields.customer_email && !fields.lead_id) {
    return "A customer name, customer email, or lead is required.";
  }
  if (fields.customer_email && !isValidEmail(fields.customer_email)) return "A valid quote email is required.";
  if (fields.status && !quoteStatuses.includes(fields.status)) return "Invalid quote status.";
  if (!Array.isArray(items) || items.length === 0) return "At least one quote item is required.";
  if (items.some((item) => !item.name || item.quantity < 1 || item.unitPrice < 0)) {
    return "Quote items must include a name, positive quantity, and non-negative unit price.";
  }
  return null;
};

const resolveQuoteRecipient = async (quote) => {
  if (quote.customer_email) return { email: quote.customer_email, name: quote.customer_name };
  if (quote.lead_id) {
    const lead = await findLeadById(quote.lead_id);
    if (lead?.email) return { email: lead.email, name: lead.name };
  }
  return null;
};

export const listLeads = async (req, res) => {
  const { status, q, page = 1, limit = 100 } = req.query;
  const { leads, total } = await listLeadsRows({ status, q, page, limit });
  return res.json({ success: true, count: leads.length, total, leads });
};

export const getLead = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid lead id." });
  const lead = await findLeadById(req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
  return res.json({ success: true, lead });
};

export const createLead = async (req, res) => {
  const payload = leadPayload(req.body);
  const validationError = validateLead(payload);
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  if (req.user?.id) payload.created_by = req.user.id;
  const lead = await createLeadRow(payload);
  return res.status(201).json({ success: true, lead });
};

export const updateLead = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid lead id." });
  const payload = leadPayload(req.body);
  const validationError = validateLead(payload, { partial: true });
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  const lead = await updateLeadRow(req.params.id, payload);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
  return res.json({ success: true, lead });
};

export const updateLeadStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid lead id." });
  const { status } = req.body;
  if (!leadStatuses.includes(status)) return res.status(400).json({ success: false, message: "Invalid lead status." });
  const lead = await updateLeadStatusRow(req.params.id, status);
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
  return res.json({ success: true, lead });
};

export const deleteLead = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid lead id." });
  const lead = await updateLeadStatusRow(req.params.id, "archived");
  if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
  return res.json({ success: true, lead, message: "Lead archived." });
};

export const listQuotes = async (req, res) => {
  const { status, page = 1, limit = 100 } = req.query;
  const { quotes, total } = await listQuotesRows({ status, page, limit });
  return res.json({ success: true, count: quotes.length, total, quotes });
};

export const getQuote = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid quote id." });
  const quote = await findQuoteById(req.params.id);
  if (!quote) return res.status(404).json({ success: false, message: "Quote not found." });
  return res.json({ success: true, quote });
};

export const createQuote = async (req, res) => {
  const { fields, items: rawItems } = quotePayload(req.body);
  const items = rawItems || normalizeItems(req.body.items, req.body.amount);
  const payload = calculateQuoteTotals(fields, items);
  const validationError = validateQuote(payload, items);
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  if (req.user?.id) payload.created_by = req.user.id;
  payload.quote_number = await nextQuoteNumber();
  const quote = await createQuoteRow(payload, items);
  return res.status(201).json({ success: true, quote });
};

export const updateQuote = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid quote id." });
  const existing = await findQuoteById(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: "Quote not found." });

  const { fields: incoming, items: incomingItems } = quotePayload(req.body);
  const items = incomingItems || existing.items;
  const payload = calculateQuoteTotals({ discount: existing.discount, tax: existing.tax, ...incoming }, items);

  const validationError = validateQuote(payload, items, { partial: true });
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  const quote = await updateQuoteRow(req.params.id, payload, incomingItems ? items : undefined);
  return res.json({ success: true, quote });
};

export const updateQuoteStatus = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid quote id." });
  const { status } = req.body;
  if (!quoteStatuses.includes(status)) return res.status(400).json({ success: false, message: "Invalid quote status." });
  const quote = await updateQuoteStatusRow(req.params.id, status);
  if (!quote) return res.status(404).json({ success: false, message: "Quote not found." });
  return res.json({ success: true, quote });
};

export const sendQuote = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid quote id." });
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      success: false,
      status: "supabase_not_configured",
      message: "Supabase email outbox is not configured.",
    });
  }

  const quote = await findQuoteById(req.params.id);
  if (!quote) return res.status(404).json({ success: false, message: "Quote not found." });
  const recipient = await resolveQuoteRecipient(quote);
  if (!recipient?.email) {
    return res.status(400).json({ success: false, message: "Quote recipient email is missing." });
  }

  const validUntilText = quote.valid_until ? new Date(quote.valid_until).toDateString() : "";
  const subject = `Tuwa Commerce Quote ${quote.quote_number}`;
  const bodyText = [
    `Hello ${recipient.name || "there"},`,
    `Your quote ${quote.quote_number} is ready.`,
    `Total: ${money(quote.total)}`,
    validUntilText ? `Valid until: ${validUntilText}` : "",
    quote.notes || "",
  ].filter(Boolean).join("\n\n");
  const bodyHtml = `
    <h2>Quote ${quote.quote_number}</h2>
    <p>Hello ${recipient.name || "there"},</p>
    <p>Your Tuwa Commerce quote is ready.</p>
    <p><strong>Total:</strong> ${money(quote.total)}</p>
    ${validUntilText ? `<p><strong>Valid until:</strong> ${validUntilText}</p>` : ""}
    ${quote.notes ? `<p>${quote.notes}</p>` : ""}
  `;

  const outboxRow = await queueEmail({
    toEmail: recipient.email,
    toName: recipient.name,
    subject,
    bodyHtml,
    bodyText,
    templateKey: "quote_send",
    templateVariables: { quoteNumber: quote.quote_number, total: quote.total },
    relatedEntityType: "quote",
    relatedEntityId: quote.id,
    mongoUserId: quote.customer_id || undefined,
  });

  const deliveryResult = await deliverEmail(outboxRow);
  const lastEmailStatus = deliveryResult.status === "sent" ? "sent" : deliveryResult.status === "failed" ? "failed" : "provider_not_configured";

  const updated = await updateQuoteRow(req.params.id, {
    email_outbox_id: outboxRow.id,
    last_email_status: lastEmailStatus,
    ...(deliveryResult.status === "sent" ? { status: "sent" } : {}),
  });

  return res.status(200).json({
    success: true,
    status: lastEmailStatus,
    outboxId: outboxRow.id,
    quote: updated,
    message: deliveryResult.message || `Quote email ${deliveryResult.status}.`,
  });
};

export const downloadQuotePdf = async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid quote id." });
  const quote = await findQuoteById(req.params.id);
  if (!quote) return res.status(404).json({ success: false, message: "Quote not found." });

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const filename = `${quote.quote_number || "quote"}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(22).text("Tuwa Commerce", { align: "left" });
  doc.moveDown(0.4);
  doc.fontSize(16).text(`Quote ${quote.quote_number}`);
  doc.moveDown();
  doc.fontSize(10).text(`Customer: ${quote.customer_name || quote.lead?.name || "Not provided"}`);
  doc.text(`Email: ${quote.customer_email || quote.lead?.email || "Not provided"}`);
  doc.text(`Project: ${quote.project || quote.lead?.project_type || "Custom Tuwa project"}`);
  if (quote.valid_until) doc.text(`Valid until: ${new Date(quote.valid_until).toDateString()}`);
  doc.moveDown();

  doc.fontSize(12).text("Items", { underline: true });
  doc.moveDown(0.5);
  quote.items.forEach((item) => {
    doc.fontSize(10).text(`${item.quantity} x ${item.name} @ ${money(item.unitPrice)} = ${money(item.total)}`);
    if (item.description) doc.fontSize(9).fillColor("#555555").text(item.description).fillColor("#000000");
  });

  doc.moveDown();
  doc.fontSize(11).text(`Subtotal: ${money(quote.subtotal)}`, { align: "right" });
  doc.text(`Discount: ${money(quote.discount)}`, { align: "right" });
  doc.text(`Tax: ${money(quote.tax)}`, { align: "right" });
  doc.fontSize(14).text(`Total: ${money(quote.total)}`, { align: "right" });
  if (quote.notes) {
    doc.moveDown();
    doc.fontSize(11).text("Notes", { underline: true });
    doc.fontSize(10).text(quote.notes);
  }

  doc.end();
};
