import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable, DetailDrawer, FormSection, StatusBadge, ConfirmDialog } from "../../Components/ui";
import { useAuthContext } from "../../context/AuthContext";
import { can } from "../../utils/permissions";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";
import { TRANSFER_STATUS_TRANSITIONS, formatEnumLabel } from "./inventoryConstants";

const EMPTY_LINE = { productId: "", requestedQty: "" };

const AdminInventoryTransfers = () => {
  const { state } = useAuthContext();
  const canTransfer = can(state.user, "inventory.transfer");
  const { products, warehouses, locationsForWarehouse } = useInventoryLookups();

  const [transfers, setTransfers] = useState([]);
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
      const { transfers: rows } = await inventoryApi.getTransfers({ limit: 200 });
      setTransfers(rows);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load transfers.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Create form ──────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ sourceWarehouseId: "", sourceLocationId: "", destWarehouseId: "", destLocationId: "", notes: "" });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  const resetCreateForm = () => {
    setCreateForm({ sourceWarehouseId: "", sourceLocationId: "", destWarehouseId: "", destLocationId: "", notes: "" });
    setLines([{ ...EMPTY_LINE }]);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...createForm,
        sourceLocationId: createForm.sourceLocationId || null,
        destLocationId: createForm.destLocationId || null,
        lines: lines.filter((l) => l.productId && l.requestedQty).map((l) => ({ productId: l.productId, requestedQty: Number(l.requestedQty) })),
      };
      await inventoryApi.createTransfer(payload);
      showToast("Transfer created.", "ok");
      setCreateOpen(false);
      resetCreateForm();
      await load();
    } catch (err) {
      showToast(err.message || "Failed to create transfer.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Detail drawer (view / advance status / move lines) ──────────────
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moveQty, setMoveQty] = useState({});
  const [confirmCancel, setConfirmCancel] = useState(null);

  const openDetail = async (transfer) => {
    setDetailLoading(true);
    try {
      const full = await inventoryApi.getTransfer(transfer.id);
      setDetail(full);
    } catch (err) {
      showToast(err.message || "Failed to load transfer.", "error");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detail) return;
    const full = await inventoryApi.getTransfer(detail.id);
    setDetail(full);
  };

  const handleStatusChange = async (status) => {
    try {
      await inventoryApi.setTransferStatus(detail.id, status);
      showToast(`Transfer moved to ${formatEnumLabel(status)}.`, "ok");
      await refreshDetail();
      await load();
    } catch (err) {
      showToast(err.message || "Failed to update status.", "error");
    }
  };

  const handleMove = async (lineId) => {
    const qty = Number(moveQty[lineId]);
    if (!(qty > 0)) return showToast("Enter a quantity greater than zero.", "error");
    try {
      await inventoryApi.moveTransferLine(detail.id, lineId, qty);
      showToast("Stock moved.", "ok");
      setMoveQty((prev) => ({ ...prev, [lineId]: "" }));
      await refreshDetail();
      await load();
    } catch (err) {
      showToast(err.message || "Move failed.", "error");
    }
  };

  const allowedNextStatuses = detail ? TRANSFER_STATUS_TRANSITIONS[detail.status] || [] : [];

  return (
    <AdminShell active="Transfers" title="Transfers" subtitle="Move stock between warehouses and locations.">
      {toast.msg && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.msg}</div>}

      <DataTable
        title="All Transfers"
        loading={loading}
        error={error}
        onRetry={load}
        rows={transfers}
        rowKey={(t) => t.id}
        searchFn={(t, q) => t.transferNumber.toLowerCase().includes(q.toLowerCase())}
        emptyTitle="No transfers yet"
        emptyDescription='Click "New Transfer" to move stock between warehouses.'
        toolbarActions={
          canTransfer && (
            <button className="admin-premium-button primary" type="button" onClick={() => setCreateOpen(true)}>
              <span className="material-symbols-outlined">add</span>
              New Transfer
            </button>
          )
        }
        columns={[
          { key: "number", header: "Transfer #", sortable: true, render: (t) => t.transferNumber },
          { key: "source", header: "Source", render: (t) => t.sourceWarehouse?.name || "—" },
          { key: "dest", header: "Destination", render: (t) => t.destWarehouse?.name || "—" },
          { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
          { key: "created", header: "Created", sortable: true, render: (t) => new Date(t.createdAt).toLocaleDateString() },
        ]}
        rowActions={(t) => [{ label: "View", onClick: () => openDetail(t) }]}
      />

      <DetailDrawer open={createOpen} onClose={() => setCreateOpen(false)} title="New Transfer" width={560}
        actions={
          <>
            <button type="button" className="admin-premium-button" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" form="transfer-create-form" className="admin-premium-button primary" disabled={saving}>
              {saving ? "Creating…" : "Create Transfer"}
            </button>
          </>
        }
      >
        <form id="transfer-create-form" onSubmit={handleCreate}>
          <FormSection title="Route">
            <div className="admin-field">
              <label htmlFor="src-wh">Source Warehouse *</label>
              <select id="src-wh" required value={createForm.sourceWarehouseId} onChange={(e) => setCreateForm((f) => ({ ...f, sourceWarehouseId: e.target.value, sourceLocationId: "" }))}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="src-loc">Source Location</label>
              <select id="src-loc" value={createForm.sourceLocationId} onChange={(e) => setCreateForm((f) => ({ ...f, sourceLocationId: e.target.value }))}>
                <option value="">Default (internal)</option>
                {locationsForWarehouse(createForm.sourceWarehouseId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="dest-wh">Destination Warehouse *</label>
              <select id="dest-wh" required value={createForm.destWarehouseId} onChange={(e) => setCreateForm((f) => ({ ...f, destWarehouseId: e.target.value, destLocationId: "" }))}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="dest-loc">Destination Location</label>
              <select id="dest-loc" value={createForm.destLocationId} onChange={(e) => setCreateForm((f) => ({ ...f, destLocationId: e.target.value }))}>
                <option value="">Default (internal)</option>
                {locationsForWarehouse(createForm.destWarehouseId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </FormSection>

          <FormSection title="Lines" columns={1}>
            {lines.map((line, index) => (
              <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select
                  required value={line.productId} style={{ flex: 2 }}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, productId: e.target.value } : l)))}
                >
                  <option value="">Select product…</option>
                  {products.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>)}
                </select>
                <input
                  required type="number" min="1" placeholder="Qty" style={{ flex: 1 }} value={line.requestedQty}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, requestedQty: e.target.value } : l)))}
                />
                {lines.length > 1 && (
                  <button type="button" className="admin-premium-button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}>
                    <span className="material-symbols-outlined">close</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="admin-premium-button" onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}>
              <span className="material-symbols-outlined">add</span> Add Line
            </button>
          </FormSection>

          <div className="admin-field">
            <label htmlFor="transfer-notes">Notes</label>
            <textarea id="transfer-notes" rows={2} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </form>
      </DetailDrawer>

      <DetailDrawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={560}
        title={detail ? `Transfer ${detail.transferNumber}` : ""}
        subtitle={detail ? <StatusBadge status={detail.status} /> : ""}
      >
        {detailLoading && <p className="admin-loading">Loading…</p>}
        {detail && !detailLoading && (
          <>
            <section style={{ marginBottom: 20 }}>
              <p className="orders-label">Route</p>
              <p>{detail.sourceWarehouse?.name} → {detail.destWarehouse?.name}</p>
              {detail.notes && <p style={{ color: "var(--color-on-surface-variant)", fontSize: 13 }}>{detail.notes}</p>}
            </section>

            <section style={{ marginBottom: 20 }}>
              <p className="orders-label">Lines</p>
              <table className="admin-table">
                <thead><tr><th>Product</th><th>Requested</th><th>Moved</th>{canTransfer && detail.status !== "draft" && detail.status !== "completed" && detail.status !== "cancelled" && <th>Move</th>}</tr></thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.product?.name || line.productId}</td>
                      <td>{line.requestedQty}</td>
                      <td>{line.movedQty}</td>
                      {canTransfer && ["ready", "in_progress"].includes(detail.status) && (
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              type="number" min="1" max={line.requestedQty - line.movedQty} style={{ width: 70 }}
                              value={moveQty[line.id] || ""}
                              onChange={(e) => setMoveQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                              disabled={line.movedQty >= line.requestedQty}
                            />
                            <button
                              type="button" className="admin-premium-button"
                              onClick={() => handleMove(line.id)}
                              disabled={line.movedQty >= line.requestedQty}
                            >
                              Move
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {canTransfer && allowedNextStatuses.length > 0 && (
              <section>
                <p className="orders-label">Actions</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {allowedNextStatuses.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`admin-premium-button${status === "cancelled" ? " danger" : status === "completed" || status === "in_progress" ? " primary" : ""}`}
                      onClick={() => (status === "cancelled" ? setConfirmCancel(status) : handleStatusChange(status))}
                    >
                      Mark {formatEnumLabel(status)}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={Boolean(confirmCancel)}
        title="Cancel this transfer?"
        description="This cannot be undone. Stock already moved will remain at its destination."
        confirmLabel="Cancel Transfer"
        danger
        onCancel={() => setConfirmCancel(null)}
        onConfirm={async () => { await handleStatusChange("cancelled"); setConfirmCancel(null); }}
      />
    </AdminShell>
  );
};

export default AdminInventoryTransfers;
