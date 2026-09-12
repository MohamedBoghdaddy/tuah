import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable, DetailDrawer, FormSection, StatusBadge, ConfirmDialog } from "../../Components/ui";
import { useAuthContext } from "../../context/AuthContext";
import { can } from "../../utils/permissions";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";
import { RECEIPT_STATUS_TRANSITIONS } from "./inventoryConstants";

const EMPTY_LINE = { productId: "", expectedQty: "", qualityHold: false };

const AdminInventoryReceipts = () => {
  const { state } = useAuthContext();
  const canReceive = can(state.user, "inventory.receive");
  const { products, warehouses } = useInventoryLookups();

  const [receipts, setReceipts] = useState([]);
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
      const { receipts: rows } = await inventoryApi.getReceipts({ limit: 200 });
      setReceipts(rows);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load receipts.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ warehouseId: "", supplierName: "", notes: "" });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.createReceipt({
        ...createForm,
        lines: lines.filter((l) => l.productId).map((l) => ({ ...l, expectedQty: Number(l.expectedQty || 0) })),
      });
      showToast("Receipt created.", "ok");
      setCreateOpen(false);
      setCreateForm({ warehouseId: "", supplierName: "", notes: "" });
      setLines([{ ...EMPTY_LINE }]);
      await load();
    } catch (err) {
      showToast(err.message || "Failed to create receipt.", "error");
    } finally {
      setSaving(false);
    }
  };

  const [detail, setDetail] = useState(null);
  const [receiveQty, setReceiveQty] = useState({});
  const [allowOver, setAllowOver] = useState({});
  const [confirmCancel, setConfirmCancel] = useState(false);

  const openDetail = async (receipt) => {
    try {
      const full = await inventoryApi.getReceipt(receipt.id);
      setDetail(full);
    } catch (err) {
      showToast(err.message || "Failed to load receipt.", "error");
    }
  };

  const refreshDetail = async () => {
    if (!detail) return;
    setDetail(await inventoryApi.getReceipt(detail.id));
  };

  const handleReceive = async (lineId) => {
    const qty = Number(receiveQty[lineId]);
    if (!(qty > 0)) return showToast("Enter a quantity greater than zero.", "error");
    try {
      await inventoryApi.receiveLine(detail.id, lineId, qty, Boolean(allowOver[lineId]));
      showToast("Stock received.", "ok");
      setReceiveQty((prev) => ({ ...prev, [lineId]: "" }));
      await refreshDetail();
      await load();
    } catch (err) {
      showToast(err.message || "Receive failed.", "error");
    }
  };

  const handleCancel = async () => {
    try {
      await inventoryApi.setReceiptStatus(detail.id, "cancelled");
      showToast("Receipt cancelled.", "ok");
      setConfirmCancel(false);
      await refreshDetail();
      await load();
    } catch (err) {
      showToast(err.message || "Failed to cancel receipt.", "error");
    }
  };

  const canCancel = detail ? (RECEIPT_STATUS_TRANSITIONS[detail.status] || []).includes("cancelled") : false;
  const canReceiveLines = detail && ["draft", "partially_received"].includes(detail.status);

  return (
    <AdminShell active="Receipts" title="Receipts" subtitle="Receive supplier stock into a warehouse.">
      {toast.msg && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.msg}</div>}

      <DataTable
        title="All Receipts"
        loading={loading}
        error={error}
        onRetry={load}
        rows={receipts}
        rowKey={(r) => r.id}
        searchFn={(r, q) => r.receiptNumber.toLowerCase().includes(q.toLowerCase()) || (r.supplierName || "").toLowerCase().includes(q.toLowerCase())}
        emptyTitle="No receipts yet"
        emptyDescription='Click "New Receipt" to record incoming supplier stock.'
        toolbarActions={
          canReceive && (
            <button className="admin-premium-button primary" type="button" onClick={() => setCreateOpen(true)}>
              <span className="material-symbols-outlined">add</span>
              New Receipt
            </button>
          )
        }
        columns={[
          { key: "number", header: "Receipt #", sortable: true, render: (r) => r.receiptNumber },
          { key: "warehouse", header: "Warehouse", render: (r) => r.warehouse?.name || "—" },
          { key: "supplier", header: "Supplier", render: (r) => r.supplierName || "—" },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "created", header: "Created", sortable: true, render: (r) => new Date(r.createdAt).toLocaleDateString() },
        ]}
        rowActions={(r) => [{ label: "View", onClick: () => openDetail(r) }]}
      />

      <DetailDrawer open={createOpen} onClose={() => setCreateOpen(false)} title="New Receipt" width={560}
        actions={
          <>
            <button type="button" className="admin-premium-button" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="submit" form="receipt-create-form" className="admin-premium-button primary" disabled={saving}>
              {saving ? "Creating…" : "Create Receipt"}
            </button>
          </>
        }
      >
        <form id="receipt-create-form" onSubmit={handleCreate}>
          <FormSection title="Details">
            <div className="admin-field">
              <label htmlFor="rc-wh">Warehouse *</label>
              <select id="rc-wh" required value={createForm.warehouseId} onChange={(e) => setCreateForm((f) => ({ ...f, warehouseId: e.target.value }))}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="rc-supplier">Supplier</label>
              <input id="rc-supplier" value={createForm.supplierName} onChange={(e) => setCreateForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
          </FormSection>

          <FormSection title="Lines" columns={1}>
            {lines.map((line, index) => (
              <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <select
                  required value={line.productId} style={{ flex: 2 }}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, productId: e.target.value } : l)))}
                >
                  <option value="">Select product…</option>
                  {products.map((p) => <option key={p._id || p.id} value={p._id || p.id}>{p.name}</option>)}
                </select>
                <input
                  required type="number" min="0" placeholder="Expected Qty" style={{ flex: 1 }} value={line.expectedQty}
                  onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, expectedQty: e.target.value } : l)))}
                />
                <label className="admin-checkbox-row" style={{ whiteSpace: "nowrap" }}>
                  <input
                    type="checkbox" checked={line.qualityHold}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, qualityHold: e.target.checked } : l)))}
                  />
                  <span>QA hold</span>
                </label>
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
        </form>
      </DetailDrawer>

      <DetailDrawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={560}
        title={detail ? `Receipt ${detail.receiptNumber}` : ""}
        subtitle={detail ? <StatusBadge status={detail.status} /> : ""}
        actions={detail && canCancel && canReceive && (
          <button type="button" className="admin-premium-button danger" onClick={() => setConfirmCancel(true)}>Cancel Receipt</button>
        )}
      >
        {detail && (
          <>
            <p className="orders-label">Warehouse</p>
            <p style={{ marginBottom: 16 }}>{detail.warehouse?.name}{detail.supplierName ? ` — ${detail.supplierName}` : ""}</p>

            <p className="orders-label">Lines</p>
            <table className="admin-table">
              <thead><tr><th>Product</th><th>Expected</th><th>Received</th>{canReceive && canReceiveLines && <th>Receive</th>}</tr></thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.product?.name || line.productId}{line.qualityHold && <StatusBadge status="pending" label="QA Hold" />}</td>
                    <td>{line.expectedQty}</td>
                    <td>{line.receivedQty}</td>
                    {canReceive && canReceiveLines && (
                      <td>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="number" min="1" style={{ width: 64 }}
                            value={receiveQty[line.id] || ""}
                            onChange={(e) => setReceiveQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          />
                          <label className="admin-checkbox-row" title="Allow receiving more than expected">
                            <input type="checkbox" checked={Boolean(allowOver[line.id])} onChange={(e) => setAllowOver((prev) => ({ ...prev, [line.id]: e.target.checked }))} />
                            <span style={{ fontSize: 11 }}>Over</span>
                          </label>
                          <button type="button" className="admin-premium-button" onClick={() => handleReceive(line.id)}>Receive</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </DetailDrawer>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this receipt?"
        description="This cannot be undone."
        confirmLabel="Cancel Receipt"
        danger
        onCancel={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
      />
    </AdminShell>
  );
};

export default AdminInventoryReceipts;
