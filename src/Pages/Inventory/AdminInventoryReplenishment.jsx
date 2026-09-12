import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable, DetailDrawer, FormSection, StatusBadge } from "../../Components/ui";
import { useAuthContext } from "../../context/AuthContext";
import { can } from "../../utils/permissions";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";

const EMPTY_FORM = { productId: "", warehouseId: "", minStock: 0, maxStock: "", reorderPoint: 0, reorderQty: 0, preferredSupplier: "" };

const AdminInventoryReplenishment = () => {
  const { state } = useAuthContext();
  const canManage = can(state.user, "inventory.settings.manage");
  const { products, warehouses } = useInventoryLookups();

  const [candidates, setCandidates] = useState([]);
  const [settings, setSettings] = useState([]);
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
      const [candidateRows, settingsRows] = await Promise.all([
        inventoryApi.getReplenishmentCandidates(),
        inventoryApi.getSettings(),
      ]);
      setCandidates(candidateRows);
      setSettings(settingsRows);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load replenishment data.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setForm(EMPTY_FORM); setFormOpen(true); };
  const openEdit = (row) => {
    setForm({
      productId: row.productId, warehouseId: row.warehouseId,
      minStock: row.minStock, maxStock: row.maxStock ?? "", reorderPoint: row.reorderPoint,
      reorderQty: row.reorderQty, preferredSupplier: row.preferredSupplier || "",
    });
    setFormOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.upsertSettings({ ...form, maxStock: form.maxStock === "" ? null : Number(form.maxStock) });
      showToast("Replenishment settings saved.", "ok");
      setFormOpen(false);
      await load();
    } catch (err) {
      showToast(err.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const candidateIds = new Set(candidates.map((c) => `${c.productId}:${c.warehouseId}`));

  return (
    <AdminShell active="Replenishment" title="Low Stock / Replenishment" subtitle="Reorder policy and alerts, per product and warehouse.">
      {toast.msg && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.msg}</div>}

      {candidates.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 className="admin-section-title">Needs Reordering Now</h2>
          <table className="admin-table" style={{ marginTop: 8 }}>
            <thead><tr><th>Product</th><th>Warehouse</th><th>On Hand</th><th>Reorder Point</th><th>Reorder Qty</th><th>Status</th></tr></thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td className="admin-cell-name">{c.product?.name || c.productId}</td>
                  <td>{warehouses.find((w) => w.id === c.warehouseId)?.name || c.warehouseId}</td>
                  <td>{c.onHand}</td>
                  <td>{c.reorderPoint}</td>
                  <td>{c.reorderQty}</td>
                  <td><StatusBadge status={c.onHand <= 0 ? "out_of_stock" : "low_stock"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <DataTable
        title="Replenishment Settings"
        loading={loading}
        error={error}
        onRetry={load}
        rows={settings}
        rowKey={(s) => s.id}
        searchFn={(s, q) => (s.product?.name || "").toLowerCase().includes(q.toLowerCase())}
        emptyTitle="No replenishment policies configured yet"
        emptyDescription='Click "Add Policy" to set min/max stock and reorder points for a product.'
        toolbarActions={
          canManage && (
            <button className="admin-premium-button primary" type="button" onClick={openCreate}>
              <span className="material-symbols-outlined">add</span>
              Add Policy
            </button>
          )
        }
        columns={[
          { key: "product", header: "Product", render: (s) => s.product?.name || s.productId },
          { key: "warehouse", header: "Warehouse", render: (s) => warehouses.find((w) => w.id === s.warehouseId)?.name || s.warehouseId },
          { key: "min", header: "Min", render: (s) => s.minStock },
          { key: "max", header: "Max", render: (s) => s.maxStock ?? "—" },
          { key: "reorderPoint", header: "Reorder Point", render: (s) => s.reorderPoint },
          { key: "reorderQty", header: "Reorder Qty", render: (s) => s.reorderQty },
          { key: "supplier", header: "Preferred Supplier", render: (s) => s.preferredSupplier || "—" },
          {
            key: "status",
            header: "Status",
            render: (s) => (candidateIds.has(`${s.productId}:${s.warehouseId}`) ? <StatusBadge status="low_stock" /> : <StatusBadge status="active" label="OK" />),
          },
        ]}
        rowActions={canManage ? (s) => [{ label: "Edit", onClick: () => openEdit(s) }] : undefined}
      />

      <DetailDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Replenishment Policy"
        actions={
          <>
            <button type="button" className="admin-premium-button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" form="replenishment-form" className="admin-premium-button primary" disabled={saving}>
              {saving ? "Saving…" : "Save Policy"}
            </button>
          </>
        }
      >
        <form id="replenishment-form" onSubmit={handleSubmit}>
          <FormSection>
            <div className="admin-field">
              <label htmlFor="rep-product">Product *</label>
              <select id="rep-product" required value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}>
                <option value="">Select…</option>
                {products.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="rep-warehouse">Warehouse *</label>
              <select id="rep-warehouse" required value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="rep-min">Min Stock</label>
              <input id="rep-min" type="number" min="0" value={form.minStock} onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label htmlFor="rep-max">Max Stock</label>
              <input id="rep-max" type="number" min="0" value={form.maxStock} onChange={(e) => setForm((f) => ({ ...f, maxStock: e.target.value }))} placeholder="No cap" />
            </div>
            <div className="admin-field">
              <label htmlFor="rep-point">Reorder Point</label>
              <input id="rep-point" type="number" min="0" value={form.reorderPoint} onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label htmlFor="rep-qty">Reorder Qty</label>
              <input id="rep-qty" type="number" min="0" value={form.reorderQty} onChange={(e) => setForm((f) => ({ ...f, reorderQty: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label htmlFor="rep-supplier">Preferred Supplier</label>
              <input id="rep-supplier" value={form.preferredSupplier} onChange={(e) => setForm((f) => ({ ...f, preferredSupplier: e.target.value }))} placeholder="Until the Purchasing module exists" />
            </div>
          </FormSection>
        </form>
      </DetailDrawer>
    </AdminShell>
  );
};

export default AdminInventoryReplenishment;
