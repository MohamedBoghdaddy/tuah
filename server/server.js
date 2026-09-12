import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import session from "express-session";
import cookieParser from "cookie-parser";
import multer from "multer";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { isSupabaseConfigured } from "./config/supabase.js";
import { SupabaseSessionStore } from "./services/supabaseSessionStore.js";

import commerceRoutes from "./routes/commerceRoutes.js";
import productRoutes from "./routes/productsRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import erpRoutes from "./routes/erpRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import emailAdminRoutes from "./routes/emailAdminRoutes.js";
import adminProductRoutes from "./routes/adminProductRoutes.js";
import adminEmployeeRoutes from "./routes/adminEmployeeRoutes.js";
import adminLeadRoutes from "./routes/adminLeadRoutes.js";
import adminOrderRoutes from "./routes/adminOrderRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import importExportRoutes from "./routes/importExportRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 4000,
  SESSION_SECRET = "tuah-demo-session-secret",
  FRONTEND_URL,
  CORS_ORIGIN = "http://localhost:3000",
  NODE_ENV = "development",
} = process.env;

const isProduction = NODE_ENV === "production";
const app = express();
const upload = multer({ dest: path.join(__dirname, "uploads") });

// CORS_ORIGIN / FRONTEND_URL may each be a single origin or a comma-separated
// list (e.g. a Vercel production domain plus preview-deployment domains).
const splitOrigins = (value) => (value || "").split(",").map((o) => o.trim()).filter(Boolean);

const allowedOrigins = [
  ...splitOrigins(CORS_ORIGIN),
  ...splitOrigins(FRONTEND_URL),
  "http://localhost:3000",
  "http://localhost:3001",
  "https://tuah-cool.vercel.app",
].filter(Boolean);

const databaseUnavailablePayload = () => ({
  success: false,
  message: "Database is unavailable. Database-backed endpoints are temporarily disabled.",
});

// Every route in this app is now backed by Supabase Postgres. Checked lazily
// per-request (not cached at boot) so it reflects config added after startup
// without a restart.
const requireSupabaseConnection = (req, res, next) => {
  if (isSupabaseConfigured()) return next();
  return res.status(503).json(databaseUnavailablePayload());
};

const configureApp = () => {
  app.locals.dbAvailable = isSupabaseConfigured();
  app.locals.dbMode = isSupabaseConfigured() ? "supabase" : "demo";

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(morgan(isProduction ? "tiny" : "dev"));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("CORS policy violation"));
        }
      },
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
    }),
  );
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: isSupabaseConfigured() ? new SupabaseSessionStore() : undefined,
      cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  app.post("/upload", upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    return res.status(201).json({ file: req.file });
  });

  // ── Specific routes first (more specific path → mounted before catch-alls) ──────
  // ── Attendance & Leave ────────────────────────────────────────────────────
  app.use("/api/attendance",      requireSupabaseConnection, attendanceRoutes);
  app.use("/api/admin/attendance",requireSupabaseConnection, attendanceRoutes);
  app.use("/api/leave",           requireSupabaseConnection, leaveRoutes);
  app.use("/api/admin/leave",     requireSupabaseConnection, leaveRoutes);
  // ── Import / Export (employees/attendance/leave sheets) ────────────────────
  app.use("/api/admin/export",  requireSupabaseConnection, importExportRoutes);
  app.use("/api/admin/import",  requireSupabaseConnection, importExportRoutes);

  // ── Specific routes first (more specific path → mounted before catch-alls) ──
  app.use("/api/admin/products",  requireSupabaseConnection, adminProductRoutes);
  app.use("/api/admin/employees", requireSupabaseConnection, adminEmployeeRoutes);
  app.use("/api/admin/orders",    requireSupabaseConnection, adminOrderRoutes);
  app.use("/api/admin/dashboard", requireSupabaseConnection, analyticsRoutes);
  app.use("/api/admin/analytics", requireSupabaseConnection, analyticsRoutes);
  app.use("/api/admin/emails",    requireSupabaseConnection, emailAdminRoutes);
  app.use("/api/admin/erp",       requireSupabaseConnection, erpRoutes);
  app.use("/api/admin",           requireSupabaseConnection, adminLeadRoutes);
  app.use("/api/analytics",       analyticsRoutes);
  app.use("/api/orders",          requireSupabaseConnection, orderRoutes);
  app.use("/api/cart",            requireSupabaseConnection, cartRoutes);
  app.use("/api/wishlist",        requireSupabaseConnection, wishlistRoutes);
  app.use("/api/customer",        requireSupabaseConnection, customerRoutes);
  app.use("/api/support",         requireSupabaseConnection, supportRoutes);
  app.use("/api/products",        requireSupabaseConnection, productRoutes);
  app.use("/api/users",           userRoutes);
  app.use("/api/erp",             requireSupabaseConnection, erpRoutes);
  app.use("/api/settings",        settingsRoutes);
  // Hybrid storage routes (Supabase Storage + email outbox)
  app.use("/api", requireSupabaseConnection, uploadRoutes);
  // commerceRoutes last under /api — provides demo fallback for /collections, /cart, /checkout
  app.use("/api", commerceRoutes);

  app.get("/", (req, res) => {
    res.json({
      message: `Tuah API is running in ${app.locals.dbMode} mode`,
      database: {
        available: app.locals.dbAvailable,
        provider: "supabase",
      },
    });
  });

  app.use("/api", (req, res) => {
    res.status(404).json({
      success: false,
      message: `API route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use((err, req, res, next) => {
    console.error("Error:", err.message);
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: err.message });
  });
};

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

const bootstrap = () => {
  if (isSupabaseConfigured()) {
    console.log("Connected to Supabase Postgres.");
  } else {
    console.warn(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set. Running Tuah API with in-memory demo data. Database-backed routes will return HTTP 503.",
    );
  }

  configureApp();
  startServer();
};

bootstrap();
