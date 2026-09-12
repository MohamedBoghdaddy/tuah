// Regression test for role permissions: locks in which permission string
// guards each inventory route, so an accidental relaxation (or tightening)
// shows up as a failing test instead of a silent security change. This runs
// without a database — it only inspects how the router is wired.
import { jest } from "@jest/globals";

const recordedPermissions = [];

jest.unstable_mockModule("../../../middleware/AuthMiddleware.js", () => ({
  isAuthenticated: (req, res, next) => next(),
  requirePermission: (permission) => {
    recordedPermissions.push(permission);
    return (req, res, next) => next();
  },
}));

const { default: router } = await import("../routes/inventoryRoutes.js");

// Walks the Express router stack in registration order and pairs each route
// (method + path) with the permission recorded for it above — registration
// order matches call order 1:1 since requirePermission(...) runs once per
// route at module-load time, in source order.
const routeEntries = () => {
  const entries = [];
  let permissionIndex = 0;
  router.stack.forEach((layer) => {
    if (!layer.route) return; // skip the isAuthenticated `router.use(...)` layer
    const methods = Object.keys(layer.route.methods).join(",");
    entries.push({ method: methods, path: layer.route.path, permission: recordedPermissions[permissionIndex] });
    permissionIndex += 1;
  });
  return entries;
};

test("every inventory route requires the expected permission", () => {
  const expected = [
    ["get", "/warehouses", "inventory.read"],
    ["get", "/warehouses/:id", "inventory.read"],
    ["post", "/warehouses", "warehouses.manage"],
    ["patch", "/warehouses/:id", "warehouses.manage"],
    ["patch", "/warehouses/:id/set-default", "warehouses.manage"],
    ["get", "/locations", "inventory.read"],
    ["get", "/locations/:id", "inventory.read"],
    ["post", "/locations", "warehouses.manage"],
    ["patch", "/locations/:id", "warehouses.manage"],
    ["get", "/overview", "inventory.read"],
    ["get", "/balances", "inventory.read"],
    ["get", "/movements", "inventory.read"],
    ["get", "/products/:productId/detail", "inventory.read"],
    ["get", "/reservations", "inventory.read"],
    ["post", "/reservations", "inventory.reservations.manage"],
    ["patch", "/reservations/:id/release", "inventory.reservations.manage"],
    ["patch", "/reservations/:id/consume", "inventory.reservations.manage"],
    ["get", "/adjustments", "inventory.read"],
    ["post", "/adjustments", "inventory.adjust"],
    ["get", "/transfers", "inventory.read"],
    ["get", "/transfers/:id", "inventory.read"],
    ["post", "/transfers", "inventory.transfer"],
    ["post", "/transfers/:id/lines", "inventory.transfer"],
    ["delete", "/transfers/:id/lines/:lineId", "inventory.transfer"],
    ["patch", "/transfers/:id/status", "inventory.transfer"],
    ["post", "/transfers/:id/lines/:lineId/move", "inventory.transfer"],
    ["get", "/receipts", "inventory.read"],
    ["get", "/receipts/:id", "inventory.read"],
    ["post", "/receipts", "inventory.receive"],
    ["post", "/receipts/:id/lines", "inventory.receive"],
    ["delete", "/receipts/:id/lines/:lineId", "inventory.receive"],
    ["patch", "/receipts/:id/status", "inventory.receive"],
    ["post", "/receipts/:id/lines/:lineId/receive", "inventory.receive"],
    ["get", "/settings", "inventory.read"],
    ["put", "/settings", "inventory.settings.manage"],
    ["get", "/replenishment", "inventory.read"],
  ];

  const actual = routeEntries().map((e) => [e.method, e.path, e.permission]);
  expect(actual).toEqual(expected);
});

test("mutating routes (write operations) never rely on inventory.read alone", () => {
  const writeMethods = new Set(["post", "put", "patch", "delete"]);
  routeEntries()
    .filter((e) => writeMethods.has(e.method))
    .forEach((e) => expect(e.permission).not.toBe("inventory.read"));
});
