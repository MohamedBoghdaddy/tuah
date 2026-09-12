/**
 * resolveEmployee(actor) → Employee row or null
 *
 * The actor may be a `users` row (req.user) or an `employees` row (req.employee),
 * both from Postgres. This helper returns the canonical Employee record needed
 * to look up AttendanceRecord / LeaveRequest rows, which are all keyed to
 * employees.id.
 *
 * Resolution order:
 *  1. If actor IS an employees row → return it directly.
 *  2. If actor is a user with actor.employee_id → load that Employee.
 *  3. Search employees table by matching email.
 *  4. Return null (no linked employee record exists).
 */

import { findEmployeeById, findEmployeeByEmail } from "../models-pg/employees.js";
import { updateUser } from "../models-pg/users.js";
import { supabaseAdmin } from "../config/supabase.js";

export const resolveEmployee = async (actor) => {
  if (!actor) return null;

  // Actor is already an employees row (has an fname field)
  if (actor.fname !== undefined) return actor;

  // Actor is a user — check the employee_id link first (fastest path)
  if (actor.employee_id) {
    const emp = await findEmployeeById(actor.employee_id);
    if (emp) return emp;
  }

  // Fallback: match by email (covers cases where link is not yet set)
  if (actor.email) {
    const emp = await findEmployeeByEmail(actor.email);
    if (emp) {
      // Opportunistically persist the link on the user record (fire-and-forget)
      if (actor.id && !actor.employee_id) {
        try {
          await updateUser(actor.id, { employee_id: emp.id });
          await supabaseAdmin.from("employees").update({ user_id: actor.id }).eq("id", emp.id);
        } catch {}
      }
      return emp;
    }
  }

  return null;
};
