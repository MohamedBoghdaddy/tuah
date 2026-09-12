import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AdminShell } from "../../Components/AdminShell";
import { StatCard, StatusBadge, ActivityTimeline, ErrorState, LoadingSkeleton, EmptyState } from "../../Components/ui";
import { inventoryApi } from "../../services/api";

const MOVEMENT_ICON = {
  supplier_receipt: "move_to_inbox",
  customer_order: "shopping_cart",
  customer_return: "assignment_return",
  supplier_return: "undo",
  warehouse_transfer: "sync_alt",
  inventory_adjustment: "rule",
  manufacturing_consumption: "precision_manufacturing",
  manufacturing_output: "precision_manufacturing",
  damage: "warning",
  scrap: "delete",
  manual_correction: "edit",
};

const AdminInventoryProductDetail = () => {
  const { productId } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await inventoryApi.getProductInventoryDetail(productId);
        setDetail(data);
        setError("");
      } catch (err) {
        setError(err.message || "Failed to load product inventory detail.");
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  const productName = detail?.balances?.[0]?.product?.name || detail?.recentMovements?.[0]?.product?.name || productId;

  return (
    <AdminShell active="Stock" title="Product Inventory" subtitle={productName}>
      {loading && <LoadingSkeleton variant="cards" rows={4} />}
      {!loading && error && <ErrorState description={error} />}

      {!loading && !error && detail && (
        <>
          <section className="admin-stats-row">
            <StatCard label="On Hand" value={detail.totals.onHand} icon="inventory" />
            <StatCard label="Reserved" value={detail.totals.reserved} icon="lock" />
            <StatCard label="Available" value={detail.totals.available} icon="check_circle" />
            <StatCard label="Incoming" value={detail.totals.incoming} icon="call_received" />
            <StatCard label="Outgoing" value={detail.totals.outgoing} icon="call_made" />
          </section>

          <section style={{ marginTop: 24 }}>
            <h2 className="admin-section-title">Balance by Location</h2>
            {detail.balances.length === 0 ? (
              <EmptyState title="No stock recorded for this product yet" icon="inbox" />
            ) : (
              <table className="admin-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Warehouse</th><th>Location</th><th>On Hand</th><th>Reserved</th><th>Available</th></tr>
                </thead>
                <tbody>
                  {detail.balances.map((b) => (
                    <tr key={b.id}>
                      <td>{b.location?.warehouse?.name || "—"}</td>
                      <td>{b.location?.name || "—"}</td>
                      <td>{b.onHand}</td>
                      <td>{b.reserved}</td>
                      <td><strong>{b.available}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginTop: 24 }}>
            <h2 className="admin-section-title">Movement History</h2>
            <ActivityTimeline
              emptyLabel="No stock movements recorded for this product yet."
              events={detail.recentMovements.map((m) => ({
                id: m.id,
                icon: MOVEMENT_ICON[m.movementType] || "history",
                title: (
                  <>
                    {m.quantity > 0 ? "+" : ""}{m.quantity} at {m.location?.name || "location"}
                    {" "}<StatusBadge status={m.movementType} />
                  </>
                ),
                description: m.notes || undefined,
                timestamp: m.createdAt,
                tone: m.quantity > 0 ? "success" : "danger",
              }))}
            />
          </section>
        </>
      )}
    </AdminShell>
  );
};

export default AdminInventoryProductDetail;
