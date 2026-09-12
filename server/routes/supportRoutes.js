import express from "express";
import {
  createSupportInquiry,
  listSupportInquiries,
  SUPPORT_TYPES,
  INQUIRY_SOURCES,
} from "../models-pg/support.js";
import { verifyAdmin } from "../middleware/AuthMiddleware.js";

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanString = (value, maxLength = 5000) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const createTicketNumber = () =>
  `TU-SUP-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

const toPublicInquiry = (inquiry) => ({
  _id: inquiry.id,
  id: inquiry.id,
  ticketNumber: inquiry.ticket_number,
  name: inquiry.name,
  email: inquiry.email,
  phone: inquiry.phone || "",
  type: inquiry.type,
  orderNumber: inquiry.order_number || "",
  message: inquiry.message,
  status: inquiry.status,
  source: inquiry.source,
  metadata: inquiry.metadata || {},
  createdAt: inquiry.created_at,
  updatedAt: inquiry.updated_at,
});

router.post("/", async (req, res, next) => {
  try {
    const name = cleanString(req.body.name, 160);
    const email = cleanString(req.body.email, 254).toLowerCase();
    const phone = cleanString(req.body.phone, 80);
    const type = cleanString(req.body.type, 80);
    const orderNumber = cleanString(req.body.orderNumber, 80);
    const message = cleanString(req.body.message, 5000);
    const source = cleanString(req.body.source, 80) || "support_portal";
    const metadata =
      req.body.metadata && typeof req.body.metadata === "object"
        ? req.body.metadata
        : {};

    const errors = {};
    if (!name) errors.name = "Full name is required.";
    if (!email) errors.email = "Email is required.";
    else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
    if (!type) errors.type = "Support type is required.";
    else if (!SUPPORT_TYPES.includes(type)) errors.type = "Choose a valid support type.";
    if (!message) errors.message = "Message is required.";
    if (!INQUIRY_SOURCES.includes(source)) errors.source = "Choose a valid inquiry source.";

    if (Object.keys(errors).length) {
      return res.status(400).json({
        success: false,
        message: "Please correct the highlighted fields.",
        errors,
      });
    }

    const inquiry = await createSupportInquiry({
      ticket_number: createTicketNumber(),
      name,
      email,
      phone,
      type,
      order_number: orderNumber,
      message,
      source,
      metadata,
    });

    return res.status(201).json({
      success: true,
      message: "Support request received.",
      inquiry: toPublicInquiry(inquiry),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin", verifyAdmin, async (req, res, next) => {
  try {
    const { status, type, source, page = 1, limit = 50 } = req.query;
    const { inquiries, total, page: safePage, limit: safeLimit } = await listSupportInquiries({
      status, type, source, page, limit,
    });

    return res.json({
      success: true,
      inquiries: inquiries.map(toPublicInquiry),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
