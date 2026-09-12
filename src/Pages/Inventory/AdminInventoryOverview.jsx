import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AdminShell } from "../../Components/AdminShell";
import { StatCard, ErrorState, LoadingSkeleton, EmptyState } from "../../Components/ui";
import StatusBadge from "../../Components/ui/StatusBadge";
import { inventoryApi } from "../../services/api";

const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const AdminInventoryOverview = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [overviewData, replenishmentRows] = await Promise.all([
          inventoryApi.getOverview(),
          inventoryApi.getReplenishmentCandidates(),
        ]);
        setOverview(overviewData);
        setCandidates(replenishmentRows);
        setError("");
      } catch (err) {
        setError(err.message || "Failed to load inventory overview.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AdminShell active="Overview" title="Inventory Overview" subtitle="Real-time warehouse, stock, and fulfillment signals.">
      {loading && <LoadingSkeleton variant="cards" rows={6} />}
      {!loading && error && <ErrorState description={error} />}

      {!loading && !error && overview && (
        <>
          <section className="admin-stats-row">
            <StatCard label="Warehouses" value={`${overview.activeWarehouses} / ${overview.totalWarehouses}`} icon="warehouse" hint="active / total" />
            <StatCard label="Locations" value={overview.totalLocations} icon="location_on" />
            <StatCard label="On-Hand Value" value={money(overview.onHandValue)} icon="payments" />
            <StatCard label="Active Reservations" value={overview.activeReservations} icon="lock" />
            <StatCard label="Open Transfers" value={overview.openTransfers} icon="sync_alt" />
            <StatCard label="Open Receipts" value={overview.openReceipts} icon="move_to_inbox" />
          </section>

          <section style={{ marginTop: 24 }}>
            <div className="ui-table-toolbar">
              <div className="ui-table-toolbar-title">
                <h2 className="admin-section-title">Replenishment Alerts</h2>
                <span className="ui-table-toolbar-count">{candidates.length}</span>
              </div>
              <button className="admin-premium-button" type="button" onClick={() => navigate("/admin/inventory/replenishment")}>
                View All
              </button>
            </div>

            {candidates.length === 0 ? (
              <EmptyState
                icon="check_circle"
                title="Nothing at or below its reorder point"
                description="Every product with replenishment settings configured is currently above its reorder point."
              />
            ) : (
              <div className="ui-data-table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Warehouse</th>
                      <th>On Hand</th>
                      <th>Reorder Point</th>
                      <th>Reorder Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.slice(0, 8).map((row) => (
                      <tr key={row.id}>
                        <td className="admin-cell-name">{row.product?.name || row.productId}</td>
                        <td>{row.warehouseId}</td>
                        <td>{row.onHand}</td>
                        <td>{row.reorderPoint}</td>
                        <td>{row.reorderQty}</td>
                        <td><StatusBadge status={row.onHand <= 0 ? "out_of_stock" : "low_stock"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
};

export default AdminInventoryOverview;
