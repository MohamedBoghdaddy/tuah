import { updateUser as updateUserRow } from "../models-pg/users.js";
import {
  findEmployeeById,
  updateEmployee as updateEmployeeRow,
  createEmployee as createEmployeeRow,
} from "../models-pg/employees.js";
import {
  findProductById,
  updateProduct as updateProductRow,
  addGalleryImages,
} from "../models-pg/products.js";
import {
  uploadBufferToSupabase,
  deleteSupabaseFile,
  saveImageAssetMetadata,
  buildStoragePath,
} from "../services/supabaseStorageService.js";
import { isSupabaseConfigured } from "../config/supabase.js";
import { queueEmail } from "../services/emailOutboxService.js";
import { deliverEmail } from "../services/emailDeliveryService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────────

const supabaseMissing = (res) =>
  res.status(503).json({ success: false, message: "Supabase storage is not configured." });

const invalidId = (res) =>
  res.status(400).json({ success: false, message: "Invalid ID format." });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (id) => typeof id === "string" && UUID_RE.test(id);

const getBucketEnv = (type) => {
  const map = {
    product: process.env.SUPABASE_PRODUCT_IMAGES_BUCKET || "product-images",
    user: process.env.SUPABASE_PROFILE_IMAGES_BUCKET || "profile-images",
    employee: process.env.SUPABASE_EMPLOYEE_IMAGES_BUCKET || "employee-images",
  };
  return map[type];
};

// ─── POST /api/admin/products/:productId/image ────────────────────────────────────

