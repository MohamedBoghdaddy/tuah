import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { performance } from "node:perf_hooks";
import {
  isUsersDbReady,
  findUserByEmailOrUsername,
  findUserByEmail,
  findUserById,
  listUsers,
  searchUsersByUsername,
  createUser,
  updateUser as updateUserRow,
  deleteUser as deleteUserRow,
  verifyUserPassword,
} from "../models-pg/users.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JWT_SECRET = process.env.JWT_SECRET || "tuah-demo-jwt-secret";
const isProduction = process.env.NODE_ENV === "production";
const DEBUG_AUTH_TIMING = process.env.DEBUG_AUTH_TIMING === "true";
const USER_ROLES = ["customer", "employee", "admin"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const startAuthTimer = (label) => {
  if (!DEBUG_AUTH_TIMING) return () => {};
  const startedAt = performance.now();
  return () => {
    const elapsedMs = performance.now() - startedAt;
    console.info(`${label}: ${elapsedMs.toFixed(1)}ms`);
  };
};

const requireAuthDatabase = (res) => {
  if (isUsersDbReady()) return true;

  res.status(503).json({
    success: false,
    message: "Authentication database is unavailable. Please try again later.",
  });
  return false;
};

const toPublicUser = (user) => ({
  _id: user.id,
  id: user.id,
  name:
    [user.first_name, user.middle_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || user.username,
  username: user.username,
  email: user.email,
  role: user.role,
  gender: user.gender,
  firstName: user.first_name,
  middleName: user.middle_name,
  lastName: user.last_name,
  department: user.department,
  receiveNotifications: user.receive_notifications,
  profilePhoto: user.profile_photo,
  profilePhotoUrl: user.profile_photo_url,
  profilePhotoAssetId: user.profile_photo_asset_id,
  jobTitle: user.job_title,
  seniorityLevel: user.seniority_level,
  phone: user.phone,
  status: user.status,
  invitedAt: user.invited_at,
  invitationEmailStatus: user.invitation_email_status,
  invitationEmailOutboxId: user.invitation_email_outbox_id,
  employeeId: user.employee_id || null,
  managerId: user.manager_id || null,
  permissions: user.permissions || [],
  deniedPermissions: user.denied_permissions || [],
  createdAt: user.created_at,
  updatedAt: user.updated_at,
});

const getTokenFromRequest = (req) => {
  const authHeader = req.header("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return req.cookies?.token || headerToken;
};

const getRequestedUserId = (req) => req.params.id || req.params.userId;

const isValidUserId = (id) => typeof id === "string" && UUID_RE.test(id);

const createToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, actorType: "user" }, JWT_SECRET, { expiresIn: "30d" });

const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 1000 * 60 * 60 * 24 * 30,
};

const setAuthCookie = (res, token) => {
  res.cookie("token", token, authCookieOptions);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

export const upload = multer({ storage });

export const registerUser = async (req, res) => {
  const {
    username,
    email,
    password,
    firstName,
    middleName,
    lastName,
    gender,
  } = req.body;

  if (!username || !email || !password || !firstName || !lastName || !gender) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (!requireAuthDatabase(res)) return;

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim();
    const existingUser = await findUserByEmailOrUsername({
      email: normalizedEmail,
      username: normalizedUsername,
    });
    if (existingUser) {
      const message =
        existingUser.email === normalizedEmail
          ? "Email already in use"
          : "Username already in use";
      return res.status(400).json({ message });
    }

    const user = await createUser({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      gender,
    });

    const token = createToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const loginUser = async (req, res) => {
  const endTotalTimer = startAuthTimer("login-total");
  res.on("finish", endTotalTimer);

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  if (!requireAuthDatabase(res)) return;

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    let user;
    const endFindTimer = startAuthTimer("login-db-user-find");
    try {
      user = await findUserByEmail(normalizedEmail);
    } finally {
      endFindTimer();
    }
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    let isMatch;
    const endBcryptTimer = startAuthTimer("login-bcrypt-compare");
    try {
      isMatch = await verifyUserPassword(user, password);
    } finally {
      endBcryptTimer();
    }
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const endJwtTimer = startAuthTimer("login-jwt-sign");
    const token = createToken(user);
    endJwtTimer();
    setAuthCookie(res, token);
    res.status(200).json({ token, user: toPublicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const logoutUser = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    });
    res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Logout failed" });
  }
};

export const getAllUsers = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const users = await listUsers();
    res.status(200).json(users.map(toPublicUser));
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const getUser = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  const userId = getRequestedUserId(req);
  if (!isValidUserId(userId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid user id",
    });
  }

  try {
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({ success: true, user: toPublicUser(user) });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Maps the camelCase fields this API has always accepted in req.body to the
// snake_case columns in Postgres. Unknown keys are dropped rather than passed
// through, since Postgres (unlike Mongoose) has no schema-less passthrough.
const USER_UPDATE_FIELD_MAP = {
  username: "username",
  email: "email",
  password: "password",
  gender: "gender",
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  role: "role",
  permissions: "permissions",
  deniedPermissions: "denied_permissions",
  department: "department",
  managerId: "manager_id",
  employeeId: "employee_id",
  level: "level",
  receiveNotifications: "receive_notifications",
  profilePhoto: "profile_photo",
  profilePhotoUrl: "profile_photo_url",
  profilePhotoAssetId: "profile_photo_asset_id",
  jobTitle: "job_title",
  seniorityLevel: "seniority_level",
  phone: "phone",
  status: "status",
};

const toUserUpdatePayload = (body) => {
  const payload = {};
  Object.entries(USER_UPDATE_FIELD_MAP).forEach(([bodyKey, column]) => {
    if (body[bodyKey] !== undefined) payload[column] = body[bodyKey];
  });
  return payload;
};

export const updateUser = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const userId = getRequestedUserId(req);
    if (!isValidUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const updates = toUserUpdatePayload(req.body);
    if (req.file) {
      updates.profile_photo = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await updateUserRow(userId, updates);
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res
      .status(200)
      .json({
        message: "User updated successfully",
        user: toPublicUser(updatedUser),
      });
  } catch (error) {
    console.error("Error updating user:", error);
    if (error.code === "23505") {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteUser = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const userId = getRequestedUserId(req);
    if (!isValidUserId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await deleteUserRow(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const searchUsers = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    const users = await searchUsersByUsername(username);
    if (!users.length) {
      return res.status(404).json({ message: "No users found" });
    }
    res.status(200).json(users.map(toPublicUser));
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const checkAuth = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(decoded.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ user: toPublicUser(user) });
  } catch (error) {
    res.status(401).json({ message: "Not authenticated" });
  }
};

export const getUsersByRole = async (req, res) => {
  if (!requireAuthDatabase(res)) return;

  try {
    const { role } = req.query;
    if (role && !USER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified",
      });
    }

    const users = await listUsers({ role });

    res.status(200).json({ success: true, users: users.map(toPublicUser) });
  } catch (error) {
    console.error("Error fetching users by role:", error);
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};
