import { useEffect, useState, useCallback } from "react";
import { commerceApi, inventoryApi } from "../../services/api";

/**
 * Shared lookup data (products, warehouses, locations) used across every
 * inventory page for pickers/filters — loaded once instead of duplicating
 * the same three fetches in eight different pages.
 */
export const useInventoryLookups = () => {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reloadLocations = useCallback(async () => {
    const locationRows = await inventoryApi.getLocations();
    setLocations(locationRows);
    return locationRows;
  }, []);

  const reloadWarehouses = useCallback(async () => {
    const warehouseRows = await inventoryApi.getWarehouses();
    setWarehouses(warehouseRows);
    return warehouseRows;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [productRows, warehouseRows, locationRows] = await Promise.all([
          commerceApi.getAdminProducts(),
          inventoryApi.getWarehouses(),
          inventoryApi.getLocations(),
        ]);
        if (cancelled) return;
        setProducts(Array.isArray(productRows) ? productRows : []);
        setWarehouses(warehouseRows);
        setLocations(locationRows);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load inventory reference data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const locationsForWarehouse = (warehouseId) => locations.filter((l) => l.warehouseId === warehouseId);
  const productName = (productId) => products.find((p) => (p._id || p.id) === productId)?.name || productId;
  const warehouseName = (warehouseId) => warehouses.find((w) => w.id === warehouseId)?.name || warehouseId;
  const locationName = (locationId) => locations.find((l) => l.id === locationId)?.name || locationId;

  return {
    products, warehouses, locations, loading, error,
    reloadLocations, reloadWarehouses,
    locationsForWarehouse, productName, warehouseName, locationName,
  };
};

export default useInventoryLookups;