export const uploadProductImage = async (req, res) => {
  if (!isSupabaseConfigured()) return supabaseMissing(res);

  const { productId } = req.params;
  if (!isValidUuid(productId)) return invalidId(res);

  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file provided." });
  }

  const product = await findProductById(productId);
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found." });
  }

  const bucket = getBucketEnv("product");
  const storagePath = buildStoragePath("product", productId, req.file.originalname);
  let uploadResult;

  try {
    uploadResult = await uploadBufferToSupabase({
      bucket,
      path: storagePath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }

  const assetRow = await saveImageAssetMetadata({
    mongoOwnerId: req.employee?.id || req.user?.id,
    relatedEntityType: "product",
    relatedEntityId: productId,
    bucket,
    filePath: uploadResult.path,
    publicUrl: uploadResult.publicUrl,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  // imageAssetId: prefer Supabase metadata row id, fall back to the storage path itself
  // (storage path is globally unique within the bucket and serves as a stable asset ref)
  const imageAssetId = assetRow?.id || `${bucket}:${uploadResult.path}`;

  let updatedProduct;
  try {
    updatedProduct = await updateProductRow(productId, {
      image_url: uploadResult.publicUrl,
      image_asset_id: imageAssetId,
    });
  } catch (saveErr) {
    await deleteSupabaseFile({ bucket, path: uploadResult.path }).catch(() => {});
    return res
      .status(500)
      .json({ success: false, message: "Image uploaded but failed to update product. Upload rolled back." });
  }

  return res.status(200).json({ success: true, product: updatedProduct, imageUrl: uploadResult.publicUrl, imageAssetId });
};

// ─── POST /api/admin/products/:productId/gallery ──────────────────────────────────

export const uploadProductGallery = async (req, res) => {
  if (!isSupabaseConfigured()) return supabaseMissing(res);

  const { productId } = req.params;
  if (!isValidUuid(productId)) return invalidId(res);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No image files provided." });
  }

  const product = await findProductById(productId);
  if (!product) return res.status(404).json({ success: false, message: "Product not found." });

  const bucket = getBucketEnv("product");
  const uploaded = [];

  for (const file of req.files) {
    try {
      const storagePath = buildStoragePath("product", productId, file.originalname);
      const result = await uploadBufferToSupabase({
        bucket,
        path: storagePath,
        buffer: file.buffer,
        contentType: file.mimetype,
      });

      const asset = await saveImageAssetMetadata({
        relatedEntityType: "product",
        relatedEntityId: productId,
        bucket,
        filePath: result.path,
        publicUrl: result.publicUrl,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });

      uploaded.push({ url: result.publicUrl, assetId: asset?.id || `${bucket}:${result.path}` });
    } catch (err) {
      console.warn(`Gallery upload skipped for ${file.originalname}: ${err.message}`);
    }
  }

  if (uploaded.length === 0) {
    return res.status(500).json({ success: false, message: "All gallery uploads failed." });
  }

  const updatedProduct = await addGalleryImages(productId, uploaded);

  return res.status(200).json({ success: true, product: updatedProduct, uploaded });
};

// ─── POST /api/users/me/profile-photo ────────────────────────────────────────────

export const uploadUserProfilePhoto = async (req, res) => {
  if (!isSupabaseConfigured()) return supabaseMissing(res);

  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file provided." });
  }

  const userId = req.user.id;
  const bucket = getBucketEnv("user");
  const storagePath = buildStoragePath("user", userId, req.file.originalname);

  let uploadResult;
  try {
    uploadResult = await uploadBufferToSupabase({
      bucket,
      path: storagePath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }

  const assetRow = await saveImageAssetMetadata({
    mongoOwnerId: userId,
    relatedEntityType: "user",
    relatedEntityId: userId,
    bucket,
    filePath: uploadResult.path,
    publicUrl: uploadResult.publicUrl,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  try {
    const user = await updateUserRow(userId, {
      profile_photo_url: uploadResult.publicUrl,
      profile_photo_asset_id: assetRow?.id || `${bucket}:${uploadResult.path}`,
    });

    return res.status(200).json({ success: true, user, photoUrl: uploadResult.publicUrl });
  } catch (saveErr) {
    await deleteSupabaseFile({ bucket, path: uploadResult.path }).catch(() => {});
    return res.status(500).json({
      success: false,
      message: "Photo uploaded but failed to update user. Upload rolled back.",
    });
  }
};

// ─── POST /api/admin/employees/:employeeId/profile-photo ─────────────────────────

export const uploadEmployeeProfilePhoto = async (req, res) => {
  if (!isSupabaseConfigured()) return supabaseMissing(res);

  const { employeeId } = req.params;
  if (!isValidUuid(employeeId)) return invalidId(res);

  if (!req.file) {
    return res.status(400).json({ success: false, message: "No image file provided." });
  }

  const employee = await findEmployeeById(employeeId);
  if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

  const bucket = getBucketEnv("employee");
  const storagePath = buildStoragePath("employee", employeeId, req.file.originalname);

  let uploadResult;
  try {
    uploadResult = await uploadBufferToSupabase({
      bucket,
      path: storagePath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }

  const assetRow = await saveImageAssetMetadata({
    mongoOwnerId: employeeId,
    relatedEntityType: "employee",
    relatedEntityId: employeeId,
    bucket,
    filePath: uploadResult.path,
    publicUrl: uploadResult.publicUrl,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  try {
    const updatedEmployee = await updateEmployeeRow(employeeId, {
      profile_photo_url: uploadResult.publicUrl,
      profile_photo_asset_id: assetRow?.id || `${bucket}:${uploadResult.path}`,
    });
    return res.status(200).json({ success: true, employee: updatedEmployee, photoUrl: uploadResult.publicUrl });
  } catch (saveErr) {
    await deleteSupabaseFile({ bucket, path: uploadResult.path }).catch(() => {});
    return res.status(500).json({
      success: false,
      message: "Photo uploaded but failed to update employee. Upload rolled back.",
    });
  }
};

// ─── POST /api/admin/employees/:employeeId/send-invite ────────────────────────────
// Uses Supabase Auth Admin inviteUserByEmail as the primary invite mechanism.
// Falls back to email outbox if Supabase Auth is unavailable.

export const sendEmployeeInvite = async (req, res) => {
  const { employeeId } = req.params;
  if (!isValidUuid(employeeId)) return invalidId(res);

  const employee = await findEmployeeById(employeeId);
  if (!employee) return res.status(404).json({ success: false, message: "Employee not found." });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const redirectTo = `${frontendUrl}/accept-invite`;

  // ── Primary: Supabase Auth Admin invite ─────────────────────────────────────
  if (isSupabaseConfigured()) {
    const { supabaseAdmin: sb } = await import("../config/supabase.js");

    if (sb?.auth?.admin) {
      const { data: authData, error: authError } = await sb.auth.admin.inviteUserByEmail(
        employee.email,
        {
          redirectTo,
          data: {
            employeeId: employee.id,
            role: employee.role,
            department: employee.department,
            jobTitle: employee.job_title || "",
          },
        }
      );

      if (authError) {
        // Supabase Auth failed — fall through to email outbox fallback.
        console.warn(`Supabase Auth invite failed for ${employee.email}: ${authError.message}. Falling back to email outbox.`);
        // intentional fall-through (no return)
      } else {
        // Supabase Auth invite sent successfully — store supabase user id and return.
        const updated = await updateEmployeeRow(employee.id, {
          invitation_email_status: "sent",
          invited_at: new Date().toISOString(),
          ...(authData?.user?.id ? { supabase_auth_user_id: authData.user.id } : {}),
        });

        return res.status(200).json({
          success: true,
          status: "sent",
          message: "Invitation email sent via Supabase Auth.",
          inviteMethod: "supabase_auth",
          employee: {
            _id: updated.id,
            email: updated.email,
            invitationEmailStatus: "sent",
            supabaseAuthUserId: updated.supabase_auth_user_id || null,
          },
        });
      }
    }
  }

  // ── Fallback: email outbox ───────────────────────────────────────────────────
  const inviteUrl = `${redirectTo}?employeeId=${employeeId}`;
  const outboxRow = await queueEmail({
    toEmail: employee.email,
    toName: `${employee.fname} ${employee.lname}`,
    subject: "You have been invited to join Tuwa Commerce",
    bodyHtml: `<h2>Welcome to Tuwa Commerce</h2><p>Hi ${employee.fname},</p><p>You have been invited as <strong>${employee.role}</strong> in <strong>${employee.department}</strong>.</p><p><a href="${inviteUrl}">Accept Invitation</a></p>`,
    bodyText: `Hi ${employee.fname}, you have been invited to join Tuwa Commerce as ${employee.role} in ${employee.department}. Accept at: ${inviteUrl}`,
    templateKey: "employee_invite",
    templateVariables: { name: employee.fname, role: employee.role, department: employee.department, inviteUrl },
    relatedEntityType: "employee",
    relatedEntityId: employeeId,
  });

  const deliveryResult = await deliverEmail(outboxRow);
  const invStatusMap = { sent: "sent", failed: "failed", queued: "provider_not_configured" };
  const invStatus = invStatusMap[deliveryResult.status] || "queued";

  const updated = await updateEmployeeRow(employee.id, {
    invitation_email_status: invStatus,
    invitation_email_outbox_id: outboxRow.id,
    invited_at: new Date().toISOString(),
  });

  return res.status(200).json({
    success: true,
    status: invStatus,
    message: deliveryResult.message || `Email ${deliveryResult.status}.`,
    inviteMethod: "email_outbox",
    outboxId: outboxRow.id,
    inviteUrl: invStatus === "provider_not_configured" ? inviteUrl : undefined,
    employee: { _id: updated.id, email: updated.email, invitationEmailStatus: invStatus },
  });
};

// ─── POST /api/admin/employees/invite (create + invite in one step) ───────────────
// Body: { fname, lname, email, department, role, jobTitle }
// Uses Supabase Auth Admin inviteUserByEmail as the primary invite mechanism.

export const createAndInviteEmployee = async (req, res) => {
  const { fname, lname, email, department, role = "readonly", jobTitle } = req.body;

  if (!fname || !lname || !email || !department) {
    return res.status(400).json({ success: false, message: "fname, lname, email, and department are required." });
  }

  const crypto = (await import("crypto")).default;
  const tempPassword = crypto.randomBytes(16).toString("hex");

  let employee;
  try {
    employee = await createEmployeeRow({
      fname, lname, email, department, role,
      job_title: jobTitle || "",
      password: tempPassword,
    });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ success: false, message: "An employee with this email already exists." });
    return res.status(500).json({ success: false, message: `Failed to create employee: ${err.message}` });
  }

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const redirectTo = `${frontendUrl}/accept-invite`;

  // ── Primary: Supabase Auth Admin invite ─────────────────────────────────────
  if (isSupabaseConfigured()) {
    const { supabaseAdmin: sb } = await import("../config/supabase.js");

    if (sb?.auth?.admin) {
      const { data: authData, error: authError } = await sb.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo,
          data: {
            employeeId: employee.id,
            role,
            department,
            jobTitle: jobTitle || "",
          },
        }
      );

      if (!authError) {
        const updated = await updateEmployeeRow(employee.id, {
          invitation_email_status: "sent",
          invited_at: new Date().toISOString(),
          ...(authData?.user?.id ? { supabase_auth_user_id: authData.user.id } : {}),
        });

        return res.status(201).json({
          success: true,
          status: "sent",
          message: "Invitation email sent via Supabase Auth.",
          inviteMethod: "supabase_auth",
          employee: {
            _id: updated.id, fname, lname, email, department, role,
            invitationEmailStatus: "sent",
            supabaseAuthUserId: updated.supabase_auth_user_id || null,
          },
        });
      }

      console.warn(`Supabase Auth invite failed for ${email}: ${authError.message}. Falling back to email outbox.`);
    }
  }

  // ── Fallback: email outbox ───────────────────────────────────────────────────
  const inviteUrl = `${redirectTo}?employeeId=${employee.id}`;
  const outboxRow = await queueEmail({
    toEmail: email,
    toName: `${fname} ${lname}`,
    subject: "You have been invited to join Tuwa Commerce",
    bodyHtml: `<h2>Welcome to Tuwa Commerce</h2><p>Hi ${fname},</p><p>You have been invited as <strong>${role}</strong> in <strong>${department}</strong>.</p><p><a href="${inviteUrl}">Accept Invitation</a></p>`,
    bodyText: `Hi ${fname}, you have been invited to join Tuwa Commerce as ${role} in ${department}. Accept at: ${inviteUrl}`,
    templateKey: "employee_invite",
    templateVariables: { name: fname, role, department, inviteUrl },
    relatedEntityType: "employee",
    relatedEntityId: employee.id,
  });

  const deliveryResult = await deliverEmail(outboxRow);
  const invStatusMap = { sent: "sent", failed: "failed", queued: "provider_not_configured" };
  const invStatus = invStatusMap[deliveryResult.status] || "queued";

  const updated = await updateEmployeeRow(employee.id, {
    invitation_email_status: invStatus,
    invitation_email_outbox_id: outboxRow.id,
    invited_at: new Date().toISOString(),
  });

  return res.status(201).json({
    success: true,
    status: invStatus,
    message: deliveryResult.message || `Invitation ${deliveryResult.status}.`,
    inviteMethod: "email_outbox",
    outboxId: outboxRow.id,
    inviteUrl: invStatus === "provider_not_configured" ? inviteUrl : undefined,
    employee: { _id: updated.id, fname, lname, email, department, role, invitationEmailStatus: invStatus },
  });
};
