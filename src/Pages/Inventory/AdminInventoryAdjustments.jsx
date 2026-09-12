import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable, DetailDrawer, FormSection } from "../../Components/ui";
import { useAuthContext } from "../../context/AuthContext";
import { can } from "../../utils/permissions";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";
import { ADJUSTMENT_REASONS, formatEnumLabel } from "./inventoryConstants";

const EMPTY_FORM = { productId: "", locationId: "", quantityDelta: "", reason: "cycle_count", note: "" };

const AdminInventoryAdjustments = () => {
  const { state } = useAuthContext();
  const canAdjust = can(state.user, "inventory.adjust");
  const { products, locations, warehouseName } = useInventoryLookups();

  const [adjustments, setAdjustments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState({ msg: "", type: "info" });
  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "info" }), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { adjustments: rows } = await inventoryApi.getAdjustments({ limit: 200 });
      setAdjustments(rows);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load adjustments.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.createAdjustment({ ...form, quantityDelta: Number(form.quantityDelta) });
      showToast("Adjustment applied.", "ok");
      setFormOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      showToast(err.message || "Adjustment failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell active="Adjustments" title="Stock Adjustments" subtitle="Manual corrections for damage, scrap, and cycle counts — always audited.">
      {toast.msg && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.msg}</div>}

      <DataTable
        title="Adjustment History"
        loading={loading}
        error={error}
        onRetry={load}
        rows={adjustments}
        rowKey={(a) => a.id}
        searchFn={(a, q) => (a.product?.name || "").toLowerCase().includes(q.toLowerCase())}
        emptyTitle="No adjustments yet"
        emptyDescription="Every manual stock correction will appear here with a full before/after audit trail."
        toolbarActions={
          canAdjust && (
            <button className="admin-premium-button primary" type="button" onClick={() => setFormOpen(true)}>
              <span className="material-symbols-outlined">add</span>
              New Adjustment
            </button>
          )
        }
        columns={[
          { key: "product", header: "Product", render: (a) => a.product?.name || a.productId },
          { key: "delta", header: "Delta", render: (a) => (
            <strong style={{ color: a.quantityDelta > 0 ? "#15803d" : "#991b1b" }}>{a.quantityDelta > 0 ? "+" : ""}{a.quantityDelta}</strong>
          ) },
          { key: "before", header: "Before", render: (a) => a.quantityBefore },
          { key: "after", header: "After", render: (a) => a.quantityAfter },
          { key: "reason", header: "Reason", render: (a) => formatEnumLabel(a.reason) },
          { key: "note", header: "Note", render: (a) => a.note || "—" },
          { key: "when", header: "When", sortable: true, render: (a) => new Date(a.createdAt).toLocaleString() },
        ]}
      />

      <DetailDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New Stock Adjustment"
        actions={
          <>
            <button type="button" className="admin-premium-button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" form="adjustment-form" className="admin-premium-button primary" disabled={saving}>
              {saving ? "Applying…" : "Apply Adjustment"}
            </button>
          </>
        }
      >
        <form id="adjustment-form" onSubmit={handleSubmit}>
          <FormSection>
            <div className="admin-field">
              <label htmlFor="adj-product">Product *</label>
              <select id="adj-product" required value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
                <option value="">Select…</option>
                {products.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="adj-location">Location *</label>
              <select id="adj-location" required value={form.locationId} onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}>
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {warehouseName(l.warehouseId)}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="adj-delta">Quantity Change *</label>
              <input
                id="adj-delta" type="number" required placeholder="e.g. -3 or 10"
                value={form.quantityDelta} onChange={(e) => setForm((f) => ({ ...f, quantityDelta: e.target.value }))}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="adj-reason">Reason *</label>
              <select id="adj-reason" required value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>
                {ADJUSTMENT_REASONS.map((r) => <option key={r} value={r}>{formatEnumLabel(r)}</option>)}
              </select>
            </div>
          </FormSection>
          <div className="admin-field">
            <label htmlFor="adj-note">Note *</label>
            <textarea id="adj-note" required rows={3} placeholder="Why is this stock changing?" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
        </form>
      </DetailDrawer>
    </AdminShell>
  );
};

export default AdminInventoryAdjustments;
