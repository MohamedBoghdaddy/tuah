import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { findUserById } from "../models-pg/users.js";
import { findEmployeeById } from "../models-pg/employees.js";
import { can, EMPLOYEE_ROLE_MAP } from "../utils/permissions.js";
import { isSupabaseConfigured } from "../config/supabase.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "tuah-demo-jwt-secret";

const ADMIN_ROLES = ["admin", "super_admin"];
const STAFF_ROLES = ["admin", "super_admin", "manager", "HR", "accountant", "operations", "designer", "employee"];

const getTokenFromRequest = (req) => {
  const authHeader = req.header("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return req.cookies?.token || headerToken;
};

const requireDatabase = (res) => {
  if (isSupabaseConfigured()) return true;

  res.status(503).json({
    success: false,
    message: "Authentication database is unavailable. Please try again later.",
  });
  return false;
};

// Resolves the actor (User or Employee row) from a JWT token.
// Sets req.user (users row) or req.employee (employees row) + req.actor (either).
const resolveActor = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) return { error: 401, message: "Access denied. No token provided." };

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return { error: 401, message: "Invalid or expired token." };
  }

  // actorType is signed into every token issued going forward (usercontroller.js).
  // Tokens signed before this migration have no actorType — fall back to trying
  // both tables so existing sessions don't get logged out mid-rollout.
  const actorType = decoded.actorType;

  if (actorType === "employee") {
    const employee = await findEmployeeById(decoded.id);
    if (!employee) return { error: 401, message: "Invalid authentication." };
    req.employee = employee;
    req.actor = employee;
    return { ok: true };
  }

  if (actorType === "user") {
    const user = await findUserById(decoded.id);
    if (!user) return { error: 401, message: "Invalid authentication." };
    req.user = user;
    req.actor = user;
    return { ok: true };
  }

  // Legacy token (no actorType) — try User first, then Employee.
  const user = await findUserById(decoded.id);
  if (user) {
    req.user = user;
    req.actor = user;
    return { ok: true };
  }

  const employee = await findEmployeeById(decoded.id);
  if (employee) {
    req.employee = employee;
    req.actor = employee;
    return { ok: true };
  }

  return { error: 401, message: "Invalid authentication." };
};

// ── Middleware: any authenticated user (User OR Employee) ──────────────────
export const isAuthenticated = async (req, res, next) => {
  try {
    if (!requireDatabase(res)) return;
    const result = await resolveActor(req);
    if (result.error) {
      return res.status(result.error).json({ success: false, message: result.message });
    }
    next();
  } catch {
    res.status(401).json({ success: false, message: "Unauthorized access." });
  }
};

// ── Middleware: User model only ────────────────────────────────────────────
export const verifyUser = async (req, res, next) => {
  try {
    if (!requireDatabase(res)) return;
    const result = await resolveActor(req);
    if (result.error) {
      return res.status(result.error).json({ success: false, message: result.message });
    }
    if (!req.user) {
      return res.status(403).json({ success: false, message: "Access forbidden. Users only." });
    }
    next();
  } catch {
    res.status(403).json({ success: false, message: "Forbidden access." });
  }
};

// ── Middleware: admin or any staff employee ────────────────────────────────
export const verifyAdminOrEmployee = async (req, res, next) => {
  try {
    if (!requireDatabase(res)) return;
    const result = await resolveActor(req);
    if (result.error) {
      return res.status(result.error).json({ success: false, message: result.message });
    }

    const actor = req.actor;
    if (!actor) {
      return res.status(403).json({ success: false, message: "Access forbidden." });
    }

    // User model: admin/super_admin or staff roles
    if (req.user) {
      if ([...ADMIN_ROLES, ...STAFF_ROLES].includes(actor.role)) return next();
      return res.status(403).json({ success: false, message: "Access forbidden. Admins and employees only." });
    }

    // Employee model: any role
    if (req.employee) return next();

    return res.status(403).json({ success: false, message: "Access forbidden. Admins and employees only." });
  } catch {
    res.status(403).json({ success: false, message: "Forbidden." });
  }
};

// ── Middleware: admin/super_admin only ─────────────────────────────────────
export const verifyAdmin = async (req, res, next) => {
  try {
    if (!requireDatabase(res)) return;
    const result = await resolveActor(req);
    if (result.error) {
      return res.status(result.error).json({ success: false, message: result.message });
    }

    const actor = req.actor;
    if (actor && (ADMIN_ROLES.includes(actor.role))) return next();

    return res.status(403).json({ success: false, message: "Access forbidden. Admins only." });
  } catch {
    return res.status(403).json({ success: false, message: "Forbidden." });
  }
};

// ── Middleware factory: require a specific permission ──────────────────────
// Usage: router.get("/route", isAuthenticated, requirePermission("products.create"), handler)
export const requirePermission = (permission) => async (req, res, next) => {
  try {
    const actor = req.actor || req.user || req.employee;
    if (!actor) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    if (can(actor, permission, { isEmployee: Boolean(req.employee) })) return next();

    return res.status(403).json({
      success: false,
      message: `Forbidden. Required permission: ${permission}`,
    });
  } catch {
    return res.status(403).json({ success: false, message: "Forbidden." });
  }
};

// ── Middleware factory: require one of several roles ───────────────────────
// Usage: router.get("/route", isAuthenticated, requireRole("HR", "admin"), handler)
export const requireRole = (...roles) => async (req, res, next) => {
  try {
    const actor = req.actor || req.user || req.employee;
    if (!actor) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    if (roles.includes(actor.role)) return next();

    return res.status(403).json({
      success: false,
      message: `Forbidden. Required role: ${roles.join(" or ")}.`,
    });
  } catch {
    return res.status(403).json({ success: false, message: "Forbidden." });
  }
};

// Exported for callers that need the raw role-mapping (e.g. controllers
// building an actor's public profile from either table).
export { EMPLOYEE_ROLE_MAP };
