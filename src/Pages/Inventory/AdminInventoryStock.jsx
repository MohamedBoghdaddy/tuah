import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminShell } from "../../Components/AdminShell";
import { DataTable } from "../../Components/ui";
import { inventoryApi } from "../../services/api";
import { useInventoryLookups } from "./useInventoryLookups";

const AdminInventoryStock = () => {
  const navigate = useNavigate();
  const { warehouses, locations, loading: lookupsLoading } = useInventoryLookups();
  const [warehouseId, setWarehouseId] = useState("");
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { balances: rows } = await inventoryApi.getBalances({ warehouseId: warehouseId || undefined, limit: 200 });
      setBalances(rows);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load stock levels.");
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { load(); }, [load]);

  return (
    <AdminShell active="Stock" title="Stock Levels" subtitle="On hand, reserved, and available quantity by product and location.">
      <DataTable
        title="Stock Balances"
        loading={loading || lookupsLoading}
        error={error}
        onRetry={load}
        rows={balances}
        rowKey={(b) => b.id}
        searchFn={(b, q) => (b.product?.name || "").toLowerCase().includes(q.toLowerCase()) || (b.product?.sku || "").toLowerCase().includes(q.toLowerCase())}
        searchPlaceholder="Search products…"
        emptyTitle="No stock recorded yet"
        emptyDescription="Balances appear once stock is received, adjusted, or transferred into a location."
        toolbarActions={
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="ui-search-input" style={{ minWidth: 180 }}>
            <option value="">All Warehouses</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        }
        columns={[
          { key: "product", header: "Product", sortValue: (b) => b.product?.name, sortable: true, render: (b) => b.product?.name || b.productId },
          { key: "sku", header: "SKU", render: (b) => b.product?.sku || "—" },
          { key: "warehouse", header: "Warehouse", render: (b) => b.location?.warehouse?.name || "—" },
          { key: "location", header: "Location", render: (b) => b.location?.name || "—" },
          { key: "onHand", header: "On Hand", sortable: true, align: "right", render: (b) => b.onHand },
          { key: "reserved", header: "Reserved", sortable: true, align: "right", render: (b) => b.reserved },
          { key: "available", header: "Available", sortable: true, align: "right", render: (b) => <strong>{b.available}</strong> },
        ]}
        rowActions={(b) => [{ label: "View Detail", onClick: () => navigate(`/admin/inventory/products/${b.productId}`) }]}
      />
      {locations.length === 0 && !loading && (
        <p className="admin-upload-hint" style={{ marginTop: 12 }}>
          No warehouse locations exist yet — create one from the Warehouses page before receiving or adjusting stock.
        </p>
      )}
    </AdminShell>
  );
};

export default AdminInventoryStock;
