import { useCallback, useState } from "react";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable, DetailDrawer, FormSection, StatusBadge } from "../../Components/ui";
import { useAuthContext } from "../../context/AuthContext";
import { can } from "../../utils/permissions";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";
import { LOCATION_LEVELS, LOCATION_TYPES } from "./inventoryConstants";

const EMPTY_WAREHOUSE_FORM = { code: "", name: "", fulfillmentPriority: 100, isActive: true };
const EMPTY_LOCATION_FORM = { code: "", name: "", level: "warehouse", locationType: "internal", parentLocationId: "" };

const AdminInventoryWarehouses = () => {
  const { state } = useAuthContext();
  const user = state.user;
  const canManage = can(user, "warehouses.manage");

  const { warehouses, loading, error, reloadWarehouses, reloadLocations, locationsForWarehouse } = useInventoryLookups();

  const [toast, setToast] = useState({ msg: "", type: "info" });
  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: "", type: "info" }), 3000);
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState(null);
  const [form, setForm] = useState(EMPTY_WAREHOUSE_FORM);
  const [saving, setSaving] = useState(false);

  const [locationsWarehouse, setLocationsWarehouse] = useState(null);
  const [locationForm, setLocationForm] = useState(EMPTY_LOCATION_FORM);
  const [savingLocation, setSavingLocation] = useState(false);

  const openCreate = () => {
    setEditingWarehouse(null);
    setForm(EMPTY_WAREHOUSE_FORM);
    setFormOpen(true);
  };

  const openEdit = (warehouse) => {
    setEditingWarehouse(warehouse);
    setForm({ code: warehouse.code, name: warehouse.name, fulfillmentPriority: warehouse.fulfillmentPriority, isActive: warehouse.isActive });
    setFormOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingWarehouse) {
        await inventoryApi.updateWarehouse(editingWarehouse.id, form);
        showToast("Warehouse updated.", "ok");
      } else {
        await inventoryApi.createWarehouse(form);
        showToast("Warehouse created.", "ok");
      }
      await reloadWarehouses();
      setFormOpen(false);
    } catch (err) {
      showToast(err.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (warehouse) => {
    try {
      await inventoryApi.setDefaultWarehouse(warehouse.id);
      showToast(`${warehouse.name} is now the default warehouse.`, "ok");
      await reloadWarehouses();
    } catch (err) {
      showToast(err.message || "Failed to set default warehouse.", "error");
    }
  };

  const openLocations = (warehouse) => {
    setLocationsWarehouse(warehouse);
    setLocationForm(EMPTY_LOCATION_FORM);
  };

  const handleAddLocation = async (e) => {
    e.preventDefault();
    if (!locationsWarehouse) return;
    setSavingLocation(true);
    try {
      await inventoryApi.createLocation({ ...locationForm, warehouseId: locationsWarehouse.id, parentLocationId: locationForm.parentLocationId || null });
      await reloadLocations();
      setLocationForm(EMPTY_LOCATION_FORM);
      showToast("Location added.", "ok");
    } catch (err) {
      showToast(err.message || "Failed to add location.", "error");
    } finally {
      setSavingLocation(false);
    }
  };

  const warehouseLocations = locationsWarehouse ? locationsForWarehouse(locationsWarehouse.id) : [];

  return (
    <AdminShell active="Warehouses" title="Warehouses" subtitle="Physical locations stock is tracked against.">
      {toast.msg && <div className={`admin-toast admin-toast--${toast.type}`}>{toast.msg}</div>}

      <DataTable
        title="All Warehouses"
        loading={loading}
        error={error}
        rows={warehouses}
        rowKey={(w) => w.id}
        searchFn={(w, q) => w.name.toLowerCase().includes(q.toLowerCase()) || w.code.toLowerCase().includes(q.toLowerCase())}
        emptyTitle="No warehouses yet"
        emptyDescription='Click "Add Warehouse" to create your first one.'
        toolbarActions={
          canManage && (
            <button className="admin-premium-button primary" type="button" onClick={openCreate}>
              <span className="material-symbols-outlined">add</span>
              Add Warehouse
            </button>
          )
        }
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Name", sortable: true },
          { key: "priority", header: "Priority", sortable: true, render: (w) => w.fulfillmentPriority },
          { key: "status", header: "Status", render: (w) => <StatusBadge status={w.isActive ? "active" : "inactive"} /> },
          { key: "default", header: "Default", render: (w) => (w.isDefault ? <StatusBadge status="active" label="Default" /> : "—") },
        ]}
        rowActions={
          canManage
            ? (w) => [
                { label: "Locations", onClick: () => openLocations(w) },
                { label: "Edit", onClick: () => openEdit(w) },
                ...(w.isDefault ? [] : [{ label: "Set Default", onClick: () => handleSetDefault(w) }]),
              ]
            : (w) => [{ label: "Locations", onClick: () => openLocations(w) }]
        }
      />

      <DetailDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingWarehouse ? `Edit ${editingWarehouse.name}` : "Add Warehouse"}
        actions={
          <>
            <button type="button" className="admin-premium-button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" form="warehouse-form" className="admin-premium-button primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="warehouse-form" onSubmit={handleSave}>
          <FormSection>
            <div className="admin-field">
              <label htmlFor="wh-code">Code *</label>
              <input id="wh-code" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label htmlFor="wh-name">Name *</label>
              <input id="wh-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="admin-field">
              <label htmlFor="wh-priority">Fulfillment Priority</label>
              <input
                id="wh-priority" type="number" value={form.fulfillmentPriority}
                onChange={(e) => setForm((f) => ({ ...f, fulfillmentPriority: e.target.value }))}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="wh-active">Active</label>
              <label className="admin-checkbox-row" htmlFor="wh-active">
                <input id="wh-active" type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                <span>Available for fulfillment</span>
              </label>
            </div>
          </FormSection>
        </form>
      </DetailDrawer>

      <DetailDrawer
        open={Boolean(locationsWarehouse)}
        onClose={() => setLocationsWarehouse(null)}
        title={locationsWarehouse ? `${locationsWarehouse.name} — Locations` : ""}
        subtitle="Optional Zone → Aisle → Rack → Bin hierarchy. Simple warehouses can use one flat location."
      >
        {warehouseLocations.length === 0 ? (
          <p className="admin-empty">No locations yet for this warehouse.</p>
        ) : (
          <table className="admin-table" style={{ marginBottom: 20 }}>
            <thead><tr><th>Code</th><th>Name</th><th>Level</th><th>Type</th></tr></thead>
            <tbody>
              {warehouseLocations.map((l) => (
                <tr key={l.id}>
                  <td>{l.code}</td><td>{l.name}</td><td>{l.level}</td><td>{l.locationType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canManage && (
          <form onSubmit={handleAddLocation}>
            <FormSection title="Add Location">
              <div className="admin-field">
                <label htmlFor="loc-code">Code *</label>
                <input id="loc-code" required value={locationForm.code} onChange={(e) => setLocationForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="admin-field">
                <label htmlFor="loc-name">Name *</label>
                <input id="loc-name" required value={locationForm.name} onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="admin-field">
                <label htmlFor="loc-level">Level</label>
                <select id="loc-level" value={locationForm.level} onChange={(e) => setLocationForm((f) => ({ ...f, level: e.target.value }))}>
                  {LOCATION_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                </select>
              </div>
              <div className="admin-field">
                <label htmlFor="loc-type">Type</label>
                <select id="loc-type" value={locationForm.locationType} onChange={(e) => setLocationForm((f) => ({ ...f, locationType: e.target.value }))}>
                  {LOCATION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div className="admin-field">
                <label htmlFor="loc-parent">Parent Location</label>
                <select id="loc-parent" value={locationForm.parentLocationId} onChange={(e) => setLocationForm((f) => ({ ...f, parentLocationId: e.target.value }))}>
                  <option value="">None (top-level)</option>
                  {warehouseLocations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                </select>
              </div>
            </FormSection>
            <button type="submit" className="admin-premium-button primary" disabled={savingLocation}>
              {savingLocation ? "Adding…" : "Add Location"}
            </button>
          </form>
        )}
      </DetailDrawer>
    </AdminShell>
  );
};

export default AdminInventoryWarehouses;
